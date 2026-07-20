import { describe, it, expect, vi } from "vitest";
import { ShopifyClient } from "../src/shopify/client";
import { buildDraftInput, createDraftProduct } from "../src/shopify/draftProduct";
import type { ManagerRequest, ProductInfo } from "../src/types";

const req: ManagerRequest = {
  title: "GG Marmont small shoulder bag",
  ourPrice: 1490,
  currency: "EUR",
  designer: "Gucci",
};

const info = (over: Partial<ProductInfo> = {}): ProductInfo => ({
  title: "GG Marmont small shoulder bag",
  url: "https://www.gucci.com/x",
  brand: "Gucci",
  description: "Кожаная сумка <с> фурнитурой Double G",
  images: Array.from({ length: 12 }, (_, i) => `https://img/${i}.jpg`),
  price: 2600,
  currency: "EUR",
  source: "jsonld",
  ...over,
});

describe("buildDraftInput", () => {
  it("наша цена — цена товара, цена бренда — compare-at", () => {
    const d = buildDraftInput(req, info(), "EUR");
    expect(d.price).toBe(1490);
    expect(d.compareAtPrice).toBe(2600);
    expect(d.vendor).toBe("Gucci");
  });

  it("теги для коллекции Italian Edit и ручной доставки", () => {
    const d = buildDraftInput(req, info(), "EUR");
    expect(d.tags).toContain("italian-edit");
    expect(d.tags).toContain("delivery:manual-italy");
    expect(d.tags).toContain("tg-bot");
  });

  it("вариация попадает в название черновика", () => {
    const withVar = buildDraftInput(
      { ...req, variation: "beige and ebony Supreme" },
      info(),
      "EUR"
    );
    expect(withVar.title).toBe("GG Marmont small shoulder bag — beige and ebony Supreme");
    const without = buildDraftInput(req, info(), "EUR");
    expect(without.title).toBe("GG Marmont small shoulder bag");
  });

  it("пометка о доставке из Италии в описании", () => {
    const d = buildDraftInput(req, info(), "EUR");
    expect(d.descriptionHtml).toContain("Shipped directly from Italy");
    // и даже без описания с сайта бренда пометка остаётся
    const noDesc = buildDraftInput(req, info({ description: undefined }), "EUR");
    expect(noDesc.descriptionHtml).toContain("Shipped directly from Italy");
  });

  it("другая валюта бренда → compare-at не ставим", () => {
    const d = buildDraftInput(req, info({ currency: "USD" }), "EUR");
    expect(d.compareAtPrice).toBeUndefined();
  });

  it("цена бренда ниже нашей → compare-at не ставим", () => {
    const d = buildDraftInput(req, info({ price: 1000 }), "EUR");
    expect(d.compareAtPrice).toBeUndefined();
  });

  it("не больше 8 фото, html в описании экранирован", () => {
    const d = buildDraftInput(req, info(), "EUR");
    expect(d.imageUrls).toHaveLength(8);
    expect(d.descriptionHtml).toContain("&lt;с&gt;");
  });
});

function mockShopify(responses: unknown[]): { client: ShopifyClient; fetchFn: ReturnType<typeof vi.fn> } {
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
  return { client, fetchFn };
}

describe("createDraftProduct", () => {
  const createOk = {
    productCreate: {
      product: {
        id: "gid://shopify/Product/123456",
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/789" }] },
      },
      userErrors: [],
    },
  };
  const variantOk = { productVariantsBulkUpdate: { userErrors: [] } };

  it("создаёт черновик и ставит цены", async () => {
    const { client, fetchFn } = mockShopify([createOk, variantOk]);
    const result = await createDraftProduct(client, buildDraftInput(req, info(), "EUR"));

    expect(result.adminUrl).toBe("https://test.myshopify.com/admin/products/123456");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const createBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(createBody.variables.product.status).toBe("DRAFT");
    // фото прикрепляются отдельно через uploadProductImages, не в productCreate
    expect(createBody.variables.media).toBeUndefined();

    const priceBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(priceBody.variables.variants[0].price).toBe("1490.00");
    expect(priceBody.variables.variants[0].compareAtPrice).toBe("2600.00");
  });

  it("userErrors при создании → ошибка", async () => {
    const { client } = mockShopify([
      { productCreate: { product: null, userErrors: [{ message: "Title is blank" }] } },
    ]);
    await expect(
      createDraftProduct(client, buildDraftInput(req, info(), "EUR"))
    ).rejects.toThrow(/Title is blank/);
  });

  it("шлёт токен в заголовке", async () => {
    const { client, fetchFn } = mockShopify([createOk, variantOk]);
    await createDraftProduct(client, buildDraftInput(req, info(), "EUR"));
    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat_x");
  });
});
