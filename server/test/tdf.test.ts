import { describe, it, expect, vi } from "vitest";

// Курс листа «Расчет на 1 товар» (01.10.2026) — на нём посчитаны все примеры ниже.
vi.hoisted(() => {
  process.env.TDF_EUR_USD = "1.1298";
  process.env.TDF_EUR_USD_DATE = "2026-10-01";
});
import { parseFeed, groupProducts, parseMoney } from "../src/tdf/feed";
import { parseBrandRegistry, brandEntry, loadBrandSnapshot } from "../src/tdf/brands";
import { classify } from "../src/tdf/category";
import { evaluate, seasonAge, REVIEW } from "../src/tdf/rules";
import { autoPrice, decidePrice, economics, floorPriceCents, offerUsdCents, toCents, markupFor, markupPriceCents } from "../src/tdf/pricing";
import { estimateCosts, purchaseEurCents, countryCode, retailItalyUsdCents, compareAtCents, dutyRateBp, DEFAULT_COSTS } from "../src/tdf/economics";
import { normalizeSize, sortVariants, productSetInput, productTags, priceProduct, PRICE_AUTO_TAG, PRICE_PENDING_TAG } from "../src/tdf/productInput";
import { planSync, sameHsCode, EXCLUDED_TAG, COST_CHANGED_TAG, BELOW_GRID_TAG, type IndexedProduct } from "../src/tdf/sync";
import { resolveCategory } from "../src/shopify/category";
import { parseMarket, buildMarket } from "../src/tdf/market";
import { subcategoryValues, genderValues, colorFamilies } from "../src/shopify/facets";

// ── Фикстура: две записи одной модели + одна другой ─────────────────────────

function entry(o: Record<string, string>): string {
  const f = {
    id: "SPSFERITOCO/XM_SPORM-001_102-40",
    link: "https://vip.thedoublef.com/products/wide-leg-trousers-sportmax-spsferitoco?variant=55600733028425&amp;utm_source=custom",
    image_link: "https://cdn.shopify.com/a.jpg",
    additional_images: "https://cdn.shopify.com/b.jpg",
    price: "456.15",
    availability: "in stock",
    brand: "Sportmax",
    gender: "female",
    age_group: "adult",
    color: "Beige",
    product_type: "Apparel &amp; Accessories &gt; Clothing &gt; Pants",
    sale_price: "EUR 182.46",
    size: "40  IT",
    material: "Cotton",
    quantity: "1",
    season: "SS26",
    made_in: "Made in Romania",
    title: "Wide-leg trousers in ecru organza cotton voile",
    description: "Wide leg trousers by Sportmax   Color  Ecru   Pure cotton organza voile",
    barcode: "8055403299515",
    hs_code: "",
    ...o,
  };
  return `<entry>${Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</entry>`;
}

