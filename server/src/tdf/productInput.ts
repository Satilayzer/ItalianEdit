/**
 * Модель TheDoubleF → ProductSetInput для Shopify.
 *
 * Принципы (лист «Технические правила», Pricing Logic v1.0):
 *  - статус всегда DRAFT, в каналы продаж не публикуем (R19);
 *  - цена продажи считается сразу (autoPrice): минимум сетки маржи v1.0 по
 *    нашим затратам, в целых долларах; тег `price:auto`. Нет закупки — цена 0
 *    и `price:pending`. Закупка в USD уходит в «Cost per item», чтобы Shopify
 *    сам показывал маржу и после ручной правки цены;
 *  - все исходные данные поставщика, оценка затрат и расчёт цены — в метаполях
 *    `tdf.*` (аудит: курс, дата, закупка, пошлина, остаток, маржа, порог).
 */

import type { FeedProduct, FeedVariant } from "./feed";
import type { Evaluation } from "./rules";
import { HERO_CANDIDATE_TAG } from "./rules";
import { countryCode, estimateCosts, DEFAULT_COSTS, type CostEstimate, type CostSettings } from "./economics";
import { autoPrice, POLICY_VERSION, type AutoPrice } from "./pricing";
import { buildDescriptionHtml, type SpecItem } from "../shopify/description";
import { resolveCategory } from "../shopify/category";
import { genderTags, normalizeGender } from "../shopify/gender";
import { warehouseTag } from "../shopify/warehouse";
import { colorFamilies, colorFamiliesIn, genderValues, subcategoryValues } from "../shopify/facets";

/** Пространство метаполей фильтров витрины (см. facetStoreProducts.ts). */
const FACET_NAMESPACE = "italian_edit";

export const SOURCE_TAG = "tdf";
/** Цену посчитать нельзя (нет закупки) — цена 0, публиковать нельзя. */
export const PRICE_PENDING_TAG = "price:pending";
/** Цена посчитана автоматически и синк её ведёт; ручная правка цены его отключает. */
export const PRICE_AUTO_TAG = "price:auto";
export const TDF_NAMESPACE = "tdf";

/** Склад TheDoubleF — Италия, коллекция «Ships from Europe». */
export const TDF_WAREHOUSE = "eu" as const;

// ── Размеры ────────────────────────────────────────────────────────────────

const LETTER_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL"];

/** «40  IT» → «40 IT», «38,5 IT» → «38.5 IT», «U» → «One Size». */
export function normalizeSize(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || /^(U|UNI|TU|OS|ONE SIZE|UNICA)$/i.test(s)) return "One Size";
  return s.replace(/(\d),(\d)/g, "$1.$2");
}

/** Ключ сортировки: буквенные по порядку, числовые по возрастанию. */
function sizeSortKey(size: string): [number, number, string] {
  const first = size.split(/[ /]/)[0].toUpperCase();
  const letter = LETTER_ORDER.indexOf(first);
  if (letter >= 0) return [0, letter, size];
  const num = Number.parseFloat(size.replace(",", "."));
  if (Number.isFinite(num)) return [1, num, size];
  return [2, 0, size];
}

