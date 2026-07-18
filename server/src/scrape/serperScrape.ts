import type { ProductInfo } from "../types";
import { resolveImageUrls } from "./jsonld";

interface ScrapeResponse {
  text?: string;
  metadata?: Record<string, string>;
}

/** Обрезает хвосты вида «… | Official website» из og:title. */
export function cleanScrapedTitle(title: string): string {
  const first = title.split("|")[0].trim();
  return first.length >= 3 ? first : title.trim();
}

/**
 * Фолбэк для сайтов с антиботом (прямой запрос → 403): загрузка страницы
 * через scrape.serper.dev (2 кредита/страница). JS там не выполняется,
 * поэтому обычно достаются только og-метаданные — без цены, но с фото.
 */
export async function serperScrape(
  url: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<ProductInfo | null> {
  const res = await fetchFn("https://scrape.serper.dev", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as ScrapeResponse;
  const meta = data.metadata ?? {};
  const rawTitle = meta["og:title"] ?? meta.title;
  if (!rawTitle) return null;

  return {
    title: cleanScrapedTitle(rawTitle),
    url: meta["og:url"] ?? url,
    description: meta["og:description"] ?? meta.description,
    images: resolveImageUrls(
      [meta["og:image"]].filter((u): u is string => !!u),
      url
    ),
    source: "opengraph",
  };
}
