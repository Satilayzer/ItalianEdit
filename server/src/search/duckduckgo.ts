import * as cheerio from "cheerio";
import type { SearchHit } from "../types";
import { BROWSER_HEADERS } from "../scrape/fetchPage";

/** Бесплатный фолбэк-поиск через HTML-версию DuckDuckGo (без API-ключа, менее надёжен). */
export async function duckduckgoSearch(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo: HTTP ${res.status}`);

  const $ = cheerio.load(await res.text());
  const hits: SearchHit[] = [];
  $("a.result__a").each((_, el) => {
    const a = $(el);
    const href = a.attr("href");
    if (!href) return;
    // DDG отдаёт редирект-ссылки вида //duckduckgo.com/l/?uddg=<url>
    let link = href;
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) link = decodeURIComponent(m[1]);
    else if (href.startsWith("//")) link = "https:" + href;
    if (link.startsWith("http")) {
      hits.push({ title: a.text().trim(), link });
    }
  });
  return hits;
}
