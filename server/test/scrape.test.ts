import { describe, it, expect, vi } from "vitest";
import { serperScrape, cleanScrapedTitle } from "../src/scrape/serperScrape";

function mockFetch(payload: unknown, status = 200) {
  return vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;
}

describe("cleanScrapedTitle", () => {
  it("обрезает «| Official website»", () => {
    expect(cleanScrapedTitle("The long Bambino by JACQUEMUS | Official website")).toBe(
      "The long Bambino by JACQUEMUS"
    );
  });
  it("обычное название не трогает", () => {
    expect(cleanScrapedTitle("Blade Pump")).toBe("Blade Pump");
  });
});

describe("serperScrape", () => {
  const meta = {
    title: "The long Bambino by JACQUEMUS | Official website",
    "og:title": "The long Bambino by JACQUEMUS | Official website",
    "og:description": "The long Bambino | JACQUEMUS",
    "og:image": "https://www.jacquemus.com/dw/image/17.jpg",
    "og:url": "https://www.jacquemus.com/en_us/the-long-bambino/X.html",
  };

  it("строит ProductInfo из метаданных", async () => {
    const info = await serperScrape(
      "https://www.jacquemus.com/en_us/the-long-bambino/X.html",
      "key",
      mockFetch({ metadata: meta, credits: 2 })
    );
    expect(info).not.toBeNull();
    expect(info!.title).toBe("The long Bambino by JACQUEMUS");
    expect(info!.images).toEqual(["https://www.jacquemus.com/dw/image/17.jpg"]);
    expect(info!.price).toBeUndefined();
    expect(info!.source).toBe("opengraph");
  });

  it("нет title в метаданных → null", async () => {
    const info = await serperScrape("https://x.com", "key", mockFetch({ metadata: {} }));
    expect(info).toBeNull();
  });

  it("ошибка HTTP → null", async () => {
    const info = await serperScrape("https://x.com", "key", mockFetch({}, 500));
    expect(info).toBeNull();
  });

  it("шлёт ключ и url", async () => {
    const fetchFn = mockFetch({ metadata: meta });
    await serperScrape("https://site.com/p", "SECRET", fetchFn);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://scrape.serper.dev");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("SECRET");
    expect(JSON.parse(init.body).url).toBe("https://site.com/p");
  });
});
