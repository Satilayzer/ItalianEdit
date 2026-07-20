import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export interface ProductSection {
  heading: string;
  text: string;
}

/**
 * Какие секции страницы товара забираем в описание.
 * «Our Commitment» и прочий маркетинг — сознательно нет.
 */
const SECTION_PATTERNS: { heading: string; re: RegExp }[] = [
  { heading: "Product Details", re: /^(product\s*details?|details)$/i },
  {
    heading: "Materials & Care",
    re: /^(materials?\s*(&|and)\s*care|materials?|composition(\s*(&|and)\s*care)?|care(\s*instructions)?)$/i,
  },
];

const MAX_SECTION_CHARS = 1200;
const MIN_SECTION_CHARS = 10;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function matchHeading(text: string): string | undefined {
  const t = norm(text);
  if (!t || t.length > 40) return undefined;
  return SECTION_PATTERNS.find((p) => p.re.test(t))?.heading;
}

/** Текст блока: список <li> построчно, иначе сплошной текст. */
function panelText($: cheerio.CheerioAPI, el: AnyNode): string {
  const $el = $(el);
  const items = $el
    .find("li")
    .toArray()
    .map((li) => norm($(li).text()))
    .filter(Boolean);
  const text = items.length > 0 ? items.join("\n") : norm($el.text());
  return text.slice(0, MAX_SECTION_CHARS);
}

/**
 * Универсальное извлечение секций «Product Details» / «Materials & Care»
 * со страниц брендов. Два паттерна:
 *  1) доступные аккордеоны: заголовок с aria-controls → панель по id (Gucci и большинство люкса);
 *  2) обычный заголовок (h2–h5/summary/button/dt) → следующий содержательный блок.
 */
export function extractSections(html: string): ProductSection[] {
  const $ = cheerio.load(html);
  const found = new Map<string, string>();

  $("[aria-controls]").each((_, el) => {
    const heading = matchHeading($(el).text());
    if (!heading || found.has(heading)) return;
    const id = $(el).attr("aria-controls");
    if (!id) return;
    const panel = $(`[id="${id.replace(/"/g, "")}"]`);
    if (panel.length === 0) return;
    const text = panelText($, panel.get(0)!);
    if (text.length >= MIN_SECTION_CHARS) found.set(heading, text);
  });

  if (found.size < SECTION_PATTERNS.length) {
    $("h2, h3, h4, h5, summary, dt, button").each((_, el) => {
      const heading = matchHeading($(el).text());
      if (!heading || found.has(heading)) return;
      let block = $(el).next();
      if (block.length === 0 || norm(block.text()).length < MIN_SECTION_CHARS) {
        block = $(el).parent().next();
      }
      if (block.length === 0) return;
      const text = panelText($, block.get(0)!);
      if (text.length >= MIN_SECTION_CHARS) found.set(heading, text);
    });
  }

  return SECTION_PATTERNS.filter((p) => found.has(p.heading)).map((p) => ({
    heading: p.heading,
    text: found.get(p.heading)!,
  }));
}