const XML = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${[
  entry({}),
  entry({ id: "SPSFERITOCO/XM_SPORM-001_102-38", size: "38 IT", quantity: "2",
    link: "https://vip.thedoublef.com/products/wide-leg-trousers-sportmax-spsferitoco?variant=2" }),
  entry({ id: "KIDS1/X-1", brand: "Bonpoint", age_group: "kids", title: "Kids dress",
    link: "https://vip.thedoublef.com/products/kids-dress?variant=3" }),
].join("")}</feed>`;

const REGISTRY = parseBrandRegistry(
  "supplier_brand,display_name,brand_group,final_status\n" +
    "Sportmax,Sportmax,Max Mara,SHOW\n" +
    "Bonpoint,Bonpoint,Bonpoint,HIDE\n" +
    "Dolce&Gabbana,Dolce & Gabbana,Dolce & Gabbana,HERO\n"
);

describe("фид TheDoubleF", () => {
  it("разбирает записи и собирает варианты в модель по ссылке", () => {
    const variants = parseFeed(XML);
    expect(variants).toHaveLength(3);
    expect(variants[0].productType).toBe("Apparel & Accessories > Clothing > Pants");
    expect(variants[0].supplierVariantId).toBe("55600733028425");
    const products = groupProducts(variants);
    expect(products).toHaveLength(2);
    expect(products[0].variants).toHaveLength(2);
    expect(products[0].images).toEqual(["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"]);
    expect(products[0].link).toBe("https://vip.thedoublef.com/products/wide-leg-trousers-sportmax-spsferitoco");
  });

  it("доп. фото берёт из additional_images и additional_images_2 по порядку", () => {
    const xml = `<feed>${entry({
      additional_images: "https://cdn.shopify.com/b.jpg,https://cdn.shopify.com/c.jpg",
      additional_images_2: "https://cdn.shopify.com/d.jpg, https://cdn.shopify.com/b.jpg",
    })}</feed>`;
    const [p] = groupProducts(parseFeed(xml));
    expect(p.images).toEqual([
      "https://cdn.shopify.com/a.jpg",
      "https://cdn.shopify.com/b.jpg",
      "https://cdn.shopify.com/c.jpg",
      "https://cdn.shopify.com/d.jpg",
    ]);
  });

  it("цена: пусто — null, а не ноль", () => {
    expect(parseMoney("EUR 182.46")).toBe(182.46);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("")).toBeNull();
  });
});

describe("реестр брендов", () => {
  it("снимок таблицы: 266 брендов, HERO/SHOW/HIDE", () => {
    const reg = loadBrandSnapshot();
    expect(reg.size).toBe(266);
    expect(brandEntry(reg, "Dolce&Gabbana")).toMatchObject({ displayName: "Dolce & Gabbana", status: "HERO" });
  });

  it("понимает экспорт листа Google с заголовками над шапкой", () => {
    const reg = parseBrandRegistry(
      ",,\nРеестр брендов,,\nБренд поставщика,Название на сайте,Группа,Моделей,Взрослых,Рекомендация,Финальный статус\n" +
        "HERNO,Herno,Herno,5,5,SHOW,SHOW\n"
    );
    expect(brandEntry(reg, "herno")).toMatchObject({ displayName: "Herno", status: "SHOW" });
  });

  it("неизвестный бренд — DISCUSS (не публикуем без решения)", () => {
    expect(brandEntry(REGISTRY, "Miu Miu x New Balance").status).toBe("DISCUSS");
  });
});

describe("категории → теги витрины в формате BG", () => {
  it.each([
    ["Apparel & Accessories > Shoes", "Black leather Chelsea boots", "Boots - Shoes"],
    ["Apparel & Accessories > Shoes", "Black Victoria décolleté", "Pumps - Shoes"],
    ["Apparel & Accessories", "Le Pliage medium tote bag", "Handbags - Bags"],
    ["Apparel & Accessories", "Falabella mini crossbody bag", "Shoulder Bags - Bags"],
    ["Apparel & Accessories", "Black leather card holder", "Wallets - Accessories"],
    ["Apparel & Accessories", "Black silk midi dress", "Dresses - Clothing"],
    ["Apparel & Accessories", "Black Victoria décolleté with crocodile print", "Pumps - Shoes"],
    ["Apparel & Accessories", "Navy silk tie with Gancini print", "Ties - Accessories"],
    ["Apparel & Accessories > Clothing > Shirts & Tops", "Grey wool cardigan", "Cardigans - Sweaters - Clothing"],
    ["Apparel & Accessories > Clothing > Pants", "Straight-leg blue jeans", "Jeans Denim - Clothing"],
    ["Apparel & Accessories > Clothing > Outerwear > Coats & Jackets", "Wool coat", "Jackets - Clothing"],
  ])("%s | %s → %s", (type, title, tag) => {
    expect(classify(type, title)?.tags.at(-1)).toBe(tag);
  });

  it("цепочка совпадает с тем, что понимают категоризатор и фильтры", () => {
    const tags = classify("Apparel & Accessories > Clothing > Shirts & Tops", "Grey wool cardigan")!.tags;
    expect(tags).toEqual(["Clothing", "Sweaters - Clothing", "Cardigans - Sweaters - Clothing"]);
    expect(resolveCategory(tags)?.productType).toBe("Cardigans");
    expect(subcategoryValues(tags)).toContain("Sweaters");
  });

  it("общая категория без подсказки в названии — null (на проверку)", () => {
    expect(classify("Apparel & Accessories", "Miss Z Sling Empire")).toBeNull();
  });
});

describe("правила отбора R01–R29", () => {
  const [trousers, kids] = groupProducts(parseFeed(XML));

  it("взрослая модель SHOW-бренда текущего сезона — импорт с пометкой о таможне", () => {
    const e = evaluate(trousers, REGISTRY);
    expect(e.include).toBe(true);
    expect(e.reviewTags).toEqual([REVIEW.customs]);
    expect(e.heroCandidate).toBe(false);
  });

  it("детское и бренд HIDE — не импортируем", () => {
    const e = evaluate(kids, REGISTRY);
    expect(e.include).toBe(false);
    expect(e.skipReasons.join()).toMatch(/R01/);
    expect(e.skipReasons.join()).toMatch(/R03/);
  });

  it("сезоны: прошлый — на проверку, старый — скрыть, будущий — актуален", () => {
    expect(evaluate({ ...trousers, season: "FW25" }, REGISTRY).reviewTags).toContain(REVIEW.season);
    expect(evaluate({ ...trousers, season: "FW24" }, REGISTRY).include).toBe(false);
    expect(evaluate({ ...trousers, season: "SS27" }, REGISTRY).include).toBe(true);
    expect(seasonAge("SS25")! < seasonAge("FW25")!).toBe(true);
  });

  it("прайс ниже €150 — basics, не импортируем; sale_price = 0 — на проверку", () => {
    expect(evaluate({ ...trousers, price: 120 }, REGISTRY).include).toBe(false);
    expect(evaluate({ ...trousers, salePrice: 0 }, REGISTRY).reviewTags).toContain(REVIEW.noDiscount);
  });

  it("HERO-кандидат требует 4 фото — с 2 фото из фида не проходит", () => {
    const hero = { ...trousers, brand: "Dolce&Gabbana", price: 900 };
    expect(evaluate(hero, REGISTRY).heroCandidate).toBe(false);
    const img = (n: number) => Array.from({ length: n }, (_, i) => `https://x/${i}.jpg`);
    expect(evaluate({ ...hero, images: img(4) }, REGISTRY).heroCandidate).toBe(true);
  });
});

// ── Pricing Logic v1.0: лист «Тесты приёмки» ────────────────────────────────

/** Комиссия v1.0 из листа «Тесты приёмки»: 2,9% + $0,30 (v3.0 по умолчанию — 2,7%). */
const V1_FEE = { rateBp: 290, fixedCents: 30 };

