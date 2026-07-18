import { RateLimiter } from "./rateLimiter";
import type {
  BgProduct,
  BgProductStatus,
  BgOrderRequest,
  BgOrderResponse,
} from "./types";

export interface BgCredentials {
  baseUrl: string; // https://nova.shopwoo.com
  email: string;
  password: string;
  storeId: number;
}

export interface BgClientOptions {
  maxRetries?: number;
  /** Инъекция fetch для тестов. */
  fetchFn?: typeof fetch;
  limiter?: RateLimiter;
  /** Пауза между ретраями (инъекция для тестов). */
  sleep?: (ms: number) => Promise<void>;
}

interface ProductQuery {
  page?: number;
  per_page?: number;
  updated_at_min?: string;
  updated_at_max?: string;
  stock_status?: "instock" | "outofstock";
  brand?: number;
  category?: number;
  price_min?: number;
  price_max?: number;
  search?: string;
  sku?: string;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * HTTP-клиент BrandsGateway: basic auth, ограничение скорости (≤50 rpm),
 * ретраи с экспоненциальным backoff, пагинация товаров.
 */
export class BgClient {
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly creds: BgCredentials,
    opts: BgClientOptions = {}
  ) {
    this.auth =
      "Basic " +
      Buffer.from(`${creds.email}:${creds.password}`).toString("base64");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.limiter = opts.limiter ?? new RateLimiter();
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private url(path: string, query: Record<string, unknown> = {}): string {
    const u = new URL(path.replace(/^\//, ""), this.creds.baseUrl.replace(/\/?$/, "/"));
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {}
  ): Promise<T> {
    const url = this.url(path, opts.query);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: this.auth,
            Accept: "application/json",
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        lastErr = err; // сеть/таймаут — повторяем
        await this.backoff(attempt);
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        await this.backoff(attempt, Number.isFinite(retryAfter) ? retryAfter : 0);
        continue;
      }

      const text = await res.text().catch(() => "");
      throw new Error(`BrandsGateway ${method} ${path}: HTTP ${res.status} ${text}`);
    }
    throw new Error(
      `BrandsGateway ${method} ${path}: не удалось после ${this.maxRetries} ретраев (${lastErr})`
    );
  }

  private async backoff(attempt: number, floorMs = 0): Promise<void> {
    // 0.5s, 1s, 2s, 4s… (без джиттера — детерминированно для тестов)
    const delay = Math.max(floorMs, 500 * 2 ** attempt);
    await this.sleep(delay);
  }

  /** Одна страница товаров. */
  async getProducts(query: ProductQuery = {}): Promise<BgProduct[]> {
    return this.request<BgProduct[]>("GET", "/api/v1/products", {
      query: { store_id: this.creds.storeId, per_page: 100, ...query },
    });
  }

  /** Все товары постранично (async-генератор — не держим весь каталог в памяти). */
  async *iterateProducts(
    query: Omit<ProductQuery, "page" | "per_page"> = {}
  ): AsyncGenerator<BgProduct> {
    for (let page = 1; ; page++) {
      const batch = await this.getProducts({ ...query, page, per_page: 100 });
      if (batch.length === 0) return;
      for (const p of batch) yield p;
      if (batch.length < 100) return;
    }
  }

  async getProduct(id: number): Promise<BgProduct> {
    return this.request<BgProduct>("GET", `/api/v1/products/${id}`);
  }

  /** Быстрая проверка наличия по id (до 1000 за раз). */
  async checkStatuses(productIds: number[]): Promise<BgProductStatus[]> {
    if (productIds.length > 1000) {
      throw new Error("checkStatuses: не больше 1000 id за запрос");
    }
    return this.request<BgProductStatus[]>("POST", "/api/v1/products/check-status", {
      body: { product_ids: productIds },
    });
  }

  async createOrder(order: BgOrderRequest): Promise<BgOrderResponse> {
    return this.request<BgOrderResponse>("POST", "/api/v1/orders", { body: order });
  }

  async getOrder(id: number): Promise<BgOrderResponse> {
    return this.request<BgOrderResponse>("GET", `/api/v1/orders/${id}`);
  }
}
