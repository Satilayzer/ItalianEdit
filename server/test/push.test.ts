import { describe, it, expect, vi } from "vitest";
import { ShopifyClient } from "../src/shopify/client";
import { buildTags, pushProduct, getPrimaryLocationId } from "../src/shopify/products";
import { mapProduct } from "../src/bg/mapProduct";
import type { PushRow } from "../src/db/products";
import type { BgProduct } from "../src/bg/types";

const row = (over: Partial<PushRow> = {}): PushRow => ({
  bg_id: 7503,
  sku: "GG-MARM-01",
  name: "GG Marmont bag",
  brand: "Gucci",
  description: "Кожаная сумка",
  images: ["https://img/1.jpg", "https://img/2.jpg"],
  our_price: 1490,
  stock: 1,
  warehouse: "eu",
  status: "active",
  shopify_product_id: null,
  shopify_variant_map: null,
  ...over,
});

function mockClient(responses: unknown[]) {
  const fetchFn = vi.fn();
  for (const r of responses) {
    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: r }), { status: 200 })
    );
  }
  const client = new ShopifyClient(
    { shop: "test.myshopify.com", adminToken: "shpat_x" },
    fetchFn as unknown as typeof fetch
  );
  const body = (i: number) => JSON.parse(fetchFn.mock.calls[i][1].body);
  return { client, fetchFn, body };
}

const createOk = {
  productCreate: {
    product: {
      id: "gid://shopify/Product/1",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/2",
            inventoryItem: { id: "gid://shopify/InventoryItem/3" },
          },
        ],
      },
    },
    userErrors: [],
  },
};
const variantOk = { productVariantsBulkUpdate: { userErrors: [] } };
const qtyOk = { inventorySetQuantities: { userErrors: [] } };
const updateOk = { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } };

describe("buildTags", () => {
  it("склад и дизайнер", () => {
    expect(buildTags({ brand: "Gucci", warehouse: "us" })).toEqual([
      "bg",
      "warehouse:us",
      "designer:gucci",
    ]);
  });
  it("без склада — eu по умолчанию, без бренда — без тега дизайнера", () => {
    expect(buildTags({ brand: null, warehouse: null })).toEqual(["bg", "warehouse:eu"]);
  });
});

describe("getPrimaryLocationId", () => {
  it("возвращает первую локацию", async () => {
    const { client } = mockClient([
      { locations: { nodes: [{ id: "gid://shopify/Location/9" }] } },
    ]);
    expect(await getPrimaryLocationId(client)).toBe("gid://shopify/Location/9");
  });
});

describe("pushProduct — создание", () => {
  it("создаёт ACTIVE товар, ставит sku/цену и остаток", async () => {
    const { client, fetchFn, body } = mockClient([createOk, variantOk, qtyOk]);
    const ids = await pushProduct(client, row(), "gid://shopify/Location/9");

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(ids.productId).toBe("gid://shopify/Product/1");

    const create = body(0).variables;
    expect(create.product.status).toBe("ACTIVE");
    expect(create.product.vendor).toBe("Gucci");
    expect(create.product.tags).toContain("warehouse:eu");
    expect(create.media).toHaveLength(2);

    const variant = body(1).variables.variants[0];
    expect(variant.price).toBe("1490.00");
    expect(variant.inventoryItem).toEqual({ sku: "GG-MARM-01", tracked: true });

    const qty = body(2).variables.input.quantities[0];
    expect(qty.quantity).toBe(1);
    expect(qty.locationId).toBe("gid://shopify/Location/9");
  });

  it("userErrors при создании → ошибка с текстом", async () => {
    const { client } = mockClient([
      { productCreate: { product: null, userErrors: [{ message: "Boom" }] } },
    ]);
    await expect(pushProduct(client, row(), "loc")).rejects.toThrow(/Boom/);
  });
});

describe("pushProduct — обновление", () => {
  const existing = row({
    shopify_product_id: "gid://shopify/Product/1",
    shopify_variant_map: {
      variantId: "gid://shopify/ProductVariant/2",
      inventoryItemId: "gid://shopify/InventoryItem/3",
    },
  });

  it("обновляет статус, цену и остаток без создания", async () => {
    const { client, fetchFn, body } = mockClient([updateOk, variantOk, qtyOk]);
    await pushProduct(client, existing, "loc");

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(body(0).variables.product.id).toBe("gid://shopify/Product/1");
    expect(body(0).variables.product.status).toBe("ACTIVE");
  });

  it("неактивный товар архивируется", async () => {
    const { client, body } = mockClient([updateOk, variantOk, qtyOk]);
    await pushProduct(client, { ...existing, status: "inactive", stock: 0 }, "loc");
    expect(body(0).variables.product.status).toBe("ARCHIVED");
    expect(body(2).variables.input.quantities[0].quantity).toBe(0);
  });
});

describe("mapProduct — описание и фото", () => {
  const bg: BgProduct = {
    id: 1,
    sku: "X",
    name: "Товар",
    description: "Описание",
    regular_price: 100,
    images: [
      { src: "https://img/b.jpg", position: 2 },
      { src: "https://img/a.jpg", position: 1 },
    ],
  };

  it("переносит описание и сортирует фото по position", () => {
    const r = mapProduct(bg);
    expect(r.description).toBe("Описание");
    expect(r.images).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
  });
});
