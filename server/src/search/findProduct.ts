import type { Config } from "../config";
import type { ManagerRequest, ProductInfo, SearchHit } from "../types";
import { officialDomain } from "./brands";
import { discoverOfficialDomain, hostMatchesDomain } from "./discoverDomain";
import { serperSearch } from "./serper";
import { duckduckgoSearch } from "./duckduckgo";
import { fetchPage } from "../scrape/fetchPage";
import { parseJsonLd } from "../scrape/jsonld";
import { parseOpenGraph } from "../scrape/opengraph";
import { serperScrape } from "../scrape/serperScrape";
import { extractSections } from "../scrape/sections";

const MAX_PAGES_TO_TRY = 5;
const MIN_TITLE_MATCH = 0.4;
/** Максимум страниц на один запрос через платный scrape-фолбэк (2 кредита/страница). */
const MAX_SCRAPE_FALLBACKS = 2;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((t) => t.length > 2);
}

/** Доля слов из needle, найденных в haystack (0..1). */
export function tokenMatchScore(needle: string, haystack: string): number {
  const req = tokens(needle);
  if (req.length === 0) return 0;
  const foundSet = new Set(tokens(haystack));
  const matched = req.filter((t) => foundSet.has(t)).length;
  return matched / req.length;
}

/** Доля слов из запроса менеджера, найденных в названии со страницы (0..1). */
export function titleMatchScore(requested: string, found: string): number {
  return tokenMatchScore(requested, found);
}

/** Насколько страница соответствует вариации (цвет/модель): смотрим название+цвет+описание+URL. */
export function variationMatchScore(variation: string, info: ProductInfo): number {
  const haystack = [info.title, info.color, info.description, decodeURIComponent(info.url)]
    .filter(Boolean)
    .join(" ");
  return tokenMatchScore(variation, haystack);
}

async function runSearch(query: string, config: Config): Promise<SearchHit[]> {
  if (config.serperApiKey) {
    try {
      return await serperSearch(query, config.serperApiKey);
    } catch (err) {
      console.warn("Serper недоступен, переключаюсь на DuckDuckGo:", err);
    }
  }
  return duckduckgoSearch(query);
}

export type FindFailure = "unknown-designer" | "not-found";

export interface FindResult {
  info?: ProductInfo;
  failure?: FindFailure;
  /** Официальный домен, на котором искали (для сообщений об ошибке). */
  domain?: string;
}

/**
 * Основной поток: поиск товара ИСКЛЮЧИТЕЛЬНО на официальном сайте дизайнера.
 * Домен берём из словаря брендов, а для неизвестных — определяем через поисковик
 * (с фильтром маркетплейсов/ресейлеров). Нет официального домена → не ищем вовсе.
 */
export async function findProduct(
  req: ManagerRequest,
  config: Config
): Promise<FindResult> {
  let domain = officialDomain(req.designer);
  if (!domain) {
    domain = await discoverOfficialDomain(req.designer, (q) => runSearch(q, config));
  }
  if (!domain) return { failure: "unknown-designer" };

  const searchQuery = [`site:${domain}`, req.title, req.variation ?? ""]
    .join(" ")
    .trim();
  const hits = (await runSearch(searchQuery, config)).filter((h) => {
    try {
      return hostMatchesDomain(new URL(h.link).hostname, domain);
    } catch {
      return false;
    }
  });

  let best: { info: ProductInfo; score: number } | null = null;
  let scrapesUsed = 0;

  for (const hit of hits.slice(0, MAX_PAGES_TO_TRY)) {
    const html = await fetchPage(hit.link);
    let info = html
      ? (parseJsonLd(html, hit.link) ?? parseOpenGraph(html, hit.link))
      : null;
    if (info && html) {
      info.sections = extractSections(html);
    }

    // Сайт заблокировал прямой запрос → пробуем через scrape.serper.dev
    if (!info && config.serperApiKey && scrapesUsed < MAX_SCRAPE_FALLBACKS) {
      scrapesUsed++;
      info = await serperScrape(hit.link, config.serperApiKey).catch(() => null);
    }
    if (!info) continue;

    const score = titleMatchScore(req.title, info.title);
    if (score < MIN_TITLE_MATCH) continue;

    // Вариация (цвет/модель) сильно влияет на выбор страницы: у брендов
    // у каждой расцветки свой URL, и нам нужна именно запрошенная.
    const varScore = req.variation ? variationMatchScore(req.variation, info) : 0;
    // Страница с ценой предпочтительнее страницы без цены при близком совпадении
    const weighted = score + varScore * 0.6 + (info.price ? 0.15 : 0);
    if (!best || weighted > best.score) {
      best = { info, score: weighted };
      if (score >= 0.9 && info.price && (!req.variation || varScore >= 0.5)) break;
    }
  }

  return best ? { info: best.info, domain } : { failure: "not-found", domain };
}
