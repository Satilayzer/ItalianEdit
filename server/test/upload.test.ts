import { describe, it, expect, vi } from "vitest";
import { ShopifyClient } from "../src/shopify/client";
import {
  imageUrlCandidates,
  downloadImage,
  uploadProductImages,
} from "../src/shopify/uploadImages";

const GUCCI_490 =
  "https://media.gucci.com/style/DarkGray_Center_0_0_490x490/17828/764960_bag.jpg";

function imageResponse(mime: string, size = 100): Response {
  return new Response(new Uint8Array(size), {
    status: 200,
    headers: { "content-type": mime },
  });
}

describe("imageUrlCandidates", () => {
  it("Gucci: сперва 2400x2400, потом оригинал", () => {
    expect(imageUrlCandidates(GUCCI_490)).toEqual([
      "https://media.gucci.com/style/DarkGray_Center_0_0_2400x2400/17828/764960_bag.jpg",
      GUCCI_490,
    ]);
  });
  it("не-Gucci: как есть", () => {
    expect(imageUrlCandidates("https://www.prada.com/img/a.jpg")).toEqual([
      "https://www.prada.com/img/a.jpg",
    ]);
  });
});

describe("downloadImage", () => {
  it("AVIF пропускается, берётся кандидат с JPEG", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("image/avif"))
      .mockResolvedValueOnce(imageResponse("image/jpeg", 500));
    const img = await downloadImage(GUCCI_490, fetchFn as unknown as typeof fetch);
    expect(img).not.toBeNull();
    expect(img!.mimeType).toBe("image/jpeg");
    expect(img!.filename.endsWith(".jpg")).toBe(true);
    expect(img!.bytes.byteLength).toBe(500);
  });

  it("Accept просит jpeg/png, а не avif", async () => {
    const fetchFn = vi.fn().mockResolvedValue(imageResponse("image/jpeg"));
    await downloadImage("https://x.com/a.jpg", fetchFn as unknown as typeof fetch);
    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Accept).toContain("image/jpeg");
    expect(headers.Accept).not.toContain("avif");
  });

  it("все кандидаты не картинки → null", async () => {
    const fetchFn = vi.fn().mockResolvedValue(imageResponse("text/html"));
    expect(
      await downloadImage("https://x.com/a.jpg", fetchFn as unknown as typeof fetch)
    ).toBeNull();
  });
});

describe("uploadProductImages", () => {
  it("скачивает, грузит в staged-хранилище и прикрепляет к товару", async () => {
    const clientFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              stagedUploadsCreate: {
                stagedTargets: [
                  {
                    url: "https://storage.shopify.com/upload",
                    resourceUrl: "https://storage.shopify.com/final/img.jpg",
                    parameters: [{ name: "key", value: "abc" }],
                  },
                ],
                userErrors: [],
              },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { productCreateMedia: { media: [{ id: "m1" }], mediaUserErrors: [] } } }),
          { status: 200 }
        )
      );
    const client = new ShopifyClient(
      { shop: "test.myshopify.com", adminToken: "shpat_x" },
      clientFetch as unknown as typeof fetch
    );

    const netFetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("image/jpeg", 300))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const stats = await uploadProductImages(
      client,
      "gid://shopify/Product/1",
      ["https://www.prada.com/img/a.jpg"],
      netFetch as unknown as typeof fetch
    );

    expect(stats).toEqual({ uploaded: 1, failed: 0 });
    const attachBody = JSON.parse(clientFetch.mock.calls[1][1].body);
    expect(attachBody.variables.media[0].originalSource).toBe(
      "https://storage.shopify.com/final/img.jpg"
    );
    // upload POST ушёл на staged url
    expect(String(netFetch.mock.calls[1][0])).toBe("https://storage.shopify.com/upload");
  });

  it("не скачавшееся фото — в failed, остальное не падает", async () => {
    const client = new ShopifyClient(
      { shop: "t.myshopify.com", adminToken: "x" },
      vi.fn() as unknown as typeof fetch
    );
    const netFetch = vi.fn().mockResolvedValue(imageResponse("text/html"));
    const stats = await uploadProductImages(
      client,
      "gid://shopify/Product/1",
      ["https://x.com/bad.jpg"],
      netFetch as unknown as typeof fetch
    );
    expect(stats).toEqual({ uploaded: 0, failed: 1 });
  });
});
