/**
 * Атрибуты Google Merchant Center, которых приложение Google & YouTube
 * само не берёт из товара.
 *
 * Фид строит приложение Shopify «Google & YouTube». Бренд (vendor), GTIN
 * (штрихкод), размер (опция Size), категорию (поле Category) и item_group_id
 * оно находит само, а пол, возраст, состояние, MPN, систему размеров и
 * custom labels читает только из метаполей варианта `mm-google-shopping.*`.
 * Эти определения приложение создало в магазине само. Других ключей в этом
 * пространстве оно не читает: color или material туда писать бесполезно.
 *
 * Здесь чистые правила: что положить в эти метаполя по тегам, SKU и цене.
 * Запись делает googleStoreProducts.ts.
 */

import { genderFromTags } from "./gender";
import { saleBand, SALE_BANDS } from "./facets";
import { styleCode } from "../tdf/productInput";

export const GOOGLE_NAMESPACE = "mm-google-shopping";

/** Ключи, которые ведёт задача. Все — single_line_text_field на варианте. */
export const GOOGLE_KEYS = [
  "gender",
  "age_group",
  "condition",
  "mpn",
  "size_system",
  "custom_label_0",
  "custom_label_1",
  "custom_label_2",
  "custom_label_3",
] as const;

export type GoogleKey = (typeof GOOGLE_KEYS)[number];
export type GoogleValues = Partial<Record<GoogleKey, string>>;

/** Значения Google для gender: male / female / unisex. */
export function googleGender(tags: string[]): string | null {
  const gender = genderFromTags(tags);
  if (gender === "women") return "female";
  if (gender === "men") return "male";
  if (gender === "unisex") return "unisex";
  return null;
}

function lowerTags(tags: string[]): string[] {
  return tags.map((t) => t.trim().toLowerCase());
}

/**
 * age_group. Каталог взрослый; детский — только по явному тегу (как в genderValues).
 * Google принимает newborn / infant / toddler / kids / adult; точнее «kids» нам
 * без возраста в данных не определить.
 */
export function googleAgeGroup(tags: string[]): string {
  const lower = lowerTags(tags);
  const kids = lower.some((t) => t === "kids" || t === "category:kids" || t.endsWith(" - kids"));
  return kids ? "kids" : "adult";
}

/**
 * condition: new / used. Б/у — только по явному тегу. Слово «vintage» в названии
 * у TheDoubleF означает эффект состаренности («vintage-effect jeans»), а не
 * подержанную вещь, поэтому по названию не судим.
 */
const USED_TAGS = new Set(["pre-owned", "preowned", "pre owned", "used", "condition:used", "preloved", "pre-loved"]);

export function googleCondition(tags: string[]): string {
  return lowerTags(tags).some((t) => USED_TAGS.has(t)) ? "used" : "new";
}

/**
 * MPN — артикул производителя (Style Code): часть SKU TheDoubleF до «/».
 * «MXSPALOMBACO/XM_MAXM-001_102-40» → «MXSPALOMBACO». SKU без «/» — не наш
 * формат, артикула в нём нет: MPN не ставим, наугад хуже, чем пусто.
 */
export function googleMpn(sku: string | null | undefined): string | null {
  if (!sku || !sku.includes("/")) return null;
  const code = styleCode(sku);
  if (!code || code.length < 3 || code.length > 70) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(code) ? code : null;
}

/** Системы размеров, которые принимает Google (атрибут size_system). */
const SIZE_SYSTEMS = ["US", "UK", "EU", "DE", "FR", "JP", "CN", "IT", "BR", "MEX", "AU"];
/** Сетки, которых у Google нет: датская (Ganni и др.) совпадает с европейской. */
const SIZE_SYSTEM_ALIASES: Record<string, string> = { DK: "EU" };
const SIZE_SYSTEM_RE = new RegExp(
  `\\s(${[...SIZE_SYSTEMS, ...Object.keys(SIZE_SYSTEM_ALIASES)].join("|")})$`,
  "i"
);

/**
 * size_system. Сетка подписана у размера суффиксом: «38 IT», «6 UK», «36 FR».
 * Без системы Google считает размер американским (страна продажи — США).
 * Буквенные (M, XL) и джинсовые (29) размеры системы не требуют — оставляем пустым.
 */
