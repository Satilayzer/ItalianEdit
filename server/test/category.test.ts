import { describe, it, expect, vi } from "vitest";
import { resolveCategory, categoryPatch } from "../src/shopify/category";
import { categorizeStoreProducts } from "../src/shopify/categorizeStoreProducts";
import { ShopifyClient } from "../src/shopify/client";

/** Короткая запись: сравниваем по хвосту gid, а не по всей строке. */
function node(assignment: { taxonomyId: string } | null): string | null {
  return assignment ? (assignment.taxonomyId.split("/").pop() ?? null) : null;
}

describe("resolveCategory", () => {
  it("второй уровень BG побеждает верхний", () => {
    // «Green Plexiglass Platform Sandals» — теги как в живом каталоге
    const hit = resolveCategory([
      "Shoes",
      "Sandals - Shoes",
      "Platforms - Sandals - Shoes",
      "Women",
      "EU",
    ]);
    expect(node(hit)).toBe("aa-8-6");
    expect(hit?.productType).toBe("Sandals");
  });

  it("третий уровень уточняет узел, если для него есть правило", () => {
    // Slippers у Shopify отдельный узел, а BG кладёт их внутрь Sandals
    expect(
      node(resolveCategory(["Shoes", "Sandals - Shoes", "Slippers - Sandals - Shoes"]))
    ).toBe("aa-8-7");
    expect(
      node(resolveCategory(["Clothing", "Sweaters - Clothing", "Cardigans - Sweaters - Clothing"]))
    ).toBe("aa-1-13-3");
  });

  it("третий уровень без своего правила откатывается на второй", () => {
    // «Mid Heel - Pumps - Shoes» правила не имеет — работает «Pumps - Shoes»
    const hit = resolveCategory(["Shoes", "Pumps - Shoes", "Mid Heel - Pumps - Shoes"]);
    expect(node(hit)).toBe("aa-8-10");
    expect(hit?.productType).toBe("Heels");
  });

  it("шум BG не сбивает: побеждает самый глубокий узел, а не первый тег", () => {
    // у пары сумок BG проставил разом и Accessories, и Bags
    const hit = resolveCategory([
      "Accessories",
      "Bags",
      "Shoulder Bags - Bags",
      "Blue",
      "Miu Miu",
    ]);
    expect(node(hit)).toBe("aa-5-4-19");
    expect(hit?.productType).toBe("Shoulder Bags");
  });

  it("британское Jewellery у BG → узел Jewelry у Shopify", () => {
    expect(node(resolveCategory(["Accessories", "Jewellery - Accessories"]))).toBe("aa-6");
    expect(
      node(resolveCategory([
        "Accessories",
        "Jewellery - Accessories",
        "Necklaces - Jewellery - Accessories",
      ]))
    ).toBe("aa-6-8");
  });

  it("легаси-формат бота работает наравне с BG", () => {
    expect(node(resolveCategory(["tg-bot", "category:bags"]))).toBe("aa-5-4");
    expect(node(resolveCategory(["tg-bot", "category:dresses", "category:clothing"]))).toBe(
      "aa-1-4"
    );
  });

  it("регистр и пробелы значения не имеют", () => {
    expect(node(resolveCategory(["  SANDALS - SHOES  "]))).toBe("aa-8-6");
  });

  it("незнакомые теги → null, наугад не проставляем", () => {
    expect(resolveCategory(["Women", "EU", "Discount_40-49", "New with tags"])).toBeNull();
    expect(resolveCategory([])).toBeNull();
  });
});

describe("categoryPatch", () => {
  it("оба поля пустые → заполняем оба", () => {
    expect(categoryPatch({ tags: ["Sandals - Shoes"] })).toEqual({
      category: "gid://shopify/TaxonomyCategory/aa-8-6",
      productType: "Sandals",
    });
  });

  it("категория уже стоит → дописываем только тип", () => {
    expect(
      categoryPatch({
        tags: ["Sandals - Shoes"],
        category: { id: "gid://shopify/TaxonomyCategory/aa-8" },
      })
    ).toEqual({ productType: "Sandals" });
  });

  it("оба поля заполнены → трогать нечего (идемпотентность)", () => {
    expect(
      categoryPatch({
        tags: ["Sandals - Shoes"],
        category: { id: "gid://shopify/TaxonomyCategory/aa-8-6" },
        productType: "Sandals",
      })
    ).toBeNull();
  });

  it("категорию менеджера не перезаписываем, даже если она расходится с тегами", () => {
    const patch = categoryPatch({
      tags: ["Sandals - Shoes"],
      category: { id: "gid://shopify/TaxonomyCategory/aa-1-4" },
      productType: "Dresses",
    });
    expect(patch).toBeNull();
  });

  it("категория не опознана → null", () => {
    expect(categoryPatch({ tags: ["Women", "EU"] })).toBeNull();
  });
});

function mockClient(pages: unknown[]) {
  const fetchFn = vi.fn();
  for (const p of pages) {
    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: p }), { status: 200 })
    );
  }
  const client = new ShopifyClient(
    { shop: "t.myshopify.com", adminToken: "x" },
    fetchFn as unknown as typeof fetch
  );
  return { client, fetchFn };
}

describe("categorizeStoreProducts", () => {
  it("заполняет пустые поля, пропускает готовые, копит неопознанные", async () => {
    const { client, fetchFn } = mockClient([
      {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Black Calfskin Sandals",
              tags: ["Shoes", "Sandals - Shoes"],
              productType: "",
              category: null,
            },
            {
              id: "gid://shopify/Product/2",
              title: "Already done",
              tags: ["Bags", "Handbags - Bags"],
              productType: "Handbags",
              category: { id: "gid://shopify/TaxonomyCategory/aa-5-4" },
            },
            {
              id: "gid://shopify/Product/3",
              title: "Mystery item",
              tags: ["Women", "EU"],
              productType: "",
              category: null,
            },
          ],
        },
      },
      { productUpdate: { userErrors: [] } }, // для товара 1
    ]);

    const stats = await categorizeStoreProducts(client);
    expect(stats.scanned).toBe(3);
    expect(stats.updated).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.unresolved).toEqual(["Mystery item"]);
    expect(stats.failed).toBe(0);

    const body = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body.variables.product).toEqual({
      id: "gid://shopify/Product/1",
      category: "gid://shopify/TaxonomyCategory/aa-8-6",
      productType: "Sandals",
    });
  });

  it("userErrors от Shopify считаются ошибкой, а не успехом", async () => {
    const { client } = mockClient([
      {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Black Calfskin Sandals",
              tags: ["Sandals - Shoes"],
              productType: "",
              category: null,
            },
          ],
        },
      },
      { productUpdate: { userErrors: [{ message: "нельзя" }] } },
    ]);

    const stats = await categorizeStoreProducts(client);
    expect(stats.updated).toBe(0);
    expect(stats.failed).toBe(1);
  });

  it("пустая выдача → ничего не делает", async () => {
    const { client } = mockClient([
      { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
    ]);
    const stats = await categorizeStoreProducts(client);
    expect(stats.scanned).toBe(0);
    expect(stats.updated).toBe(0);
  });
});