describe("Pricing Logic v1.0 — тесты приёмки T01–T16", () => {
  const cases: [string, number | null, number | null, number | null, string, number, number | null, number | null][] = [
    // id,   farfetch, italist, затраты, решение,            скидка‰, цена,     остаток
    ["T01", 2000, 2000, 1300, "KEEP_BASE", 0, 2000, 641.7],
    ["T02", 2000, 2100, 1300, "TEST_2_5", 25, 1998.75, 640.49],
    ["T03", 2000, 2200, 1300, "TEST_5", 50, 1995, 636.84],
    ["T04", 2000, 3000, 1300, "MANUAL_PRICE", 0, 2500, 1127.2],
    ["T05", 2000, 2100, 1600, "MANUAL_MARGIN", 0, 2050, 390.25],
    ["T06", 900, 900, 750, "MANUAL_MARGIN", 0, 900, 123.6],
    ["T07", 2000, null, 1300, "MANUAL_ONE_SOURCE", 0, 2000, 641.7],
    ["T08", null, null, 1300, "MANUAL_DATA", 0, null, null],
    ["T09", 999.99, 999.99, 500, "KEEP_BASE", 0, 999.99, 470.69],
    ["T10", 1000, 1000, 500, "KEEP_BASE", 0, 1000, 470.7],
    ["T11", 2499.99, 2499.99, 1500, "KEEP_BASE", 0, 2499.99, 927.19],
    ["T12", 2500, 2500, 1500, "KEEP_BASE", 0, 2500, 927.2],
    ["T13", 2553.04, 2553.04, 2070.09, "MANUAL_MARGIN", 0, 2553.04, 408.61],
    ["T14", 2000, 2100, null, "MANUAL_DATA", 0, null, null],
    ["T15", 970, 1070, 600, "TEST_5", 50, 969, 340.6],
    ["T16", 2440, 2640, 1600, "TEST_5", 50, 2413, 742.72],
  ];

  it.each(cases)("%s", (_id, ff, it_, costs, decision, permille, price, remaining) => {
    const r = decidePrice({
      farfetchCents: ff === null ? null : toCents(ff),
      italistCents: it_ === null ? null : toCents(it_),
      directCostsCents: costs === null ? null : toCents(costs),
      fee: V1_FEE,
    });
    expect(r.decision).toBe(decision);
    expect(r.discountPermille).toBe(permille);
    expect(r.candidate ? r.candidate.priceCents : null).toBe(price === null ? null : toCents(price));
    expect(r.candidate ? r.candidate.remainingCents : null).toBe(remaining === null ? null : toCents(remaining));
  });

  it("границы диапазонов по конечной цене", () => {
    expect(economics(99_999, 0).band.minRemainingCents).toBe(4_000);
    expect(economics(100_000, 0).band.minRemainingCents).toBe(20_000);
    expect(economics(250_000, 0).band.minRemainingCents).toBe(45_000);
  });

  it("минимальная цена по сетке проходит её, а цент ниже — нет", () => {
    const costs = toCents(217.48);
    const floor = floorPriceCents(costs);
    expect(economics(floor, costs).passes).toBe(true);
    expect(economics(floor - 1, costs).passes).toBe(false);
  });
});

describe("автоматическая цена при импорте", () => {
  it("нет цен конкурентов — минимум сетки в целых долларах", () => {
    // Брюки Sportmax из фикстуры: закупка €182,46 → $206,14, пошлина 22% $45,35, $35 + $25.
    const p = autoPrice(31_149, undefined, V1_FEE)!;
    expect(p.method).toBe("GRID");
    expect(p.decision).toBe("MANUAL_DATA");
    expect(p.priceCents).toBe(40_500);
    expect(p.economics.remainingCents).toBe(8_146);
    expect(p.economics.passes).toBe(true);
  });

  it("на всём диапазоне затрат: целые доллары, сетка пройдена, доллар ниже — нет", () => {
    for (let costs = 5_000; costs < 400_000; costs += 731) {
      const p = autoPrice(costs)!.priceCents;
      expect(p % 100).toBe(0);
      expect(economics(p, costs).passes).toBe(true);
      expect(economics(p - 100, costs).passes).toBe(false);
      // Минимум сетки — действительно минимум: округление комиссии не сдвигает его на цент вверх.
      expect(economics(floorPriceCents(costs) - 1, costs).passes).toBe(false);
    }
  });

  const us = (usd: number, currency = "USD", country = "US") => ({ totalCents: toCents(usd), currency, country });

  it("есть автоматическое рыночное решение — берём его (T02: минус 2,5%)", () => {
    const p = autoPrice(toCents(1300), { farfetch: us(2000), italist: us(2100) })!;
    expect(p.method).toBe("MARKET");
    expect(p.decision).toBe("TEST_2_5");
    expect(p.priceCents).toBe(toCents(1998.75));
  });

  it("цена Farfetch в фунтах или евро в расчёт не идёт — остаётся один источник", () => {
    for (const currency of ["GBP", "EUR", ""]) {
      const p = autoPrice(toCents(1300), { farfetch: us(1600, currency), italist: us(2100) })!;
      expect(p.method).toBe("GRID");
      expect(p.decision).toBe("MANUAL_ONE_SOURCE");
      expect(p.reason).toContain("Farfetch исключён: валюта");
    }
  });

  it("доллары не той витрины (CA, AU, HK) тоже исключаются", () => {
    const p = autoPrice(toCents(1300), { farfetch: us(2000), italist: us(2100, "USD", "GB") })!;
    expect(p.decision).toBe("MANUAL_ONE_SOURCE");
    expect(p.reason).toContain("Italist исключён: витрина GB");
    expect(offerUsdCents({ totalCents: 200_000, currency: "usd", country: "us" }).cents).toBe(200_000);
  });

  it("рынок не проходит сетку (T05) — цена по сетке, не по рынку", () => {
    const p = autoPrice(toCents(1600), { farfetch: us(2000), italist: us(2100) })!;
    expect(p.method).toBe("GRID");
    expect(p.decision).toBe("MANUAL_MARGIN");
    expect(economics(p.priceCents, toCents(1600)).passes).toBe(true);
  });

  it("затраты неизвестны — цены нет (не ноль)", () => {
    expect(autoPrice(null)).toBeNull();
  });
});