export function sortVariants<T extends { size: string }>(variants: T[]): T[] {
  return [...variants].sort((a, b) => {
    const ka = sizeSortKey(normalizeSize(a.size));
    const kb = sizeSortKey(normalizeSize(b.size));
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}

// ── Описание ───────────────────────────────────────────────────────────────

/** Код модели бренда — часть ID поставщика до «/»: `SPSFERITOCO/XM_…` → `SPSFERITOCO`. */
export function styleCode(variantId: string): string | undefined {
  const code = variantId.split("/")[0]?.trim();
  return code || undefined;
}

/**
 * Описание поставщика приходит без знаков препинания, пункты разделены
 * тремя пробелами: «… by Sportmax   Color  Ecru   Pure cotton organza voile».
 * Первый пункт — абзац, «Color  Ecru» — пара «ключ: значение», остальное — список.
 */
export function descriptionHtml(p: FeedProduct, vendor: string): string {
  // Поставщик вырезает пунктуацию вместе с «&»: «by Dolce   Gabbana» распалось бы
  // на два пункта. Имя бренда из фида склеиваем обратно до разбиения.
  const brandWords = p.brand.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let text = p.description;
  if (brandWords.length > 1) {
    text = text.replace(new RegExp(brandWords.map(escapeRe).join("\\s+"), "giu"), vendor);
  }
  // Буквы с диакритикой поставщик тоже теряет: «by Chlo» вместо «by Chloé».
  if (/[^\x00-\x7F]/.test(vendor)) {
    const ascii = [...vendor].map((ch) => (/[^\x00-\x7F]/.test(ch) ? "" : escapeRe(ch))).join("");
    text = text.replace(new RegExp(`(?<![\\p{L}])${ascii}(?![\\p{L}])`, "gu"), vendor);
  }
  const segments = text
    .split(/\s{3,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const [lead, ...rest] = segments;

  const details: SpecItem[] = [];
  for (const seg of rest) {
    const pair = seg.match(/^(Colou?r)\s{2}(.+)$/i);
    if (pair) details.push({ label: "Color", value: pair[2].trim() });
    else details.push({ value: seg.charAt(0).toUpperCase() + seg.slice(1) });
  }
  if (p.material) details.push({ label: "Material", value: p.material });
  const made = p.madeIn.replace(/^made in\s+/i, "").trim();
  if (made) details.push({ label: "Made in", value: made });

  return buildDescriptionHtml(
    {
      prose: lead ? `${lead.replace(/\s+/g, " ")}.` : undefined,
      details,
      features: [],
      fit: [],
      mpn: styleCode(p.variants[0]?.id ?? ""),
    },
    { title: p.title, vendor }
  );
}

// ── Сборка ─────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** «Color  Ink blue White» из описания поставщика. */
export function descriptionColor(description: string): string | null {
  const m = description.match(/(?:^|\s{3,})Colou?r\s{2}(.+?)(?=\s{3,}|$)/i);
  return m ? m[1].trim() : null;
}

/**
 * Цвет — тегами-семействами (Blue, White…), их читает фильтр Color.
 * Поле `color` фида ненадёжно (у сине-белого поло стоит Black), поэтому
 * сначала строка «Color …» из описания, поле поставщика — запасной вариант.
 */
export function colorTags(p: FeedProduct): string[] {
  const fromDescription = colorFamiliesIn(descriptionColor(p.description) ?? "");
  if (fromDescription.length > 0) return fromDescription.length > 3 ? ["Multicolor"] : fromDescription;
  return colorFamiliesIn(p.color);
}

export function productTags(e: Evaluation, priced = false): string[] {
  const p = e.product;
  const tags = [
    SOURCE_TAG,
    warehouseTag(TDF_WAREHOUSE),
    ...genderTags(normalizeGender(p.gender)),
    `designer:${e.brand.displayName.toLowerCase()}`,
    ...(e.category?.tags ?? []),
    ...colorTags(p),
    priced ? PRICE_AUTO_TAG : PRICE_PENDING_TAG,
    ...e.reviewTags,
    ...(e.heroCandidate ? [HERO_CANDIDATE_TAG] : []),
  ];
  return [...new Set(tags)];
}

/**
 * Метаполя фильтров (пол, подкатегория, цвет) — сразу при создании, теми же
 * функциями, что у задачи shopify-facets: товар попадает в фильтры, не дожидаясь
 * её прохода, а задача потом просто увидит, что всё уже совпадает.
 */
export function facetMetafields(tags: string[], title: string, vendor: string) {
  const values = {
    gender: genderValues(tags),
    subcategory: subcategoryValues(tags),
    color: colorFamilies({ title, vendor, tags }),
  };
  return Object.entries(values)
    .filter(([, list]) => list.length > 0)
    .map(([key, list]) => ({
      namespace: FACET_NAMESPACE,
      key,
      type: "list.single_line_text_field",
      value: JSON.stringify(list),
    }));
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface BuildOptions {
  locationId: string;
  costs?: CostSettings;
  /** Правило «отдавать 1»: потолок остатка в Shopify (INVENTORY_CAP). */
  inventoryCap?: number;
}

/** Затраты и автоматическая цена модели — общий расчёт для импорта и синка. */
export function priceProduct(
  p: FeedProduct,
  category: Evaluation["category"],
  settings: CostSettings = DEFAULT_COSTS
): { costs: CostEstimate | null; price: AutoPrice | null } {
  const costs = estimateCosts(p.price, p.salePrice, category, p.madeIn, settings);
  return { costs, price: autoPrice(costs?.directCostsCents ?? null, undefined, settings.fee) };
}

/** Расчёт цены для метаполя `tdf.pricing`: синк по нему узнаёт, что цена ещё автоматическая. */
export function pricingFacts(price: AutoPrice, settings: CostSettings = DEFAULT_COSTS) {
  const e = price.economics;
  return {
    policy_version: POLICY_VERSION,
    method: price.method,
    decision: price.decision,
    price_usd: e.priceCents / 100,
    payment_fee_usd: e.feeCents / 100,
    remaining_usd: e.remainingCents / 100,
    margin: Math.round(e.margin * 10_000) / 10_000,
    min_margin: e.band.minMarginBp / 10_000,
    min_remaining_usd: e.band.minRemainingCents / 100,
    fx_eur_usd: settings.eurUsd,
    fx_date: settings.eurUsdDate,
    costs_status: "estimate",
    reason: price.reason,
  };
}

export function pricingMetafield(price: AutoPrice, settings: CostSettings = DEFAULT_COSTS) {
  return {
    namespace: TDF_NAMESPACE,
    key: "pricing",
    type: "json",
    value: JSON.stringify(pricingFacts(price, settings)),
  };
}

export function variantInput(
  v: FeedVariant,
  purchaseUsdCents: number | null,
  country: string | null,
  opts: BuildOptions,
  priceCents: number | null = null
) {
  const cap = opts.inventoryCap ?? Infinity;
  return {
    optionValues: [{ optionName: "Size", name: normalizeSize(v.size) }],
    sku: v.id,
    ...(/^\d{8,14}$/.test(v.barcode) ? { barcode: v.barcode } : {}),
    price: money(priceCents ?? 0),
    inventoryPolicy: "DENY",
    inventoryItem: {
      sku: v.id,
      tracked: true,
      requiresShipping: true,
      ...(purchaseUsdCents !== null ? { cost: money(purchaseUsdCents) } : {}),
      ...(country ? { countryCodeOfOrigin: country } : {}),
      ...(v.hsCode ? { harmonizedSystemCode: v.hsCode } : {}),
    },
    inventoryQuantities: [
      {
        locationId: opts.locationId,
        name: "available",
        quantity: Math.max(0, Math.min(v.quantity, cap)),
      },
    ],
    metafields: [
      { namespace: TDF_NAMESPACE, key: "variant_id", type: "single_line_text_field", value: v.id },
      ...(v.supplierVariantId
        ? [{
            namespace: TDF_NAMESPACE,
            key: "supplier_variant_gid",
            type: "single_line_text_field",
            value: `gid://shopify/ProductVariant/${v.supplierVariantId}`,
          }]
        : []),
    ],
  };
}

export function productSetInput(e: Evaluation, opts: BuildOptions) {
  const p = e.product;
  const settings = opts.costs ?? DEFAULT_COSTS;
  const { costs, price } = priceProduct(p, e.category, settings);
  const country = countryCode(p.madeIn);
  const tags = productTags(e, price !== null);
  const category = resolveCategory(tags);
  // Два варианта с одинаковым размером после нормализации Shopify не примет
  // (значения опции уникальны) — оставляем первый. На живом фиде таких нет.
  const seen = new Set<string>();
  const variants = sortVariants(p.variants).filter((v) => {
    const size = normalizeSize(v.size);
    if (seen.has(size)) return false;
    seen.add(size);
    return true;
  });
  const sizes = [...seen];

  const supplierFacts = {
    policy_version: POLICY_VERSION,
    product_key: p.key,
    link: p.link,
    brand_raw: p.brand,
    season: p.season,
    price_eur: p.price,
    sale_price_eur: p.salePrice,
    made_in: p.madeIn,
    hs_code: p.hsCode || null,
    fx_eur_usd: settings.eurUsd,
    fx_date: settings.eurUsdDate,
    estimate: costs && {
      purchase_eur: costs.purchaseEurCents / 100,
      purchase_usd: costs.purchaseUsdCents / 100,
      duty_rate: costs.dutyBp / 10_000,
      duty_usd: costs.dutyCents / 100,
      shipping_usd: settings.shippingCents / 100,
      broker_usd: settings.brokerCents / 100,
      direct_costs_usd: costs.directCostsCents / 100,
      break_even_usd: costs.breakEvenCents / 100,
      floor_price_usd: costs.floorCents / 100,
      status: "estimate",
    },
    review: e.reviewTags,
  };

  return {
    handle: p.key,
    title: p.title,
    vendor: e.brand.displayName,
    status: "DRAFT",
    descriptionHtml: descriptionHtml(p, e.brand.displayName),
    tags,
    ...(category ? { category: category.taxonomyId, productType: category.productType } : {}),
    productOptions: [{ name: "Size", values: sizes.map((name) => ({ name })) }],
    files: p.images.map((url, i) => ({
      originalSource: url,
      contentType: "IMAGE",
      alt: `${e.brand.displayName} ${p.title}${i ? ` — view ${i + 1}` : ""}`,
    })),
    metafields: [
      { namespace: TDF_NAMESPACE, key: "product_key", type: "single_line_text_field", value: p.key },
      { namespace: TDF_NAMESPACE, key: "supplier", type: "json", value: JSON.stringify(supplierFacts) },
      ...(price ? [pricingMetafield(price, settings)] : []),
      ...facetMetafields(tags, p.title, e.brand.displayName),
    ],
    variants: variants.map((v) =>
      variantInput(v, costs?.purchaseUsdCents ?? null, country, opts, price?.priceCents ?? null)
    ),
  };
}
