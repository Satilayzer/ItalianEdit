/**
 * Правила отбора стартового ассортимента — лист «Технические правила запуска»
 * таблицы Артура и Юли (R01–R30). Логика двухступенчатая: одобренный бренд
 * плюс фильтры качества конкретной модели.
 *
 * Итог по модели один из трёх:
 *  - skip — не импортируем вовсе (HIDE: детское, не fashion, бренд скрыт, старый сезон…);
 *  - import + review-теги — импортируем ЧЕРНОВИКОМ, но публиковать нельзя,
 *    пока менеджер не снимет пометку (HOLD / DISCUSS / ПРОВЕРИТЬ);
 *  - import без review-тегов — черновик, готовый к ручной публикации.
 *
 * Черновик — всегда: новые товары поставщика сами не публикуются (R19).
 */

import type { FeedProduct } from "./feed";
import { brandEntry, type BrandEntry, type BrandRegistry } from "./brands";
import {
  CHEAP_BASICS_TITLE,
  CHEAP_BASICS_TYPES,
  NON_FASHION,
  classify,
  type CategoryResult,
} from "./category";

/** Пометки «нужна проверка» — служебные теги, синк управляет ими сам. */
export const REVIEW = {
  season: "review:season",
  photos: "review:photos",
  category: "review:category",
  customs: "review:customs",
  noDiscount: "review:no-discount",
} as const;

export const HERO_CANDIDATE_TAG = "hero-candidate";

export const CURRENT_SEASONS = new Set(["FW26", "SS26", "CON"]);
export const PREVIOUS_SEASONS = new Set(["FW25", "SS25"]);

/** R09: прайс поставщика ниже €150 — дешёвые basics, в основные коллекции не берём. */
export const MIN_LIST_PRICE_EUR = 150;
/** R10: HERO только от €300. */
export const MIN_HERO_PRICE_EUR = 300;
/** R11 / R12: минимум фото для каталога и для HERO. */
export const MIN_PHOTOS = 2;
export const MIN_HERO_PHOTOS = 4;

export interface Evaluation {
  product: FeedProduct;
  brand: BrandEntry;
  category: CategoryResult | null;
  include: boolean;
  /** Почему не импортируем (код правила + пояснение). */
  skipReasons: string[];
  /** review:* — товар импортируется, но публиковать нельзя до проверки. */
  reviewTags: string[];
  heroCandidate: boolean;
}

/** Порядковый номер сезона: SS25 < FW25 < SS26. null — не формат FWyy/SSyy. */
export function seasonAge(season: string): number | null {
  const m = season.match(/^(FW|SS)(\d{2})$/);
  if (!m) return null;
  return Number(m[2]) * 2 + (m[1] === "FW" ? 1 : 0);
}

function isKids(p: FeedProduct): boolean {
  return p.ageGroup.toLowerCase() === "kids" || /kids/i.test(p.gender);
}

function sizesInStock(p: FeedProduct): number {
  return p.variants.filter((v) => v.quantity > 0).length;
}

/**
 * Статусы, которые импортируем. По решению Артура (02.10.2026) в работу берём
 * HERO и SHOW; DISCUSS и HIDE на старте одинаково скрыты.
 */
export const IMPORT_STATUSES = new Set(["HERO", "SHOW"]);

export function evaluate(p: FeedProduct, registry: BrandRegistry): Evaluation {
  const brand = brandEntry(registry, p.brand);
  const category = classify(p.productType, p.title);
  const skip: string[] = [];
  const review: string[] = [];

  // ── HIDE: не импортируем ────────────────────────────────────────────────
  if (isKids(p)) skip.push("R01 детское");
  if (NON_FASHION.test(p.title)) skip.push("R02 не fashion");
  if (!IMPORT_STATUSES.has(brand.status)) skip.push(`R03 бренд ${brand.status}`);
  if (!p.variants.some((v) => v.quantity > 0 && /in stock/i.test(v.availability))) {
    skip.push("R04 нет в наличии");
  }
  if (!p.title || !p.brand || !p.link || !p.images[0] || p.price === null) {
    skip.push("R05 нет обязательных данных");
  }
  const season = p.season.toUpperCase();
  const age = seasonAge(season);
  if (PREVIOUS_SEASONS.has(season)) review.push(REVIEW.season); // R07
  else if (!CURRENT_SEASONS.has(season)) {
    // R08: FW24, SS24 и старше — скрыть. Будущие (SS27) — актуальные.
    // Нераспознанный сезон — на проверку, а не в мусор.
    if (age === null) review.push(REVIEW.season);
    else if (age < seasonAge("SS25")!) skip.push(`R08 старый сезон ${season}`);
  }
  if (p.price !== null && p.price < MIN_LIST_PRICE_EUR) skip.push("R09 дешевле €150");
  if (CHEAP_BASICS_TYPES.test(p.productType) || CHEAP_BASICS_TITLE.test(p.title)) {
    skip.push("R16 basics");
  }

  // ── HOLD / ПРОВЕРИТЬ: импортируем черновиком с пометкой ─────────────────
  if (p.images.length < MIN_PHOTOS) review.push(REVIEW.photos); // R11
  if (!category) review.push(REVIEW.category); // R15
  // R24: без таможенного кода точную пошлину не посчитать — не публиковать.
  if (!p.hsCode) review.push(REVIEW.customs);
  if (p.salePrice === 0) review.push(REVIEW.noDiscount); // R29

  // ── HERO-кандидат: R10, R12, R13/R14, R21 ───────────────────────────────
  const oneSize = category?.section === "Bags" || category?.section === "Accessories";
  const heroCandidate =
    brand.status === "HERO" &&
    p.price !== null &&
    p.price >= MIN_HERO_PRICE_EUR &&
    p.images.length >= MIN_HERO_PHOTOS &&
    (oneSize ? sizesInStock(p) >= 1 : sizesInStock(p) >= 2);

  return {
    product: p,
    brand,
    category,
    include: skip.length === 0,
    skipReasons: skip,
    reviewTags: [...new Set(review)],
    heroCandidate,
  };
}