describe("затраты — пример с листа «Расчет на 1 товар»", () => {
  it("закупка €100, одежда, Италия: $112,98 + пошлина 22% $24,86 + доставка $20 + сбор DHL $17,5 (v3.0)", () => {
    const c = estimateCosts(120, 100, classify("Apparel & Accessories > Clothing > Pants", "Pants"), "Made in Italy")!;
    expect(c.purchaseUsdCents).toBe(11_298);
    expect(c.dutyCents).toBe(2_486);
    expect(c.directCostsCents).toBe(11_298 + 2_486 + 2_000 + 1_750);
    // Комиссия v3.0: 2,7% + $0,30 → $3,96 при цене $135,58.
    expect(economics(13_558, c.directCostsCents).feeCents).toBe(396);
  });

  it("sale_price = 0 → закупка = price; пропуск — null", () => {
    expect(purchaseEurCents(120, 0)).toBe(12_000);
    expect(purchaseEurCents(120, null)).toBeNull();
    expect(purchaseEurCents(null, 0)).toBeNull();
  });

  it("не ЕС — консервативные 30%", () => {
    const c = estimateCosts(200, 100, null, "Made in China")!;
    expect(c.dutyBp).toBe(3000);
    expect(countryCode("Made in United Kingdom")).toBe("GB");
  });
});

describe("товар для Shopify", () => {
  const [trousers] = groupProducts(parseFeed(XML));
  const e = evaluate(trousers, REGISTRY);

  it("размеры нормализуются и сортируются", () => {
    expect(normalizeSize("40  IT")).toBe("40 IT");
    expect(normalizeSize("38,5 IT")).toBe("38.5 IT");
    expect(normalizeSize("U")).toBe("One Size");
    expect(sortVariants([{ size: "L" }, { size: "XS" }, { size: "M" }]).map((v) => v.size)).toEqual(["XS", "M", "L"]);
  });

  it("черновик с автоматической ценой, закупка — в себестоимости", () => {
    const input = productSetInput(e, { locationId: "gid://shopify/Location/1", inventoryCap: 1 });
    expect(input.status).toBe("DRAFT");
    expect(input.vendor).toBe("Sportmax");
    expect(input.variants.map((v) => v.optionValues[0].name)).toEqual(["38 IT", "40 IT"]);
    expect(input.variants.every((v) => v.price === "328.00")).toBe(true);
    // Розница в Италии: €456,15 + НДС 22% = €556,50 × 1,1298 = $628,73 → $629.
    expect(input.variants.every((v) => v.compareAtPrice === "629.00")).toBe(true);
    expect(input.tags).toContain(PRICE_AUTO_TAG);
    expect(input.tags).not.toContain(PRICE_PENDING_TAG);
    const pricing = JSON.parse(input.metafields.find((m) => m.key === "pricing")!.value);
    // v3.0: затраты $288,99 (закупка $206,14 + пошлина 22% + $20 + $17,5), закупка < $300 → наценка 10%:
    // ($288,99 + $0,30) × 1,1 / (1 − 2,7% × 1,1) = $327,95 → $328.
    expect(pricing).toMatchObject({ policy_version: "3.0", method: "MARKUP", price_usd: 328, remaining_usd: 29.85, markup: 0.1 });
    expect(input.variants[0].inventoryItem.cost).toBe((Math.round(18_246 * 1.1298) / 100).toFixed(2));
    // Правило «отдавать 1»: в фиде 2, в магазине 1.
    expect(input.variants[0].inventoryQuantities[0].quantity).toBe(1);
    expect(input.descriptionHtml).toContain('class="ie-description"');
    expect(input.descriptionHtml).toContain("<li>Color: Ecru</li>");
    expect(input.productType).toBe("Pants");
  });

  it("нет закупки — цена 0 и price:pending", () => {
    const broken = evaluate({ ...trousers, salePrice: null }, REGISTRY);
    const input = productSetInput(broken, { locationId: "gid://shopify/Location/1" });
    expect(input.variants.every((v) => v.price === "0.00")).toBe(true);
    expect(input.tags).toContain(PRICE_PENDING_TAG);
    expect(input.metafields.some((m) => m.key === "pricing")).toBe(false);
  });

  it("теги понимают фильтры витрины: пол, подкатегория, цвет", () => {
    const tags = productTags(e, true);
    expect(tags).toEqual(expect.arrayContaining(["tdf", "EU", "Women", "designer:sportmax", "Pants - Clothing", PRICE_AUTO_TAG]));
    expect(genderValues(tags)).toEqual(["Women"]);
    expect(subcategoryValues(tags)).toEqual(["Pants"]);
    expect(colorFamilies({ title: trousers.title, vendor: "Sportmax", tags })).toEqual(["Beige"]);
  });
});

