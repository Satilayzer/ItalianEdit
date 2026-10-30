import { describe, it, expect } from "vitest";
import {
  catalogSection,
  computeGoogle,
  discountLabel,
  googleAgeGroup,
  googleCondition,
  googleGender,
  googleMpn,
  googleSizeSystem,
  marginTier,
  planGoogle,
  priceTier,
} from "../src/shopify/google";
import { googleStoreProducts } from "../src/shopify/googleStoreProducts";
import { ShopifyClient } from "../src/shopify/client";

describe("google: атрибуты по тегам", () => {
  it("пол — значения Google", () => {
    expect(googleGender(["Women", "EU"])).toBe("female");
    expect(googleGender(["Men"])).toBe("male");
    expect(googleGender(["Women", "Men"])).toBe("unisex");
    expect(googleGender(["EU"])).toBeNull();
  });

  it("возраст: взрослый, детский — только по тегу", () => {
    expect(googleAgeGroup(["Women"])).toBe("adult");
    expect(googleAgeGroup(["Kids"])).toBe("kids");
  });

  it("состояние: б/у только по тегу, «vintage» в названии не считается", () => {
    expect(googleCondition(["Women", "Clothing"])).toBe("new");
    expect(googleCondition(["Pre-owned"])).toBe("used");
    expect(googleCondition(["used"])).toBe("used");
  });

  it("раздел — по самому частному тегу", () => {
    expect(catalogSection(["Shoes", "Sneakers - Shoes"])).toBe("Shoes");
    // шум BG: у сумки висит и Accessories
    expect(catalogSection(["Accessories", "Shoulder Bags - Bags"])).toBe("Bags");
    expect(catalogSection(["EU", "Women"])).toBeNull();
  });
});

describe("google: MPN, размер, labels", () => {
  it("MPN — Style Code из SKU TheDoubleF", () => {
    expect(googleMpn("MXSPALOMBACO/XM_MAXM-001_102-40")).toBe("MXSPALOMBACO");
    expect(googleMpn("263-WAS0313LE0210/XN_TOTEM-001_500-37")).toBe("263-WAS0313LE0210");
    expect(googleMpn("J-PARIGI10B340372/XN_TAGLT-ET951_102-48")).toBe("J-PARIGI10B340372");
    expect(googleMpn("SOMESKU")).toBeNull();
    expect(googleMpn(null)).toBeNull();
  });

  it("система размеров — по суффиксу сетки", () => {
    expect(googleSizeSystem("38 IT")).toBe("IT");
    expect(googleSizeSystem("38.5 IT")).toBe("IT");
    expect(googleSizeSystem("6 UK")).toBe("UK");
    expect(googleSizeSystem("36 FR")).toBe("FR");
    expect(googleSizeSystem("36 DK")).toBe("EU");
    expect(googleSizeSystem("CUSTOM")).toBeNull();
    expect(googleSizeSystem("M")).toBeNull();
    expect(googleSizeSystem("29")).toBeNull();
    expect(googleSizeSystem("One Size")).toBeNull();
  });

  it("ценовой диапазон, скидка, маржа", () => {
    expect(priceTier(384)).toBe("usd-0-500");
    expect(priceTier(1000)).toBe("usd-1000-2000");
    expect(priceTier(2500)).toBe("usd-2000-plus");
    expect(priceTier(0)).toBeNull();
    expect(discountLabel("384.00", "706.00")).toBe("sale-30-50");
    expect(discountLabel("373.00", "882.00")).toBe("sale-50-plus");
    expect(discountLabel("100.00", null)).toBe("full-price");
    expect(marginTier('{"margin":0.0909}')).toBe("margin-low");
    expect(marginTier('{"margin":0.1316}')).toBe("margin-mid");
    expect(marginTier('{"margin":0.2012}')).toBe("margin-high");
    expect(marginTier(null)).toBeNull();
    expect(marginTier("not json")).toBeNull();
  });
});

const sneaker = {
  tags: ["designer:moncler", "EU", "Purple", "Shoes", "Sneakers - Shoes", "tdf", "White", "Women"],
  pricing: '{"margin":0.0909}',
};
const variant = {
  sku: "4M00130M8443/XM_MONCL-60Q_500-36",
  price: "384.00",
  compareAtPrice: "706.00",
  selectedOptions: [{ name: "Size", value: "36 IT" }],
};

describe("computeGoogle / planGoogle", () => {
  it("полный набор для кроссовок", () => {
    expect(computeGoogle(sneaker, variant)).toEqual({
      gender: "female",
      age_group: "adult",
      condition: "new",
      mpn: "4M00130M8443",
      size_system: "IT",
      custom_label_0: "shoes",
      custom_label_1: "usd-0-500",
      custom_label_2: "sale-30-50",
      custom_label_3: "margin-low",
    });
  });

  it("пишем только расхождения и ничего не удаляем", () => {
    const wanted = computeGoogle(sneaker, variant);
    const current = { ...wanted, custom_label_2: "sale-50-plus", custom_label_4: "manual" };
    expect(planGoogle(wanted, current)).toEqual([{ key: "custom_label_2", value: "sale-30-50" }]);
    expect(planGoogle({ mpn: undefined }, { mpn: "MANUAL" })).toEqual([]);
  });
});

describe("googleStoreProducts", () => {
  function fakeClient(variants: unknown[]) {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      const data = body.query.includes("productVariantsBulkUpdate")
        ? { productVariantsBulkUpdate: { userErrors: [] } }
        : { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: variants } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    return { client: new ShopifyClient({ shop: "x.myshopify.com", adminToken: "t" }, fetchFn), calls };
  }

  const node = (id: string, current: Record<string, string>) => ({
    id,
    title: "36 IT",
    ...variant,
    product: { id: "gid://shopify/Product/1", title: "Trailgrip", tags: sneaker.tags, pricing: { value: sneaker.pricing } },
    metafields: { nodes: Object.entries(current).map(([key, value]) => ({ key, value })) },
  });

  it("dry-run ничего не пишет и отдаёт план", async () => {
    const { client, calls } = fakeClient([node("gid://shopify/ProductVariant/1", {})]);
    const stats = await googleStoreProducts(client, { dryRun: true });
    expect(calls).toHaveLength(1);
    expect(stats.updated).toBe(1);
    expect(stats.plan[0].set).toHaveLength(9);
  });

  it("варианты одного товара — одним запросом; совпадающие пропускаем", async () => {
    const full = computeGoogle(sneaker, variant) as Record<string, string>;
    const { client, calls } = fakeClient([
      node("gid://shopify/ProductVariant/1", {}),
      node("gid://shopify/ProductVariant/2", { ...full, gender: "male" }),
      node("gid://shopify/ProductVariant/3", full),
    ]);
    const stats = await googleStoreProducts(client);
    expect(stats.updated).toBe(2);
    const writes = calls.filter((c) => c.query.includes("productVariantsBulkUpdate"));
    expect(writes).toHaveLength(1);
    const sent = writes[0].variables.variants as { id: string; metafields: { key: string; value: string }[] }[];
    expect(sent.map((v) => v.id)).toEqual(["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"]);
    expect(sent[1].metafields).toEqual([
      { namespace: "mm-google-shopping", key: "gender", type: "single_line_text_field", value: "female" },
    ]);
  });
});
