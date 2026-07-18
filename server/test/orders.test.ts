import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyShopifyHmac, type ShopifyOrderWebhook } from "../src/shopify/webhooks";
import { buildBgOrder } from "../src/bg/orders";
import { makeAlerter } from "../src/alerts";
import { createApi } from "../src/api/server";
import type { Config } from "../src/config";

const SECRET = "whsec_test";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(Buffer.from(body)).digest("base64");
}

const order: ShopifyOrderWebhook = {
  id: 5555,
  order_number: 1001,
  email: "buyer@mail.com",
  line_items: [{ sku: "GG-MARM-01", quantity: 1, title: "GG Marmont" }],
  shipping_address: {
    first_name: "Anna",
    last_name: "Rossi",
    address1: "Via Roma 1",
    city: "Milano",
    province_code: "MI",
    zip: "20100",
    country_code: "IT",
  },
};

describe("verifyShopifyHmac", () => {
  it("валидная подпись проходит", () => {
    const body = JSON.stringify(order);
    expect(verifyShopifyHmac(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });
  it("подделка не проходит", () => {
    expect(
      verifyShopifyHmac(Buffer.from("{}"), sign("другое тело"), SECRET)
    ).toBe(false);
  });
  it("без заголовка не проходит", () => {
    expect(verifyShopifyHmac(Buffer.from("{}"), undefined, SECRET)).toBe(false);
  });
});

describe("вебхук /webhooks/shopify/orders", () => {
  const config: Config = {
    botToken: "test",
    defaultCurrency: "EUR",
    port: 0,
    inventoryCap: 1,
    pushBatch: 25,
    shopifyWebhookSecret: SECRET,
  };

  it("правильная подпись → 200 и вызов обработчика", async () => {
    const onShopifyOrder = vi.fn().mockResolvedValue(undefined);
    const app = createApi(config, { onShopifyOrder });
    const body = JSON.stringify(order);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      payload: body,
      headers: {
        "content-type": "application/json",
        "x-shopify-hmac-sha256": sign(body),
      },
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10)); // обработчик асинхронный
    expect(onShopifyOrder).toHaveBeenCalledOnce();
    expect(onShopifyOrder.mock.calls[0][0].order_number).toBe(1001);
  });

  it("неверная подпись → 401, обработчик не вызывается", async () => {
    const onShopifyOrder = vi.fn();
    const app = createApi(config, { onShopifyOrder });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      payload: JSON.stringify(order),
      headers: {
        "content-type": "application/json",
        "x-shopify-hmac-sha256": "невалидная",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(onShopifyOrder).not.toHaveBeenCalled();
  });

  it("без секрета в конфиге роут не регистрируется", async () => {
    const app = createApi({ ...config, shopifyWebhookSecret: undefined }, {});
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/shopify/orders",
      payload: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("buildBgOrder", () => {
  it("собирает запрос: sku → bg_id, адрес с провинцией", async () => {
    const result = await buildBgOrder(order, async (sku) =>
      sku === "GG-MARM-01" ? 7503 : undefined
    );
    expect(result.request).toBeDefined();
    expect(result.request!.order_id).toBe(1001);
    expect(result.request!.line_items).toEqual([{ product_id: 7503, quantity: 1 }]);
    expect(result.request!.shipping[0].state).toBe("MI");
    expect(result.request!.shipping[0].country).toBe("IT");
  });

  it("нет провинции → state = город (BG требует поле)", async () => {
    const noProvince = {
      ...order,
      shipping_address: { ...order.shipping_address!, province_code: undefined },
    };
    const result = await buildBgOrder(noProvince, async () => 7503);
    expect(result.request!.shipping[0].state).toBe("Milano");
  });

  it("неизвестный sku → unmatched, запрос не собирается", async () => {
    const result = await buildBgOrder(order, async () => undefined);
    expect(result.request).toBeUndefined();
    expect(result.unmatched).toEqual(["GG-MARM-01"]);
  });

  it("нет адреса → problem", async () => {
    const noAddr = { ...order, shipping_address: undefined };
    const result = await buildBgOrder(noAddr, async () => 7503);
    expect(result.problem).toMatch(/адрес/);
  });
});

describe("makeAlerter", () => {
  it("шлёт сообщение в Telegram API", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const alert = makeAlerter("TOKEN", "-100123", fetchFn as unknown as typeof fetch);
    await alert("тест");
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("botTOKEN/sendMessage");
    expect(JSON.parse(init.body).chat_id).toBe("-100123");
  });

  it("без chat_id — только warn, без запроса", async () => {
    const fetchFn = vi.fn();
    const alert = makeAlerter("TOKEN", undefined, fetchFn as unknown as typeof fetch);
    await alert("тест");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ошибка сети не роняет процесс", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const alert = makeAlerter("TOKEN", "-1", fetchFn as unknown as typeof fetch);
    await expect(alert("тест")).resolves.toBeUndefined();
  });
});