describe("план синхронизации — трогаем только поля поставщика", () => {
  const [trousers] = groupProducts(parseFeed(XML));
  const e = evaluate(trousers, REGISTRY);

  function shopProduct(over: Partial<IndexedProduct> = {}): IndexedProduct {
    return {
      id: "gid://shopify/Product/1",
      handle: trousers.key,
      status: "DRAFT",
      tags: ["tdf", "review:customs", "price:auto", "manual-tag"],
      key: trousers.key,
      autoPriceCents: 32_800,
      variants: new Map([
        ["SPSFERITOCO/XM_SPORM-001_102-40", {
          id: "v40", sku: "SPSFERITOCO/XM_SPORM-001_102-40", quantity: 1,
          inventoryItemId: "ii40", costCents: Math.round(18_246 * 1.1298), priceCents: 32_800,
          compareAtCents: 62_900, hsCode: null, countryCode: "RO",
        }],
      ]),
      ...over,
    };
  }

  function withPrice(priceCents: number): IndexedProduct {
    const p = shopProduct();
    const v = p.variants.get("SPSFERITOCO/XM_SPORM-001_102-40")!;
    p.variants.set(v.sku, { ...v, priceCents });
    return p;
  }

  it("R24: HS-код из фида дописывается существующим вариантам, пометка снимается", () => {
    const withHs = evaluate({
      ...trousers,
      hsCode: "62046239",
      variants: trousers.variants.map((v) => ({ ...v, hsCode: "62046239" })),
    }, REGISTRY);
    const plan = planSync([withHs], new Map([[trousers.key, shopProduct()]]));
    expect(plan.customs).toEqual([{ inventoryItemId: "ii40", harmonizedSystemCode: "62046239" }]);
    expect(plan.tags[0].remove).toContain("review:customs");
  });

  it("код уже записан (в т. ч. Shopify хранит 6 знаков) — повторно не пишем; пустой в фиде не стирает", () => {
    const withHs = evaluate({
      ...trousers,
      hsCode: "62046239",
      variants: trousers.variants.map((v) => ({ ...v, hsCode: "62046239" })),
    }, REGISTRY);
    const stored = (hs: string) => {
      const p = shopProduct();
      const v = p.variants.get("SPSFERITOCO/XM_SPORM-001_102-40")!;
      p.variants.set(v.sku, { ...v, hsCode: hs });
      return new Map([[trousers.key, p]]);
    };
    expect(planSync([withHs], stored("62046239")).customs).toEqual([]);
    expect(planSync([withHs], stored("620462")).customs).toEqual([]);
    expect(planSync([e], stored("620462")).customs).toEqual([]);
    expect(sameHsCode("62046239", "6204.62")).toBe(true);
    expect(sameHsCode("62046239", "6203")).toBe(false);
  });

  it("новая модель — в создание; существующая — нет", () => {
    expect(planSync([e], new Map()).create).toHaveLength(1);
    expect(planSync([e], new Map([[trousers.key, shopProduct()]])).create).toHaveLength(0);
  });

  it("новый размер добавляется, лишних изменений нет", () => {
    const plan = planSync([e], new Map([[trousers.key, shopProduct()]]), { inventoryCap: 1 });
    expect(plan.newVariants[0].variants.map((v) => v.size)).toEqual(["38 IT"]);
    expect(plan.newVariants[0].priceCents).toBe(32_800);
    expect(plan.quantities).toEqual([]);
    expect(plan.costs).toEqual([]);
    expect(plan.prices).toEqual([]);
    expect(plan.tags).toEqual([]);
  });

  it("модель пропала из фида: остаток 0 и пометка, ручные теги не трогаем", () => {
    const plan = planSync([], new Map([[trousers.key, shopProduct()]]));
    expect(plan.quantities).toEqual([{ inventoryItemId: "ii40", quantity: 0, from: 1 }]);
    expect(plan.tags[0].add).toEqual([EXCLUDED_TAG]);
    expect(plan.tags[0].remove).toEqual(["review:customs"]);
  });

  it("закупка изменилась, цена автоматическая — себестоимость и цена пересчитаны", () => {
    const changed = evaluate({ ...trousers, salePrice: 150 }, REGISTRY);
    const plan = planSync([changed], new Map([[trousers.key, shopProduct()]]));
    expect(plan.costs[0]).toEqual({ inventoryItemId: "ii40", costCents: Math.round(15_000 * 1.1298) });
    const expected = priceProduct(changed.product, changed.category).price!.priceCents;
    expect(expected).toBe(27_800);
    expect(plan.prices).toEqual([expect.objectContaining({ productId: "gid://shopify/Product/1", variantIds: ["v40"] })]);
    expect(plan.prices[0].price.priceCents).toBe(expected);
    expect(plan.newVariants[0].priceCents).toBe(expected);
    expect(plan.tags.flatMap((t) => t.add)).not.toContain(COST_CHANGED_TAG);
  });

  it("закупка изменилась, цена ручная — цену не трогаем, пометка на проверку", () => {
    const changed = evaluate({ ...trousers, salePrice: 150 }, REGISTRY);
    const plan = planSync([changed], new Map([[trousers.key, withPrice(52_000)]]));
    expect(plan.prices).toEqual([]);
    expect(plan.newVariants[0].priceCents).toBe(52_000);
    expect(plan.tags[0].add).toContain(COST_CHANGED_TAG);
    expect(plan.tags[0].remove).toContain(PRICE_AUTO_TAG);
  });

  it("ручная цена ниже формулы v3.0 — пометка review:below-grid", () => {
    const plan = planSync([e], new Map([[trousers.key, withPrice(30_000)]]));
    expect(plan.prices).toEqual([]);
    expect(plan.tags[0].add).toContain(BELOW_GRID_TAG);
  });

  it("товар без цены (0, price:pending) — цена ставится, пометки меняются", () => {
    const pending = { ...withPrice(0), tags: ["tdf", "review:customs", "price:pending"], autoPriceCents: null };
    const plan = planSync([e], new Map([[trousers.key, pending]]));
    expect(plan.prices[0].price.priceCents).toBe(32_800);
    expect(plan.tags[0].add).toContain(PRICE_AUTO_TAG);
    expect(plan.tags[0].remove).toContain(PRICE_PENDING_TAG);
  });
});

