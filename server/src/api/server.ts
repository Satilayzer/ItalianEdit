import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "../config";
import type { ManagerRequest } from "../types";
import { findProduct } from "../search/findProduct";
import { compare } from "../compare";
import {
  verifyShopifyHmac,
  type ShopifyOrderWebhook,
} from "../shopify/webhooks";

export interface ApiHooks {
  /** Обработчик оплаченного заказа из Shopify (вызывается после проверки подписи). */
  onShopifyOrder?: (order: ShopifyOrderWebhook) => Promise<void>;
}

interface LookupBody {
  title: string;
  designer: string;
  ourPrice?: number;
  currency?: string;
}

const lookupBodySchema = {
  type: "object",
  required: ["title", "designer"],
  properties: {
    title: { type: "string", minLength: 2 },
    designer: { type: "string", minLength: 2 },
    ourPrice: { type: "number", exclusiveMinimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
  },
  additionalProperties: false,
} as const;

export function createApi(config: Config, hooks: ApiHooks = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

  // Вебхук Shopify: нужен СЫРОЙ body для проверки HMAC-подписи,
  // поэтому у роута свой парсер в изолированном скоупе.
  if (config.shopifyWebhookSecret) {
    const secret = config.shopifyWebhookSecret;
    app.register(async (scope) => {
      scope.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => done(null, body)
      );
      scope.post("/webhooks/shopify/orders", async (req, reply) => {
        const raw = req.body as Buffer;
        const hmac = req.headers["x-shopify-hmac-sha256"] as string | undefined;
        if (!verifyShopifyHmac(raw, hmac, secret)) {
          return reply.code(401).send({ ok: false });
        }
        // Shopify ждёт быстрый 200 — обработку не задерживаем ответом.
        let order: ShopifyOrderWebhook;
        try {
          order = JSON.parse(raw.toString("utf8"));
        } catch {
          return reply.code(400).send({ ok: false });
        }
        if (hooks.onShopifyOrder) {
          hooks.onShopifyOrder(order).catch((err) =>
            console.error("Ошибка обработки заказа из вебхука:", err)
          );
        }
        return { ok: true };
      });
    });
  }

  /**
   * Поиск товара на сайте дизайнера.
   * POST /api/lookup { title, designer, ourPrice?, currency? }
   * 200 → { found: true, product, comparison? }
   * 404 → { found: false }
   */
  app.post<{ Body: LookupBody }>(
    "/api/lookup",
    { schema: { body: lookupBodySchema } },
    async (req, reply) => {
      const { title, designer, ourPrice, currency } = req.body;
      const request: ManagerRequest = {
        title,
        designer,
        ourPrice: ourPrice ?? 0,
        currency: (currency ?? config.defaultCurrency).toUpperCase(),
      };

      const result = await findProduct(request, config);
      if (!result.info) {
        return reply.code(404).send({ found: false, reason: result.failure });
      }
      return {
        found: true,
        product: result.info,
        comparison: ourPrice !== undefined ? compare(request, result.info) : undefined,
      };
    }
  );

  return app;
}
