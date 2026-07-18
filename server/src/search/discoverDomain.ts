import type { SearchHit } from "../types";
import { normalizeBrand } from "./brands";

/** Маркетплейсы, ресейлеры, универмаги, соцсети, справочники — НЕ официальные сайты брендов. */
const BLOCKED_DOMAINS = new Set([
  // мультибрендовые магазины и ресейлеры
  "farfetch.com", "ssense.com", "net-a-porter.com", "mrporter.com", "mytheresa.com",
  "matchesfashion.com", "luisaviaroma.com", "yoox.com", "theoutnet.com", "italist.com",
  "cettire.com", "24s.com", "brownsfashion.com", "endclothing.com", "flannels.com",
  "selfridges.com", "harrods.com", "saksfifthavenue.com", "neimanmarcus.com",
  "nordstrom.com", "bloomingdales.com", "bergdorfgoodman.com", "galerieslafayette.com",
  "ebay.com", "amazon.com", "etsy.com", "aliexpress.com", "walmart.com",
  "vestiairecollective.com", "therealreal.com", "grailed.com", "stockx.com",
  "poshmark.com", "depop.com", "rebag.com", "fashionphile.com",
  "zalando.com", "asos.com", "shein.com", "temu.com", "lyst.com", "modesens.com",
  // соцсети и справочники
  "wikipedia.org", "fandom.com", "instagram.com", "facebook.com", "pinterest.com",
  "youtube.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com", "reddit.com",
  // медиа и прочее
  "vogue.com", "gq.com", "businessoffashion.com", "brandsgateway.com",
  "shopify.com", "myshopify.com", "italian-edit.com",
]);

const TWO_LEVEL_TLDS = new Set([
  "co.uk", "com.au", "co.jp", "com.br", "co.kr", "com.cn", "com.tr", "com.hk",
]);

/** «www.store.gucci.com» → «gucci.com»; учитывает двухуровневые TLD (co.uk и т.п.). */
export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LEVEL_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain);
}

/** Точная проверка «hostname принадлежит домену» (gucci.com и *.gucci.com, но не notgucci.com). */
export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  return h === domain || h.endsWith("." + domain);
}

/**
 * Выбор официального домена из поисковой выдачи по «<дизайнер> official website»:
 * 1) домен, чьё имя совпадает с именем бренда (off---white.com ↔ Off-White);
 * 2) домен, встречающийся в выдаче минимум дважды;
 * 3) первый не заблокированный.
 * Маркетплейсы/ресейлеры/соцсети отбрасываются всегда.
 */
export function pickOfficialDomain(
  designer: string,
  hits: SearchHit[]
): string | undefined {
  const brandKey = normalizeBrand(designer);
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const hit of hits) {
    let host: string;
    try {
      host = new URL(hit.link).hostname;
    } catch {
      continue;
    }
    const domain = registrableDomain(host);
    if (isBlockedDomain(domain)) continue;
    if (!counts.has(domain)) order.push(domain);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  if (order.length === 0) return undefined;

  const nameLike = order.find((d) => {
    const core = d.split(".")[0].replace(/[^a-z0-9]/g, "");
    if (core.length < 4 || brandKey.length < 4) return false;
    return core.includes(brandKey) || brandKey.includes(core);
  });
  if (nameLike) return nameLike;

  const frequent = order.find((d) => (counts.get(d) ?? 0) >= 2);
  return frequent ?? order[0];
}

const discovered = new Map<string, string | null>();

/**
 * Официальный домен дизайнера, которого нет в словаре brands.ts:
 * определяем через поисковик и кэшируем на время жизни процесса.
 */
export async function discoverOfficialDomain(
  designer: string,
  search: (query: string) => Promise<SearchHit[]>
): Promise<string | undefined> {
  const key = normalizeBrand(designer);
  if (discovered.has(key)) return discovered.get(key) ?? undefined;

  const hits = await search(`${designer} official website`);
  const domain = pickOfficialDomain(designer, hits.slice(0, 8));
  discovered.set(key, domain ?? null);
  return domain;
}