describe("категории — случаи, найденные на живом фиде", () => {
  it.each([
    ["Apparel & Accessories > Clothing > Shirts & Tops", "White crew-neck T-shirt with pendant", "Shirts - Clothing"],
    ["Apparel & Accessories > Clothing Accessories > Belts", "Belted Tote Bag in Dark Brown Cotton Canvas", "Handbags - Bags"],
    ["Apparel & Accessories > Shoes", "Bing 100 ballet pink patent leather mules", "Mules - Shoes"],
    ["Apparel & Accessories > Shoes", "Black leather ballet flats", "Flats - Shoes"],
  ])("%s | %s → %s", (type, title, tag) => {
    expect(classify(type, title)?.tags.at(-1)).toBe(tag);
  });
});

describe("цвет — из описания, а не из ненадёжного поля фида", () => {
  it("сине-белое поло с color=Black в фиде → Blue, White", async () => {
    const { colorTags, descriptionColor } = await import("../src/tdf/productInput");
    const p = groupProducts(parseFeed(XML))[0];
    const polo = { ...p, color: "Black", description: "Striped cotton polo by Ami Paris   Color  Ink blue White   Short sleeves" };
    expect(descriptionColor(polo.description)).toBe("Ink blue White");
    expect(colorTags(polo)).toEqual(["Blue", "White"]);
    expect(colorTags({ ...p, description: "No color line" })).toEqual(["Beige"]);
  });
});

describe("описание — «&» в имени бренда, вырезанный поставщиком", () => {
  it("«by Dolce   Gabbana» не разваливается на два пункта", async () => {
    const { descriptionHtml } = await import("../src/tdf/productInput");
    const p = groupProducts(parseFeed(XML))[0];
    const dg = { ...p, brand: "Dolce&Gabbana", description: "Bouquet print chiffon dress by Dolce   Gabbana   Color  Multicolour   Smocked waistband" };
    const html = descriptionHtml(dg, "Dolce & Gabbana");
    expect(html).toContain("<p>Bouquet print chiffon dress by Dolce &amp; Gabbana.</p>");
    expect(html).not.toContain("<li>Gabbana</li>");
  });
});

describe("описание — диакритика в имени бренда", () => {
  it("«by Chlo in silk» → «by Chloé in silk»", async () => {
    const { descriptionHtml } = await import("../src/tdf/productInput");
    const p = groupProducts(parseFeed(XML))[0];
    const html = descriptionHtml({ ...p, brand: "Chloé", description: "Knee length skirt by Chlo in silk   Color  Green" }, "Chloé");
    expect(html).toContain("<p>Knee length skirt by Chloé in silk.</p>");
  });
});

describe("категория по HS-коду — случаи из фида 13.10.2026", () => {
  it.each([
    ["Apparel & Accessories > Shoes", "Black Loafer bifold wallet", "42023100", "Wallets - Accessories"],
    ["Apparel & Accessories > Shoes", "Elongated Loafer cabas bag in black leather", "42022100", "Handbags - Bags"],
    ["Apparel & Accessories > Shoes", "Black washed-effect Boot Cut jeans", "62046231", "Jeans Denim - Clothing"],
    ["Apparel & Accessories > Shoes", "Black Derby jacket in cotton moleskin", "62033290", "Jackets - Clothing"],
    ["Apparel & Accessories", "Mini Rockstud Spike top-handle bag in black leather", "42022100", "Handbags - Bags"],
    ["Apparel & Accessories > Handbags", "Camel bucket hat in virgin wool", "65059010", "Hats - Accessories"],
    ["Apparel & Accessories", "Jeannette wedge clogs in suede calfskin", "64035999", "Clogs - Shoes"],
    ["Apparel & Accessories", "Short dress with floral waist belt", "62044200", "Dresses - Clothing"],
    ["Apparel & Accessories > Handbags", "Horseshoe Bag Charm in Sand Check", "42023290", "Bag Charms - Accessories"],
    ["Apparel & Accessories > Handbags", "Black Charm bag in croc-effect patent leather", "42022100", "Handbags - Bags"],
    ["Apparel & Accessories > Handbags", "Black clutch bag with chain strap", "42023100", "Clutch Bags - Bags"],
    // Ошибка поставщика: обувной код у картхолдера — решает название.
    ["Apparel & Accessories", "White leather Rockstud zip card holder", "64039998", "Wallets - Accessories"],
    // Мех (глава 43) не используем: у поставщика под ним и ботинки.
    ["Apparel & Accessories > Shoes", "Dark brown ponyskin ankle boots", "43039000", "Boots - Shoes"],
  ])("%s | %s (%s) → %s", (type, title, hs, tag) => {
    expect(classify(type, title, hs)?.tags.at(-1)).toBe(tag);
  });

  it("без кода — как раньше, по фиду", () => {
    expect(classify("Apparel & Accessories > Shoes", "Black Derby jacket in cotton moleskin")?.section).toBe("Shoes");
  });
});

