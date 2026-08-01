import { describe, it, expect } from "vitest";
import { createApi } from "../src/api/server";
import { compare } from "../src/compare";
import type { Config } from "../src/config";
import type { ProductInfo } from "../src/types";

const config: Config = {
  botToken: "test",
  defaultCurrency: "EUR",
  port: 0,
  inventoryCap: 1,
  pushBatch: 25,
  importMode: "app",
  botEnabled: false,
};

describe("HTTP API", () => {
  it("GET /health отвечает ok", async () => {
    const app = createApi(config);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("POST /api/lookup без designer — 400", async () => {
    const app = createApi(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/lookup",
      payload: { title: "GG Marmont" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/lookup с отрицательной ценой — 400", async () => {
    const app = createApi(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/lookup",
      payload: { title: "GG Marmont", designer: "Gucci", ourPrice: -5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("compare", () => {
  const info = (price?: number, currency?: string): ProductInfo => ({
    title: "x",
    url: "https://x.com",
    images: [],
    price,
    currency,
    source: "jsonld",
  });
  const req = { title: "x", designer: "y", ourPrice: 990, currency: "EUR" };

  it("считает процент выгоды при одинаковой валюте", () => {
    const c = compare(req, info(1790, "EUR"));
    expect(c.savingsPercent).toBe(45);
  });

  it("не сравнивает разные валюты", () => {
    const c = compare(req, info(2600, "usd"));
    expect(c.savingsPercent).toBeUndefined();
    expect(c.brandCurrency).toBe("USD");
  });

  it("не хвастается, если наша цена выше", () => {
    const c = compare({ ...req, ourPrice: 2000 }, info(1790, "EUR"));
    expect(c.savingsPercent).toBeUndefined();
  });

  it("без цены бренда — просто наша цена", () => {
    const c = compare(req, info());
    expect(c.brandPrice).toBeUndefined();
    expect(c.savingsPercent).toBeUndefined();
  });
});
