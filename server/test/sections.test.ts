import { describe, it, expect } from "vitest";
import { extractSections } from "../src/scrape/sections";
import { sectionsToHtml } from "../src/shopify/draftProduct";

// Структура как у Gucci: aria-controls → панель-секция с <ul>
const ARIA_HTML = `
<div role="button" id="pd-header" aria-controls="pd-panel" aria-expanded="false">
  <span>Product Details</span>
</div>
<section id="pd-panel" aria-labelledby="pd-header">
  <div><ul>
    <li>Beige and ebony GG Supreme canvas</li>
    <li>Brown leather trim</li>
    <li>Made in Italy</li>
  </ul></div>
</section>
<div role="button" id="mc-header" aria-controls="mc-panel">
  <span>Materials &amp; Care</span>
</div>
<section id="mc-panel">
  <div><ul><li>Wipe with a soft cloth</li><li>Keep away from direct heat</li></ul></div>
</section>
<div role="button" id="oc-header" aria-controls="oc-panel"><span>Our Commitment</span></div>
<section id="oc-panel"><p>Marketing text about sustainability that we do not need.</p></section>
`;

// Простой сайт: заголовок → следующий блок
const HEADING_HTML = `
<h3>Details</h3>
<div><ul><li>Nappa leather</li><li>Rubber sole</li></ul></div>
<h3>Composition</h3>
<p>100% calf leather, lining 100% cotton</p>
`;

describe("extractSections", () => {
  it("ARIA-аккордеоны (Gucci): обе секции, Our Commitment пропущен", () => {
    const s = extractSections(ARIA_HTML);
    expect(s.map((x) => x.heading)).toEqual(["Product Details", "Materials & Care"]);
    expect(s[0].text).toBe(
      "Beige and ebony GG Supreme canvas\nBrown leather trim\nMade in Italy"
    );
    expect(s[1].text).toContain("Wipe with a soft cloth");
  });

  it("простые заголовки: Details и Composition", () => {
    const s = extractSections(HEADING_HTML);
    expect(s.map((x) => x.heading)).toEqual(["Product Details", "Materials & Care"]);
    expect(s[0].text).toBe("Nappa leather\nRubber sole");
    expect(s[1].text).toBe("100% calf leather, lining 100% cotton");
  });

  it("страница без секций → пусто", () => {
    expect(extractSections("<html><body><p>hi</p></body></html>")).toEqual([]);
  });

  it("длинный текст обрезается", () => {
    const long = `<h3>Materials</h3><p>${"x".repeat(5000)}</p>`;
    const s = extractSections(long);
    expect(s[0].text.length).toBeLessThanOrEqual(1200);
  });
});

describe("sectionsToHtml", () => {
  it("многострочная секция → список, однострочная → абзац", () => {
    const html = sectionsToHtml([
      { heading: "Product Details", text: "Made in Italy\nGold hardware" },
      { heading: "Materials & Care", text: "Wipe with soft cloth" },
    ]);
    expect(html).toContain("<h4>Product Details</h4><ul><li>Made in Italy</li><li>Gold hardware</li></ul>");
    expect(html).toContain("<h4>Materials &amp; Care</h4><p>Wipe with soft cloth</p>");
  });

  it("без секций — пустая строка", () => {
    expect(sectionsToHtml(undefined)).toBe("");
    expect(sectionsToHtml([])).toBe("");
  });
});