describe("перенос в категорию по HS-коду в синке", () => {
  const [base] = groupProducts(parseFeed(XML));
  const jeans = { ...base, productType: "Apparel & Accessories > Shoes", title: "Black washed-effect Boot Cut jeans" };
  const legacyTags = ["tdf", "EU", "Women", "Shoes", "Boots - Shoes", "price:auto"];
  const shop = (tags: string[]): IndexedProduct => ({
    id: "gid://shopify/Product/9", handle: jeans.key, status: "ACTIVE", tags, key: jeans.key,
    autoPriceCents: null, variants: new Map(),
  });

  it("товар с исходными тегами переносится: теги, Product type, Category", () => {
    const e = evaluate({ ...jeans, hsCode: "62046231" }, REGISTRY);
    const plan = planSync([e], new Map([[jeans.key, shop(legacyTags)]]));
    expect(plan.categories).toHaveLength(1);
    expect(plan.categories[0].add).toEqual(["Clothing", "Jeans Denim - Clothing"]);
    expect(plan.categories[0].remove).toEqual(["Shoes", "Boots - Shoes"]);
    expect(plan.categories[0].productType).toBeTruthy();
  });

  it("категорию правил менеджер — не трогаем", () => {
    const e = evaluate({ ...jeans, hsCode: "62046231" }, REGISTRY);
    const manual = ["tdf", "EU", "Women", "Clothing", "Pants - Clothing", "price:auto"];
    expect(planSync([e], new Map([[jeans.key, shop(manual)]])).categories).toEqual([]);
  });
});

describe("зачёркнутая цена — розница в Италии с НДС (вариант B)", () => {
  it("price поставщика + 22% НДС по курсу, до целого доллара", () => {
    expect(retailItalyUsdCents(456.15)).toBe(62_900);
    expect(retailItalyUsdCents(null)).toBeNull();
  });

  it("показываем, только если розница выше нашей цены больше чем на 1%", () => {
    expect(compareAtCents(62_900, 40_500)).toBe(62_900);
    expect(compareAtCents(62_900, 62_500)).toBeNull(); // 0,6% — округление, не скидка
    expect(compareAtCents(62_900, 70_000)).toBeNull(); // мы дороже — без зачёркнутой
    expect(compareAtCents(null, 40_500)).toBeNull();
  });

  it("синк ставит недостающую и снимает лишнюю зачёркнутую цену", () => {
    const [p] = groupProducts(parseFeed(XML));
    const e = evaluate(p, REGISTRY);
    const variant = (compareAt: number | null) => new Map([["SPSFERITOCO/XM_SPORM-001_102-40", {
      id: "v40", sku: "SPSFERITOCO/XM_SPORM-001_102-40", quantity: 1, inventoryItemId: "ii40",
      costCents: Math.round(18_246 * 1.1298), priceCents: 40_500, compareAtCents: compareAt, hsCode: null, countryCode: "RO",
    }]]);
    const shop = (compareAt: number | null, priceCents = 40_500): IndexedProduct => {
      const variants = variant(compareAt);
      variants.get("SPSFERITOCO/XM_SPORM-001_102-40")!.priceCents = priceCents;
      return { id: "gid://shopify/Product/1", handle: p.key, status: "ACTIVE", tags: ["tdf", "price:auto"], key: p.key,
        autoPriceCents: priceCents === 40_500 ? 40_500 : 12_345, variants };
    };
    expect(planSync([e], new Map([[p.key, shop(null)]])).compareAts)
      .toEqual([{ productId: "gid://shopify/Product/1", variants: [{ id: "v40", compareAtCents: 62_900 }] }]);
    expect(planSync([e], new Map([[p.key, shop(62_900)]])).compareAts).toEqual([]);
    // Ручная цена выше розницы — зачёркнутую снимаем.
    expect(planSync([e], new Map([[p.key, shop(62_900, 70_000)]])).compareAts)
      .toEqual([{ productId: "gid://shopify/Product/1", variants: [{ id: "v40", compareAtCents: null }] }]);
  });
});

