import { describe, it, expect } from "vitest";
import { parseFeed, groupProducts } from "../src/tdf/feed";
import { parseBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct } from "../src/tdf/productInput";
import { compareAtCents, retailItalyUsdCents } from "../src/tdf/economics";
import { autoPublishBrands, publishCandidates, publishProblems } from "../src/tdf/publish";
import type { IndexedProduct, IndexedVariant } from "../src/tdf/sync";

const ENTRY = {
  id: "GG1/X-40",
  link: "https://vip.thedoublef.com/products/gg-loafer?variant=1",
  image_link: "https://cdn.shopify.com/a.jpg",
  price: "800.00",
  availability: "in stock",
  brand: "GUCCI",
  gender: "female",
  age_group: "adult",
  color: "Black",
  product_type: "Apparel &amp; Accessories &gt; Shoes",
  sale_price: "EUR 420.00",
  size: "40",
  quantity: "1",
  season: "FW26",
  made_in: "Made in Italy",
  title: "Black leather loafers",
  description: "Loafers",
  hs_code: "64035195",
};

function feed(o: Record<string, string> = {}) {
  const f = { ...ENTRY, ...o };
  const xml = `<feed><entry>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</entry></feed>`;
  return groupProducts(parseFeed(xml))[0];
}

const REGISTRY = parseBrandRegistry(
  "supplier_brand,display_name,brand_group,final_status\nGUCCI,Gucci,Kering,HERO\nSportmax,Sportmax,Max Mara,SHOW\n"
);

/** Товар магазина, у которого всё как посчитал бы синк. */
function shopFor(e: ReturnType<typeof evaluate>, over: Partial<IndexedVariant> = {}): IndexedProduct {
  const { costs, price } = priceProduct(e.product, e.category);
  const priceCents = price!.priceCents;
  const v = {
    id: "v1", sku: "GG1/X-40", title: "40", quantity: 1, inventoryItemId: "ii1",
    costCents: costs!.purchaseUsdCents, priceCents,
    compareAtCents: compareAtCents(retailItalyUsdCents(e.product.price), priceCents),
    hsCode: "640351", countryCode: "IT", ...over,
  };
  return {
    id: "gid://shopify/Product/1", handle: e.product.key, status: "DRAFT", tags: ["tdf"], key: e.product.key,
    autoPriceCents: priceCents, variants: new Map([[v.sku, v]]),
  };
}

describe("автопубликация черновиков TheDoubleF", () => {
  const e = evaluate(feed(), REGISTRY);

  it("по умолчанию — Gucci, Prada, Saint Laurent; пустая переменная выключает", () => {
    expect([...autoPublishBrands(undefined)]).toEqual(["gucci", "prada", "saint laurent"]);
    expect(autoPublishBrands("").size).toBe(0);
    expect([...autoPublishBrands(" Gucci , Fendi ")]).toEqual(["gucci", "fendi"]);
  });

  it("цена, зачёркнутая, себестоимость и остаток сходятся — публикуем", () => {
    const shop = shopFor(e);
    expect(publishProblems(shop, e)).toEqual([]);
    expect(publishCandidates(new Map([[shop.key, shop]]), [e], new Set(["gucci"]))).toHaveLength(1);
  });

  it("чужой бренд и уже активный товар не трогаем", () => {
    const shop = shopFor(e);
    expect(publishCandidates(new Map([[shop.key, shop]]), [e], new Set(["prada"]))).toHaveLength(0);
    const active = { ...shop, status: "ACTIVE" };
    expect(publishCandidates(new Map([[shop.key, active]]), [e], new Set(["gucci"]))).toHaveLength(0);
  });

  it("цена не по формуле (как 03.11.2026 — пошлина по группе) — остаётся черновиком", () => {
    const shop = shopFor(e);
    const v = [...shop.variants.values()][0];
    const wrong = shopFor(e, { priceCents: v.priceCents + 4_000 });
    expect(publishProblems(wrong, e).map((p) => p.kind)).toContain("цена");
  });

  it("фид без HS-кода — не публикуем", () => {
    const noHs = evaluate(feed({ hs_code: "" }), REGISTRY);
    expect(publishProblems(shopFor(noHs), noHs).map((p) => p.kind)).toContain("нет HS-кода");
  });

  it("без скидки и без остатка — не публикуем", () => {
    // Закупка почти равна рознице: наша цена выше розничной, зачёркнутой нет.
    const thin = evaluate(feed({ sale_price: "EUR 790.00" }), REGISTRY);
    expect(publishProblems(shopFor(thin), thin).map((p) => p.kind)).toContain("нет скидки");
    expect(publishProblems(shopFor(e, { quantity: 0 }), e).map((p) => p.kind)).toContain("нет остатка");
  });

  it("нет в фиде — не публикуем", () => {
    expect(publishProblems(shopFor(e), undefined)).toEqual([{ kind: "нет в фиде" }]);
  });
});