export function googleSizeSystem(size: string | null | undefined): string | null {
  const m = size?.trim().match(SIZE_SYSTEM_RE);
  if (!m) return null;
  const system = m[1].toUpperCase();
  return SIZE_SYSTEM_ALIASES[system] ?? system;
}

/** Раздел каталога из самого частного категорийного тега: «Sneakers - Shoes» → Shoes. */
const SECTIONS = ["Clothing", "Shoes", "Bags", "Accessories"] as const;

export function catalogSection(tags: string[]): string | null {
  let best: { section: string; depth: number } | null = null;
  for (const raw of tags) {
    const chain = raw.trim().split(" - ");
    const top = chain[chain.length - 1].toLowerCase();
    const section = SECTIONS.find((s) => s.toLowerCase() === top);
    if (!section) continue;
    if (!best || chain.length > best.depth) best = { section, depth: chain.length };
  }
  return best?.section ?? null;
}

/** Ценовые диапазоны custom_label_1 (USD, цена варианта). */
export const PRICE_TIERS = ["usd-0-500", "usd-500-1000", "usd-1000-2000", "usd-2000-plus"] as const;

export function priceTier(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price < 500) return PRICE_TIERS[0];
  if (price < 1000) return PRICE_TIERS[1];
  if (price < 2000) return PRICE_TIERS[2];
  return PRICE_TIERS[3];
}

/** custom_label_2: размер скидки. Полосы те же, что у фильтра Sale на витрине. */
const DISCOUNT_LABELS: Record<(typeof SALE_BANDS)[number], string> = {
  [SALE_BANDS[0]]: "sale-up-to-30",
  [SALE_BANDS[1]]: "sale-30-50",
  [SALE_BANDS[2]]: "sale-50-plus",
};

export function discountLabel(price: string, compareAtPrice: string | null): string {
  const band = saleBand([{ price, compareAtPrice }]);
  return band ? DISCOUNT_LABELS[band as keyof typeof DISCOUNT_LABELS] : "full-price";
}

/**
 * custom_label_3: маржинальность по расчёту цены TheDoubleF (метаполе tdf.pricing).
 * Пороги по фактической сетке: наценка 10% даёт ~9% маржи, 15% — ~13%, 20% и
 * сетка v1.0 — 17–20%.
 */
export function marginTier(pricingJson: string | null | undefined): string | null {
  if (!pricingJson) return null;
  let margin: unknown;
  try {
    margin = (JSON.parse(pricingJson) as { margin?: unknown }).margin;
  } catch {
    return null;
  }
  if (typeof margin !== "number" || !Number.isFinite(margin)) return null;
  if (margin < 0.12) return "margin-low";
  if (margin < 0.18) return "margin-mid";
  return "margin-high";
}

export interface GoogleVariantInput {
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  selectedOptions: { name: string; value: string }[];
}

export interface GoogleProductInput {
  tags: string[];
  /** Значение метаполя tdf.pricing (JSON) или null. */
  pricing: string | null;
}

/** Метаполя mm-google-shopping варианта. Ключа нет — значения не вывели, не пишем. */
export function computeGoogle(product: GoogleProductInput, variant: GoogleVariantInput): GoogleValues {
  const size = variant.selectedOptions.find((o) => /^size$/i.test(o.name.trim()))?.value;
  const values: Record<GoogleKey, string | null> = {
    gender: googleGender(product.tags),
    age_group: googleAgeGroup(product.tags),
    condition: googleCondition(product.tags),
    mpn: googleMpn(variant.sku),
    size_system: googleSizeSystem(size),
    custom_label_0: catalogSection(product.tags)?.toLowerCase() ?? null,
    custom_label_1: priceTier(Number(variant.price)),
    custom_label_2: discountLabel(variant.price, variant.compareAtPrice),
    custom_label_3: marginTier(product.pricing),
  };
  const out: GoogleValues = {};
  for (const key of GOOGLE_KEYS) {
    const v = values[key];
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Что дописать варианту. Только задаём значения: ничего не удаляем —
 * значение, проставленное в канале Google руками, при пустом выводе
 * (например, MPN у не нашего SKU) остаётся как есть.
 */
export function planGoogle(
  wanted: GoogleValues,
  current: Partial<Record<string, string>>
): { key: GoogleKey; value: string }[] {
  const out: { key: GoogleKey; value: string }[] = [];
  for (const key of GOOGLE_KEYS) {
    const value = wanted[key];
    if (value && current[key] !== value) out.push({ key, value });
  }
  return out;
}