describe("пошлина по HS-коду (тариф США, сделка США–ЕС)", () => {
  const shoes = classify("Apparel & Accessories > Shoes", "Leather sneakers");
  const cloth = classify("Apparel & Accessories > Clothing > Pants", "Pants");
  it.each([
    ["кожаная обувь из ЕС: MFN 10% → минимум сделки 15%", shoes, "IT", "64039998", 1500],
    ["синтетические брюки из ЕС: MFN 28,6% > 15% → MFN", cloth, "IT", "62046300", 2860],
    ["хлопковые брюки из ЕС: MFN 16,6%", cloth, "PT", "62046231", 1660],
    ["кожаная обувь не из ЕС: не ниже прежних 30%", shoes, "CN", "64039998", 3000],
    ["синтетический трикотаж не из ЕС: MFN 32% выше 30%", cloth, "CN", "61099020", 3200],
    ["код с точками тоже распознаётся", shoes, "IT", "6403.99.98", 1500],
    ["кода нет — оценка по группе (обувь ЕС 25%)", shoes, "IT", "", 2500],
  ])("%s", (_name, category, country, hs, bp) => {
    expect(dutyRateBp(category, country, DEFAULT_COSTS, hs)).toBe(bp);
  });

  it("основание пошлины видно в расчёте", () => {
    expect(estimateCosts(500, 300, shoes, "Made in Italy", DEFAULT_COSTS, "64039998")!.dutyBasis).toBe("HTS");
    expect(estimateCosts(500, 300, shoes, "Made in Italy")!.dutyBasis).toBe("estimate");
  });
});

describe("цены конкурентов (data/tdf-market.csv)", () => {
  const CSV =
    "model_code,competitor,total_usd,currency,country,checked_at,url,note\n" +
    "spsferitoco,farfetch,\"1,000.00\",USD,US,2026-10-10,,\n" +
    "SPSFERITOCO,farfetch,950.00,USD,US,2026-10-14,,свежее\n" +
    "SPSFERITOCO,italist,\"1 020,00\",USD,US,2026-10-14,,\n" +
    "OLDMODEL,farfetch,500,USD,US,2026-09-01,,устарело\n" +
    "EURMODEL,farfetch,500,EUR,IT,2026-10-14,,\n" +
    "BAD,amazon,10,USD,US,2026-10-14,,\n";
  const now = new Date("2026-10-16T12:00:00Z");

  it("разбор: артикул в верхнем регистре, суммы в разных форматах, лишние конкуренты пропускаются", () => {
    const rows = parseMarket(CSV);
    expect(rows.map((r) => r.offer.totalCents)).toEqual([100_000, 95_000, 102_000, 50_000, 50_000]);
    expect(rows[0].modelCode).toBe("SPSFERITOCO");
  });

  it("берём последнее предложение конкурента; старше 14 дней — не берём", () => {
    const table = buildMarket(parseMarket(CSV), now);
    expect(table.get("SPSFERITOCO")?.farfetch?.totalCents).toBe(95_000);
    expect(table.get("SPSFERITOCO")?.italist?.totalCents).toBe(102_000);
    expect(table.has("OLDMODEL")).toBe(false);
  });

  it("рыночный режим v1.0 по-прежнему считается (autoPrice), но цену товара в v3.0 не задаёт", () => {
    const [p] = groupProducts(parseFeed(XML));
    const e = evaluate(p, REGISTRY);
    const market = buildMarket(parseMarket(CSV), now);
    // Два пригодных предложения $950 и $1 020 → база $985; −5% = $935,75 ≤ ориентира $950 → TEST_5.
    const m = autoPrice(31_149, market.get("SPSFERITOCO"), V1_FEE)!;
    expect(m.decision).toBe("TEST_5");
    expect(m.priceCents).toBe(93_575);
    // Цена товара — по v3.0, с ценами конкурентов и без.
    expect(priceProduct(e.product, e.category, undefined, market).price!.method).toBe("MARKUP");
    expect(priceProduct(e.product, e.category).price!.priceCents).toBe(32_800);
  });

  it("предложение в евро или не с американской версии — не учитывается", () => {
    const market = buildMarket(parseMarket(CSV), now);
    const p = autoPrice(31_149, market.get("EURMODEL"))!;
    expect(p.method).toBe("GRID");
    expect(p.reason).toContain("валюта EUR");
  });
});

describe("Pricing Logic v3.0 — наценка на все расходы", () => {
  it("сетка наценки по закупке: до $300 — 10%, дальше 15%", () => {
    expect(markupFor(29_999).markupBp).toBe(1000);
    expect(markupFor(30_000).markupBp).toBe(1500);
    expect(markupFor(300_000).markupBp).toBe(1500);
  });

  it("примеры из таблицы v3.0", () => {
    // Эспадрильи Off-White: закупка $185,66, пошлина 15% (ЕС), +$20 +$17,5 → $251,01; ×1,1 с комиссией → $285.
    expect(markupPriceCents(25_101, 18_566)).toBe(28_500);
    // Поло Balenciaga: закупка $636,53, пошлина 19,7% → $799,43; ×1,15 с комиссией → $950.
    expect(markupPriceCents(79_943, 63_653)).toBe(95_000);
  });

  it("цена покрывает все расходы с наценкой (комиссия — от самой цены); на доллар дешевле — уже нет", () => {
    for (let buy = 5_000; buy < 400_000; buy += 913) {
      const direct = Math.round(buy * 1.15) + 3_750;
      const k = 10_000 + markupFor(buy).markupBp;
      const covers = (price: number) => price * 10_000 >= (direct + economics(price, direct).feeCents) * k;
      const p = markupPriceCents(direct, buy);
      expect(p % 100).toBe(0);
      expect(covers(p)).toBe(true);
      expect(covers(p - 100)).toBe(false);
    }
  });
});
