import { describe, it, expect, vi } from "vitest";
import { warehouseForBrand, isKnownUsBrand } from "../src/shopify/warehouseByBrand";
import { missingTags, tagStoreProducts } from "../src/shopify/tagStoreProducts";
import { ShopifyClient } from "../src/shopify/client";

describe("warehouseForBrand", () => {
  it("US-марки → us", () => {
    expect(warehouseForBrand("Michael Kors")).toBe("us");
    expect(warehouseForBrand("COACH")).toBe("us");
    expect(warehouseForBrand("Tory Burch")).toBe("us");
    expect(isKnownUsBrand("michael kors")).toBe(true);
  });
  it("остальной люкс → eu", () => {
    expect(warehouseForBrand("Gucci")).toBe("eu");
    expect(warehouseForBrand("Dolce & Gabbana")).toBe("eu");
  });
  it("без бренда → eu по умолчанию", () => {
    expect(warehouseForBrand(null)).toBe("eu");
    expect(warehouseForBrand(undefined)).toBe("eu");
  });
});

describe("missingTags", () => {
  it("нет тегов вовсе → склад по бренду + дизайнер", () => {
    expect(missingTags({ id: "1", vendor: "Gucci", tags: [] })).toEqual([
      "EU",
      "designer:gucci",
    ]);
    expect(missingTags({ id: "2", vendor: "Coach", tags: [] })).toEqual([
      "US",
      "designer:coach",
    ]);
  });

  it("склад уже есть → не трогаем склад", () => {
    expect(
      missingTags({ id: "3", vendor: "Gucci", tags: ["EU", "designer:gucci"] })
    ).toEqual([]);
  });

  it("есть гендер-тег от приложения BG, но нет склада → добавляем только склад/дизайнера", () => {
    const add = missingTags({
      id: "4",
      vendor: "Prada",
      tags: ["Women", "Bags"],
    });
    expect(add).toContain("EU");
    expect(add).toContain("designer:prada");
    expect(add).not.toContain("Women");
  });

  it("размерный тег EU37/US7 не считается складом → склад всё равно добавляем", () => {
    // у товаров приложения размеры вида "EU37/US7" — не путаем со складом
    const add = missingTags({ id: "6", vendor: "Prada", tags: ["EU37/US7", "Bags"] });
    expect(add).toContain("EU");
  });

  it("без vendor → только склад по умолчанию", () => {
    expect(missingTags({ id: "5", vendor: null, tags: [] })).toEqual(["EU"]);
  });
});

function mockClient(pages: unknown[]) {
  const fetchFn = vi.fn();
  for (const p of pages) {
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ data: p }), { status: 200 }));
  }
  const client = new ShopifyClient(
    { shop: "t.myshopify.com", adminToken: "x" },
    fetchFn as unknown as typeof fetch
  );
  return { client, fetchFn };
}

describe("tagStoreProducts", () => {
  it("тегирует товары без склада, пропускает уже помеченные", async () => {
    const { client, fetchFn } = mockClient([
      {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "gid://shopify/Product/1", vendor: "Gucci", tags: [] },
            { id: "gid://shopify/Product/2", vendor: "Coach", tags: ["US", "designer:coach"] },
          ],
        },
      },
      { tagsAdd: { userErrors: [] } }, // для товара 1
    ]);

    const stats = await tagStoreProducts(client);
    expect(stats.scanned).toBe(2);
    expect(stats.tagged).toBe(1);
    expect(stats.failed).toBe(0);

    // второй запрос — tagsAdd для товара 1 с EU+designer
    const addBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(addBody.variables.id).toBe("gid://shopify/Product/1");
    expect(addBody.variables.tags).toEqual(["EU", "designer:gucci"]);
  });

  it("пустая выдача → ничего не делает", async () => {
    const { client } = mockClient([
      { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
    ]);
    const stats = await tagStoreProducts(client);
    expect(stats).toEqual({ scanned: 0, tagged: 0, failed: 0 });
  });
});
