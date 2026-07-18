import { describe, it, expect, vi } from "vitest";
import { RateLimiter } from "../src/bg/rateLimiter";
import { prettyRound, computeOurPrice, multiplierFor } from "../src/bg/pricing";
import {
  mapProduct,
  detectWarehouse,
  totalStock,
  wholesalePrice,
  cappedStock,
} from "../src/bg/mapProduct";
import { chunk } from "../src/bg/sync";
import { BgClient } from "../src/bg/client";
import type { BgProduct } from "../src/bg/types";

describe("RateLimiter", () => {
  it("пропускает до capacity без ожидания", () => {
    let t = 0;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect(rl.msUntilToken()).toBe(0);
  });

  it("считает ожидание, когда токены кончились", async () => {
    let t = 0;
    const slept: number[] = [];
    const rl = new RateLimiter(
      2,
      60_000,
      () => t,
      async (ms) => {
        slept.push(ms);
        t += ms;
      }
    );
    await rl.acquire(); // 2 → 1
    await rl.acquire(); // 1 → 0
    await rl.acquire(); // ждём пополнения
    expect(slept.length).toBe(1);
    expect(slept[0]).toBeGreaterThan(0);
  });

  it("пополняется со временем", () => {
    let t = 0;
    const rl = new RateLimiter(60, 60_000, () => t); // 1 токен/сек
    rl["tokens"] = 0;
    t = 5000; // прошло 5 секунд → ~5 токенов
    expect(rl.msUntilToken()).toBe(0);
  });
});

describe("prettyRound", () => {
  it("до 5 при цене < 100", () => {
    expect(prettyRound(47)).toBe(50);
    expect(prettyRound(41)).toBe(45);
  });
  it("до 10 при цене >= 100", () => {
    expect(prettyRound(342)).toBe(350);
    expect(prettyRound(1791)).toBe(1800);
  });
  it("ноль и отрицательное → 0", () => {
    expect(prettyRound(0)).toBe(0);
    expect(prettyRound(-5)).toBe(0);
  });
});

describe("pricing", () => {
  it("дефолтная наценка", () => {
    expect(multiplierFor("Gucci", { defaultMultiplier: 1.8 })).toBe(1.8);
  });
  it("наценка по бренду (регистронезависимо)", () => {
    const rules = { defaultMultiplier: 1.8, byBrand: { gucci: 2.2 } };
    expect(multiplierFor("GUCCI", rules)).toBe(2.2);
    expect(multiplierFor("Prada", rules)).toBe(1.8);
  });
  it("считает нашу цену с округлением", () => {
    expect(computeOurPrice(1000, "Gucci", { defaultMultiplier: 1.8 })).toBe(1800);
  });
});

const sampleProduct = (over: Partial<BgProduct> = {}): BgProduct => ({
  id: 7503,
  sku: "GG-123",
  name: "GG Marmont small shoulder bag",
  regular_price: 1200,
  sale_price: 1000,
  stock_quantity: 3,
  brand: { id: 1, name: "Gucci" },
  updated_at: "2026-07-14T10:00:00Z",
  ...over,
});

describe("mapProduct", () => {
  it("sale_price приоритетнее regular_price", () => {
    expect(wholesalePrice(sampleProduct())).toBe(1000);
    expect(wholesalePrice(sampleProduct({ sale_price: undefined }))).toBe(1200);
  });

  it("суммирует остаток по вариациям", () => {
    const p = sampleProduct({
      stock_quantity: undefined,
      variations: [
        { id: 1, sku: "a", stock_quantity: 2 },
        { id: 2, sku: "b", stock_quantity: 5 },
      ],
    });
    expect(totalStock(p)).toBe(7);
  });

  it("cap ограничивает остаток (правило «отдавать 1»)", () => {
    expect(cappedStock(7, 1)).toBe(1);
    expect(cappedStock(0, 1)).toBe(0);
    expect(cappedStock(7, undefined)).toBe(7);
  });

  it("полный маппинг с наценкой и cap", () => {
    const row = mapProduct(sampleProduct(), {
      pricing: { defaultMultiplier: 1.8 },
      inventoryCap: 1,
    });
    expect(row.bg_id).toBe(7503);
    expect(row.brand).toBe("Gucci");
    expect(row.wholesale_price).toBe(1000);
    expect(row.our_price).toBe(1800);
    expect(row.stock).toBe(1); // 3 → cap 1
  });
});

describe("detectWarehouse", () => {
  it("US по meta location", () => {
    const p = sampleProduct({ meta_data: [{ key: "location", value: "Florida" }] });
    expect(detectWarehouse(p)).toBe("us");
  });
  it("EU по meta location", () => {
    const p = sampleProduct({ meta_data: [{ key: "location", value: "Milan, Italy" }] });
    expect(detectWarehouse(p)).toBe("eu");
  });
  it("нет данных → null", () => {
    expect(detectWarehouse(sampleProduct({ meta_data: [] }))).toBeNull();
  });
});

describe("chunk", () => {
  it("бьёт по размеру", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("пустой массив", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});

describe("BgClient (мок fetch)", () => {
  const creds = {
    baseUrl: "https://nova.shopwoo.com",
    email: "u@e.com",
    password: "pw",
    storeId: 42,
  };
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("шлёт basic auth и store_id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson([]));
    const client = new BgClient(creds, { fetchFn });
    await client.getProducts();
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("store_id=42");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("пагинация: две полные страницы + хвост", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, sku: `s${i}`, name: "n" }));
    const page2 = [{ id: 999, sku: "last", name: "n" }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(okJson(page1))
      .mockResolvedValueOnce(okJson(page2));
    const client = new BgClient(creds, { fetchFn });
    const all: number[] = [];
    for await (const p of client.iterateProducts()) all.push(p.id);
    expect(all).toHaveLength(101);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("ретраит 503 и потом отдаёт результат", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(okJson([{ id: 1, sku: "s", name: "n" }]));
    const client = new BgClient(creds, {
      fetchFn,
      sleep: async () => {}, // без реальных пауз
    });
    const res = await client.getProducts();
    expect(res).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("не ретраит 400 — сразу кидает", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const client = new BgClient(creds, { fetchFn, sleep: async () => {} });
    await expect(client.getProducts()).rejects.toThrow(/HTTP 400/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("checkStatuses не пускает больше 1000 id", async () => {
    const client = new BgClient(creds, { fetchFn: vi.fn() });
    await expect(
      client.checkStatuses(Array.from({ length: 1001 }, (_, i) => i))
    ).rejects.toThrow(/1000/);
  });
});
