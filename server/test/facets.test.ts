import { describe, it, expect, vi } from "vitest";
import {
  colorFamiliesIn,
  colorFamilies,
  genderValues,
  subcategoryValues,
  saleBand,
  priceBand,
} from "../src/shopify/facets";
import { planFacets, facetStoreProducts } from "../src/shopify/facetStoreProducts";
import { ShopifyClient } from "../src/shopify/client";

describe("colorFamiliesIn — оттенок сводится к семейству", () => {
  it("изумрудный, салатовый, оливковый — всё зелёное", () => {
    expect(colorFamiliesIn("Emerald")).toEqual(["Green"]);
    expect(colorFamiliesIn("Lime")).toEqual(["Green"]);
    expect(colorFamiliesIn("Olive")).toEqual(["Green"]);
    expect(colorFamiliesIn("Bottle Green")).toEqual(["Green"]);
    expect(colorFamiliesIn("изумрудный")).toEqual(["Green"]);
    expect(colorFamiliesIn("Салатовый")).toEqual(["Green"]);
  });

  it("оттенки других семейств", () => {
    expect(colorFamiliesIn("Bordeaux")).toEqual(["Red"]);
    expect(colorFamiliesIn("Navy")).toEqual(["Blue"]);
    expect(colorFamiliesIn("Ecru")).toEqual(["Beige"]);
    expect(colorFamiliesIn("Fuchsia")).toEqual(["Pink"]);
    expect(colorFamiliesIn("Anthracite")).toEqual(["Grey"]);
    expect(colorFamiliesIn("Cognac")).toEqual(["Brown"]);
  });

  it("фраза важнее слов: rose gold — золото, off-white — белый", () => {
    expect(colorFamiliesIn("Rose Gold")).toEqual(["Gold"]);
    expect(colorFamiliesIn("Off-White")).toEqual(["White"]);
    expect(colorFamiliesIn("off white")).toEqual(["White"]);
  });

  it("несколько цветов — по порядку, без повторов", () => {
    expect(colorFamiliesIn("Black/White")).toEqual(["Black", "White"]);
    expect(colorFamiliesIn("Navy Blue & Light Blue")).toEqual(["Blue"]);
  });

  it("слово внутри другого слова — не цвет", () => {
    expect(colorFamiliesIn("Blackberry")).toEqual([]);
    expect(colorFamiliesIn("Redwood")).toEqual([]);
  });

  it("strict: двусмысленные слова из названия не берём", () => {
    expect(colorFamiliesIn("Natural Leather Tote", true)).toEqual([]);
    expect(colorFamiliesIn("Denim Jacket", true)).toEqual([]);
    expect(colorFamiliesIn("Denim Jacket")).toEqual(["Blue"]);
  });
});

describe("colorFamilies — источники по доверию", () => {
  it("опция Color важнее тегов и названия", () => {
    expect(
      colorFamilies({
        title: "Black Bag",
        tags: ["Pink"],
        options: [{ name: "Color", values: ["Emerald", "Lime"] }],
      })
    ).toEqual(["Green"]);
  });

  it("тег цвета BG важнее случайного слова в названии", () => {
    expect(
      colorFamilies({ title: "Shoulder Bag with Gold Hardware", tags: ["Black", "Women", "EU"] })
    ).toEqual(["Black"]);
  });

  it("служебные теги не дают цвет", () => {
    expect(
      colorFamilies({ title: "Loafers", tags: ["designer:golden goose", "Sandals - Shoes", "EU37/US7"] })
    ).toEqual([]);
  });

  it("цвет из описания BG, если в тегах нет", () => {
    expect(
      colorFamilies({ title: "Platform Sandals", tags: ["Women"], descriptionColor: "Emerald Green" })
    ).toEqual(["Green"]);
  });

  it("название без имени бренда: Off-White и Golden Goose — не цвет", () => {
    expect(colorFamilies({ title: "Off-White Arrow Hoodie", vendor: "Off-White", tags: [] })).toEqual([]);
    expect(
      colorFamilies({ title: "Golden Goose Burgundy Sneakers", vendor: "Golden Goose", tags: [] })
    ).toEqual(["Red"]);
  });

  it("больше трёх семейств — Multicolor", () => {
    expect(
      colorFamilies({ title: "Scarf", tags: [], options: [{ name: "Colour", values: ["Red", "Blue", "Green", "Yellow"] }] })
    ).toEqual(["Multicolor"]);
  });
});

describe("genderValues", () => {
  it("Women / Men / унисекс / дети", () => {
    expect(genderValues(["Women", "Bags"])).toEqual(["Women"]);
    expect(genderValues(["Men"])).toEqual(["Men"]);
    expect(genderValues(["Women", "Men"])).toEqual(["Women", "Men"]);
    expect(genderValues(["category:kids"])).toEqual(["Kids"]);
    expect(genderValues(["EU"])).toEqual([]);
  });
});

