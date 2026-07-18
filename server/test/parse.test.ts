import { describe, it, expect } from "vitest";
import { parseManagerMessage, parsePrice, looksLikeRequest } from "../src/bot/parse";
import { titleMatchScore } from "../src/search/findProduct";
import { parseJsonLd } from "../src/scrape/jsonld";

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
  it("формат с | ", () => {
    expect(
      parseManagerMessage("GG Marmont small shoulder bag | 1490€ | Gucci")
    ).toEqual({
      title: "GG Marmont small shoulder bag",
      ourPrice: 1490,
      currency: "EUR",
      designer: "Gucci",
    });
  });
  it("команда /check", () => {
    const r = parseManagerMessage("/check Re-Nylon backpack | 990 | Prada");
    expect(r?.designer).toBe("Prada");
    expect(r?.ourPrice).toBe(990);
  });
  it("построчный формат", () => {
    const r = parseManagerMessage("Triple S sneakers\n850$\nBalenciaga");
    expect(r?.title).toBe("Triple S sneakers");
    expect(r?.currency).toBe("USD");
  });
  it("дизайнер из нескольких слов", () => {
    const r = parseManagerMessage("Sicily bag | 1200 | Dolce | Gabbana");
    expect(r?.designer).toBe("Dolce Gabbana");
  });
  it("неполное сообщение — null", () => {
    expect(parseManagerMessage("просто текст")).toBeNull();
    expect(parseManagerMessage("Сумка | 100")).toBeNull();
  });
});

describe("looksLikeRequest", () => {
  it("два разделителя — похоже", () => {
    expect(looksLikeRequest("a | b | c")).toBe(true);
  });
  it("обычное сообщение — нет", () => {
    expect(looksLikeRequest("привет, как дела?")).toBe(false);
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
