export interface ShopifyConfig {
  /** Домен магазина: italian-edit.myshopify.com */
  shop: string;
  /** Легаси-вариант: постоянный Admin API token (shpat_…, приложения до 2026). */
  adminToken?: string;
  /** Новый вариант (Dev Dashboard, 2026+): client credentials → токен на 24 часа. */
  clientId?: string;
  clientSecret?: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = "2025-01";
/** Обновляем токен заранее, за час до истечения. */
const REFRESH_MARGIN_MS = 60 * 60_000;

interface TokenCache {
  token: string;
  expiresAt: number;
}

/** Повторов на «Throttled», прежде чем сдаться (каждый ждёт восстановления ведра). */
const MAX_THROTTLE_RETRIES = 8;

interface ThrottleCost {
  requestedQueryCost?: number;
  throttleStatus?: { currentlyAvailable: number; restoreRate: number };
}

export class ThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super("Shopify GraphQL: Throttled");
  }
}

/** Сколько ждать, чтобы в ведре хватило баллов на этот запрос (+ запас 0,5 с). */
export function throttleWaitMs(cost: ThrottleCost | undefined): number {
  const status = cost?.throttleStatus;
  if (!status || !status.restoreRate) return 2_000;
  const deficit = Math.max(0, (cost?.requestedQueryCost ?? 0) - status.currentlyAvailable);
  return Math.ceil((deficit / status.restoreRate) * 1000) + 500;
}

/**
 * Клиент Shopify Admin GraphQL API.
 * Поддерживает оба способа авторизации:
 *  - постоянный токен (legacy custom app);
 *  - client credentials grant (Dev Dashboard): токен живёт 24 ч,
 *    клиент сам получает и обновляет его, на 401 — принудительно перевыпускает.
 */
export class ShopifyClient {
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private tokenCache: TokenCache | null = null;

  constructor(
    private readonly cfg: ShopifyConfig,
    fetchFn?: typeof fetch
  ) {
    if (!cfg.adminToken && !(cfg.clientId && cfg.clientSecret)) {
      throw new Error(
        "ShopifyClient: нужен либо adminToken, либо clientId + clientSecret"
      );
    }
    const version = cfg.apiVersion ?? DEFAULT_API_VERSION;
    this.endpoint = `https://${cfg.shop}/admin/api/${version}/graphql.json`;
    this.fetchFn = fetchFn ?? fetch;
  }

  get shop(): string {
    return this.cfg.shop;
  }

  /** Обмен client credentials на access token (POST /admin/oauth/access_token). */
  private async fetchToken(): Promise<TokenCache> {
    const res = await this.fetchFn(
      `https://${this.cfg.shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.cfg.clientId!,
          client_secret: this.cfg.clientSecret!,
        }).toString(),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify OAuth: HTTP ${res.status} ${text}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    return {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private async getToken(): Promise<string> {
    if (this.cfg.adminToken) return this.cfg.adminToken;
    if (
      !this.tokenCache ||
      Date.now() >= this.tokenCache.expiresAt - REFRESH_MARGIN_MS
    ) {
      this.tokenCache = await this.fetchToken();
    }
    return this.tokenCache.token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    // Лимит запросов (leaky bucket): ждём, пока ведро восстановится, и повторяем.
    // Без этого длинные задачи (фильтры по 4 тыс. товаров) падали на «Throttled».
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.graphqlOnce<T>(query, variables);
      } catch (err) {
        if (!(err instanceof ThrottledError) || attempt >= MAX_THROTTLE_RETRIES) throw err;
        await new Promise((r) => setTimeout(r, err.waitMs));
      }
    }
  }

  private async graphqlOnce<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let res = await this.doRequest(query, variables, await this.getToken());

    // 401 при client credentials → токен отозван/протух, перевыпускаем один раз
    if (res.status === 401 && !this.cfg.adminToken) {
      this.tokenCache = null;
      res = await this.doRequest(query, variables, await this.getToken());
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify: HTTP ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: T;
      errors?: { message: string; extensions?: { code?: string } }[];
      extensions?: { cost?: ThrottleCost };
    };
    if (payload.errors?.some((e) => e.extensions?.code === "THROTTLED" || e.message === "Throttled")) {
      throw new ThrottledError(throttleWaitMs(payload.extensions?.cost));
    }
    if (payload.errors?.length) {
      throw new Error(
        `Shopify GraphQL: ${payload.errors.map((e) => e.message).join("; ")}`
      );
    }
    if (!payload.data) throw new Error("Shopify GraphQL: пустой ответ");
    return payload.data;
  }

  private doRequest(
    query: string,
    variables: Record<string, unknown>,
    token: string
  ): Promise<Response> {
    return this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
  }
}