describe("subcategoryValues", () => {
  it("второй уровень иерархии BG", () => {
    expect(subcategoryValues(["Shoes", "Sandals - Shoes", "Platforms - Sandals - Shoes"])).toEqual([
      "Sandals",
    ]);
    expect(subcategoryValues(["Jeans Denim - Clothing"])).toEqual(["Jeans"]);
    expect(subcategoryValues(["Necklaces - Jewellery - Accessories"])).toEqual(["Jewelry"]);
  });

  it("верхний уровень — не подкатегория", () => {
    expect(subcategoryValues(["Shoes", "Women"])).toEqual([]);
    expect(subcategoryValues(["category:clothing", "category:dresses"])).toEqual(["Dresses"]);
    expect(subcategoryValues(["category:matching-sets"])).toEqual(["Matching Sets"]);
  });
});

describe("saleBand", () => {
  it("полоса по самому выгодному варианту", () => {
    expect(saleBand([{ price: "100", compareAtPrice: null }])).toBeNull();
    expect(saleBand([{ price: "80", compareAtPrice: "100" }])).toBe("Up to 30% off");
    expect(saleBand([{ price: "60", compareAtPrice: "100" }])).toBe("30–50% off");
    expect(
      saleBand([
        { price: "90", compareAtPrice: "100" },
        { price: "40", compareAtPrice: "100" },
      ])
    ).toBe("50%+ off");
  });

  it("compare-at не выше цены — не скидка", () => {
    expect(saleBand([{ price: "100", compareAtPrice: "100" }])).toBeNull();
    expect(saleBand([{ price: "100", compareAtPrice: "90" }])).toBeNull();
  });
});

describe("priceBand", () => {
  it("диапазон по самой низкой цене", () => {
    expect(priceBand([1842.95])).toBe("1000-2000");
    expect(priceBand([499.99])).toBe("0-500");
    expect(priceBand([500])).toBe("500-1000");
    expect(priceBand([6200, 2400])).toBe("2000-5000");
    expect(priceBand([12000])).toBe("5000+");
  });

  it("цены нет — диапазона нет", () => {
    expect(priceBand([])).toBeNull();
    expect(priceBand([NaN])).toBeNull();
  });
});

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Product/1",
    title: "Emerald Leather Shoulder Bag",
    vendor: "Gucci",
    tags: ["Women", "Bags", "Shoulder Bags - Bags"],
    descriptionHtml: "",
    options: [{ name: "Title", values: ["Default Title"] }],
    variants: { nodes: [{ price: "700", compareAtPrice: "1000" }] },
    rawDescription: null,
    gender: null,
    subcategory: null,
    color: null,
    sale: null,
    price_band: null,
    ...overrides,
  };
}

describe("planFacets", () => {
  it("пустые метаполя → пишем все вычисленные", () => {
    const plan = planFacets(product());
    expect(plan.remove).toEqual([]);
    expect(plan.set).toEqual([
      { key: "gender", value: '["Women"]' },
      { key: "subcategory", value: '["Shoulder Bags"]' },
      { key: "color", value: '["Green"]' },
      { key: "sale", value: "30–50% off" },
    ]);
  });

  it("евро-цена рынка → диапазон price_band", () => {
    const plan = planFacets(
      product({
        variants: {
          nodes: [{ price: "1000", compareAtPrice: null, contextualPricing: { price: { amount: "908.00" } } }],
        },
      })
    );
    expect(plan.set).toContainEqual({ key: "price_band", value: "500-1000" });
  });

  it("всё совпадает → ничего не делаем", () => {
    const plan = planFacets(
      product({
        gender: { value: '["Women"]' },
        subcategory: { value: '["Shoulder Bags"]' },
        color: { value: '["Green"]' },
        sale: { value: "30–50% off" },
      })
    );
    expect(plan).toEqual({ set: [], remove: [] });
  });

  it("скидку сняли → метаполе sale удаляем", () => {
    const plan = planFacets(
      product({
        variants: { nodes: [{ price: "1000", compareAtPrice: null }] },
        gender: { value: '["Women"]' },
        subcategory: { value: '["Shoulder Bags"]' },
        color: { value: '["Green"]' },
        sale: { value: "30–50% off" },
      })
    );
    expect(plan).toEqual({ set: [], remove: ["sale"] });
  });
});

describe("facetStoreProducts", () => {
  it("пишет метаполя пачкой и считает обновлённые товары", async () => {
    const calls: { query: string; variables: any }[] = [];
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (body.query.includes("FacetProducts")) {
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  product(),
                  product({
                    id: "gid://shopify/Product/2",
                    title: "Mystery Item",
                    tags: [],
                    variants: { nodes: [{ price: "10", compareAtPrice: null }] },
                  }),
                ],
              },
            },
          })
        );
      }
      return new Response(JSON.stringify({ data: { metafieldsSet: { userErrors: [] } } }));
    });

    const client = new ShopifyClient({ shop: "x.myshopify.com", adminToken: "t" }, fetchFn as any);
    const stats = await facetStoreProducts(client);

    expect(stats.scanned).toBe(2);
    expect(stats.updated).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.colorless).toEqual(["Mystery Item"]);

    const set = calls.find((c) => c.query.includes("FacetSet"));
    expect(set?.variables.metafields).toHaveLength(4);
    expect(set?.variables.metafields[0]).toMatchObject({
      ownerId: "gid://shopify/Product/1",
      namespace: "italian_edit",
      key: "gender",
      type: "list.single_line_text_field",
    });
    expect(calls.some((c) => c.query.includes("FacetDelete"))).toBe(false);
  });
});
