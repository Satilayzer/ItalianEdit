import { describe, it, expect } from "vitest";
import {
  computeProductAttrs,
  materialFromDescription,
  materialGroup,
  planProductAttrs,
  COLOR_ENTRIES,
  MATERIAL_ENTRIES,
  MATERIAL_LABELS,
} from "../src/shopify/googleProduct";
import { COLOR_FAMILIES } from "../src/shopify/facets";
import { googleProductStore } from "../src/shopify/googleProductStore";
import { ShopifyClient } from "../src/shopify/client";

const cat = (id: string) => `gid://shopify/TaxonomyCategory/${id}`;

describe("googleProduct: таблица метаобъектов", () => {
  it("цвет есть у каждого семейства facets.ts", () => {
    for (const f of COLOR_FAMILIES) expect(COLOR_ENTRIES[f]).toMatch(/^gid:\/\/shopify\/Metaobject\/\d+$/);
  });

  it("GID материалов совпадают с выданными Shopify (выборочно)", () => {
    expect(MATERIAL_ENTRIES.fabric.Cotton).toBe("gid://shopify/Metaobject/647586939111");
    expect(MATERIAL_ENTRIES.fabric.Metal).toBe("gid://shopify/Metaobject/647587463399");
    expect(MATERIAL_ENTRIES["footwear-material"].Suede).toBe("gid://shopify/Metaobject/647587791079");
    expect(MATERIAL_ENTRIES["bag-case-material"].PVC).toBe("gid://shopify/Metaobject/647588610279");
    expect(MATERIAL_ENTRIES["clothing-accessory-material"]["Faux fur"]).toBe("gid://shopify/Metaobject/647589200103");
    expect(Object.keys(MATERIAL_ENTRIES.fabric)).toHaveLength(MATERIAL_LABELS.length);
  });
});

describe("materialFromDescription", () => {
  it("строка «Material: …» из описания TDF", () => {
    expect(materialFromDescription("<ul><li>Color: Red</li><li>Material: Wool</li></ul>")).toBe("Wool");
    expect(materialFromDescription("<li>Material:  Eco leather </li>")).toBe("Faux leather");
    expect(materialFromDescription("<li>Material: Eco fur</li>")).toBe("Faux fur");
    expect(materialFromDescription("<li>Material: PVC</li>")).toBe("PVC");
  });

  it("неоднозначное и отсутствующее — null", () => {
    expect(materialFromDescription("<li>Material: Natural fibers</li>")).toBeNull();
    expect(materialFromDescription("<li>Material: Jewellery</li>")).toBeNull();
    expect(materialFromDescription("<p>no details</p>")).toBeNull();
    expect(materialFromDescription(null)).toBeNull();
  });
});

describe("materialGroup", () => {
  it("по ветке таксономии", () => {
    expect(materialGroup(cat("aa-1-13-7"))).toBe("fabric");
    expect(materialGroup(cat("aa-2-17"))).toBe("fabric");
    expect(materialGroup(cat("aa-2"))).toBe("fabric");
    expect(materialGroup(cat("aa-8-8"))).toBe("footwear-material");
    expect(materialGroup(cat("aa-5-4-19"))).toBe("bag-case-material");
    expect(materialGroup(cat("lb-1"))).toBe("bag-case-material");
    expect(materialGroup(cat("aa-5-5"))).toBe("clothing-accessory-material");
    expect(materialGroup(cat("aa-2-6"))).toBe("clothing-accessory-material");
  });

  it("свои атрибуты или нет категории — null", () => {
    expect(materialGroup(cat("aa-2-27"))).toBeNull(); // очки
    expect(materialGroup(cat("aa-2-13"))).toBeNull(); // перчатки
    expect(materialGroup(cat("aa-4-8"))).toBeNull(); // брелоки
    expect(materialGroup(cat("aa-6-8"))).toBeNull(); // украшения
    expect(materialGroup(cat("aa-10"))).toBeNull(); // не путать с aa-1
    expect(materialGroup(null)).toBeNull();
  });
});

describe("computeProductAttrs / planProductAttrs", () => {
  it("кроссовки: два цвета и материал обуви", () => {
    expect(
      computeProductAttrs({
        categoryId: cat("aa-8-8"),
        descriptionHtml: "<li>Material: Leather</li>",
        colorFacet: '["Purple","White"]',
      })
    ).toEqual({
      "color-pattern": JSON.stringify([COLOR_ENTRIES.Purple, COLOR_ENTRIES.White]),
      "footwear-material": JSON.stringify([MATERIAL_ENTRIES["footwear-material"].Leather]),
    });
  });

  it("без цвета и с непонятным материалом — пусто", () => {
    expect(
      computeProductAttrs({ categoryId: cat("aa-1-4"), descriptionHtml: "<li>Material: Natural fibers</li>", colorFacet: null })
    ).toEqual({});
  });

  it("пишем только расхождения", () => {
    const wanted = { "color-pattern": '["a"]', fabric: '["b"]' };
    expect(planProductAttrs(wanted, { "color-pattern": '["a"]', fabric: null })).toEqual([{ key: "fabric", value: '["b"]' }]);
  });
});

describe("googleProductStore", () => {
  it("пишет metafieldsSet с типом list.metaobject_reference, dry-run — ничего", async () => {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const node = {
      id: "gid://shopify/Product/1",
      title: "Boots",
      descriptionHtml: "<li>Material: Suede</li>",
      category: { id: cat("aa-8-3") },
      colorFacet: { value: '["Black"]' },
      color_pattern: null,
      fabric: null,
      footwear_material: null,
      bag_case_material: null,
      clothing_accessory_material: null,
    };
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      const data = body.query.includes("metafieldsSet")
        ? { metafieldsSet: { userErrors: [] } }
        : { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node] } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new ShopifyClient({ shop: "x.myshopify.com", adminToken: "t" }, fetchFn);

    const dry = await googleProductStore(client, { dryRun: true });
    expect(dry.updated).toBe(1);
    expect(calls).toHaveLength(1);

    const stats = await googleProductStore(client);
    expect(stats.updated).toBe(1);
    const write = calls.find((c) => c.query.includes("metafieldsSet"))!;
    expect(write.variables.metafields).toEqual([
      { ownerId: node.id, namespace: "shopify", key: "color-pattern", type: "list.metaobject_reference", value: JSON.stringify([COLOR_ENTRIES.Black]) },
      {
        ownerId: node.id,
        namespace: "shopify",
        key: "footwear-material",
        type: "list.metaobject_reference",
        value: JSON.stringify([MATERIAL_ENTRIES["footwear-material"].Suede]),
      },
    ]);
  });
});
