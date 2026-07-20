import { describe, it, expect } from "vitest";
import { parseManagerMessage, parsePrice, looksLikeRequest } from "../src/bot/parse";
import { titleMatchScore, variationMatchScore } from "../src/search/findProduct";
import { parseJsonLd } from "../src/scrape/jsonld";
import type { ProductInfo } from "../src/types";

describe("parsePrice", () => {
  it("простое число — валюта по умолчанию", () => {
    expect(parsePrice("1490")).toEqual({ amount: 1490, currency: "EUR" });
  });
  it("символы валют", () => {
    expect(parsePrice("1490€")).toEqual({ amount: 1490, currency: "EUR" });
    expect(parsePrice("$1,299.50")).toEqual({ amount: 1299.5, currency: "USD" });
    expect(parsePrice("£950")).toEqual({ amount: 950, currency: "GBP" });
  });
  it("пробелы и десятичная запятая", () => {
    expect(parsePrice("1 290,50 €")).toEqual({ amount: 1290.5, currency: "EUR" });
  });
  it("запятая как разделитель тысяч", () => {
    expect(parsePrice("1,290")).toEqual({ amount: 1290, currency: "EUR" });
  });
  it("мусор — null", () => {
    expect(parsePrice("дорого")).toBeNull();
  });
});

describe("parseManagerMessage", () => {
  it("основной формат — 4 строки с вариацией", () => {
    expect(
      parseManagerMessage("Ophidia mini bag\nbeige and ebony Supreme\nGucci\n1200")
    ).toEqual({
      title: "Ophidia mini bag",
      variation: "beige and ebony Supreme",
      designer: "Gucci",
      ourPrice: 1200,
      currency: "EUR",
    });
  });
  it("без вариации — 3 строки", () => {
    const r = parseManagerMessage("Re-Nylon backpack\nPrada\n990");
    expect(r?.designer).toBe("Prada");
    expect(r?.variation).toBeUndefined();
    expect(r?.ourPrice).toBe(990);
  });
  it("работает и через |", () => {
    const r = parseManagerMessage(
      "Plume technical fabric and suede sneakers | Navy | Miu Miu | 650$"
    );
    expect(r?.variation).toBe("Navy");
    expect(r?.designer).toBe("Miu Miu");
    expect(r?.currency).toBe("USD");
  });
  it("команда /check", () => {
    const r = parseManagerMessage("/check Re-Nylon backpack\nPrada\n990");
    expect(r?.designer).toBe("Prada");
    expect(r?.ourPrice).toBe(990);
  });
  it("дизайнер из нескольких частей (лишний |)", () => {
    const r = parseManagerMessage("Sicily bag | red | Dolce | Gabbana | 1200");
    expect(r?.variation).toBe("red");
    expect(r?.designer).toBe("Dolce Gabbana");
  });
  it("цена не последней (старый формат) — null, а не тихий мусор", () => {
    expect(parseManagerMessage("Сумка | 1200 | Gucci")).toBeNull();
  });
  it("неполное сообщение — null", () => {
    expect(parseManagerMessage("просто текст")).toBeNull();
    expect(parseManagerMessage("Сумка\n100")).toBeNull();
  });
});

describe("looksLikeRequest", () => {
  it("два разделителя | — похоже", () => {
    expect(looksLikeRequest("a | b | c")).toBe(true);
  });
  it("3–4 строки с цифрой в конце — похоже", () => {
    expect(looksLikeRequest("Ophidia mini bag\nbeige Supreme\nGucci\n1200")).toBe(true);
    expect(looksLikeRequest("Re-Nylon backpack\nPrada\n990")).toBe(true);
  });
  it("обычное сообщение — нет", () => {
    expect(looksLikeRequest("привет, как дела?")).toBe(false);
    expect(looksLikeRequest("привет\nкак дела\nвсё ок?")).toBe(false);
  });
});

describe("titleMatchScore", () => {
  it("полное совпадение", () => {
    expect(
      titleMatchScore("GG Marmont small shoulder bag", "GG Marmont Small Shoulder Bag")
    ).toBeGreaterThanOrEqual(0.9);
  });
  it("нет совпадения", () => {
    expect(titleMatchScore("Triple S sneakers", "Silk scarf with logo")).toBeLessThan(0.4);
  });
});

describe("variationMatchScore", () => {
  const info = (over: Partial<ProductInfo>): ProductInfo => ({
    title: "Ophidia mini bag",
    url: "https://www.gucci.com/us/en/pr/ophidia-mini-bag-p-1",
    images: [],
    source: "jsonld",
    ...over,
  });

  it("вариация в поле color", () => {
    const score = variationMatchScore(
      "beige and ebony Supreme",
      info({ color: "Beige and ebony GG Supreme canvas" })
    );
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it("вариация в описании", () => {
    const score = variationMatchScore(
      "Navy",
      info({ description: "Plume sneakers in navy technical fabric and suede" })
    );
    expect(score).toBe(1);
  });

  it("вариация в URL", () => {
    const score = variationMatchScore(
      "white",
      info({ url: "https://www.miumiu.com/p/plume-sneakers-white/X.html" })
    );
    expect(score).toBe(1);
  });

  it("не та расцветка — низкий балл", () => {
    const score = variationMatchScore(
      "beige and white Supreme",
      info({ color: "Black leather", description: "Black Ophidia bag" })
    );
    expect(score).toBeLessThan(0.5);
  });
});

describe("parseJsonLd", () => {
  const html = `
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "GG Marmont small shoulder bag",
      "description": "Черная сумка из матлассе-кожи.",
      "image": ["https://example.com/1.jpg", {"@type":"ImageObject","url":"https://example.com/2.jpg"}],
      "brand": {"@type": "Brand", "name": "Gucci"},
      "offers": {
        "@type": "Offer",
        "price": "1790.00",
        "priceCurrency": "EUR",
        "availability": "https://schema.org/InStock"
      }
    }
    </script>
    </head><body></body></html>`;

  it("извлекает товар из JSON-LD", () => {
    const info = parseJsonLd(html, "https://www.gucci.com/x");
    expect(info).not.toBeNull();
    expect(info!.title).toBe("GG Marmont small shoulder bag");
    expect(info!.brand).toBe("Gucci");
    expect(info!.price).toBe(1790);
    expect(info!.currency).toBe("EUR");
    expect(info!.availability).toBe("InStock");
    expect(info!.images).toHaveLength(2);
  });

  it("находит Product внутри @graph", () => {
    const graphHtml = html.replace(
      /\{\s*"@context"[\s\S]*"@type": "Product"/,
      '{"@context":"https://schema.org","@graph":[{"@type": "Product"'
    ).replace(/\}\s*<\/script>/, "}]}</script>");
    const info = parseJsonLd(graphHtml, "https://x.com");
    expect(info?.title).toBe("GG Marmont small shoulder bag");
  });

  it("страница без Product — null", () => {
    expect(parseJsonLd("<html><body>hi</body></html>", "https://x.com")).toBeNull();
  });

  it("относительные фото → абсолютные, дубли убраны", () => {
    const relHtml = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Blade Pump","image":[
        "/img/zoom/a.jpg", "/img/zoom/a.jpg", "https://cdn.x.com/b.jpg"
      ]}
      </script>`;
    const info = parseJsonLd(relHtml, "https://www.casadei.com/en-us/shoes/p.html");
    expect(info!.images).toEqual([
      "https://www.casadei.com/img/zoom/a.jpg",
      "https://cdn.x.com/b.jpg",
    ]);
  });
});
