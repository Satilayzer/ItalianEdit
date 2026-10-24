/**
 * Синхронизация каталога TheDoubleF → Shopify.
 *
 * Поставщик обновляет фид 4 раза в день (GMT+1/+2). Каждый проход:
 *  1. качает фид, реестр брендов и прогоняет правила отбора;
 *  2. одним bulk-запросом читает все наши товары TheDoubleF (тег `tdf`);
 *  3. новые модели, прошедшие отбор, создаёт bulk-мутацией productSet — DRAFT
 *     (R19) с автоматической ценой (autoPrice, Pricing Logic v1.0);
 *  4. у существующих обновляет ТОЛЬКО поля поставщика (R20): остатки, закупку
 *     (Cost per item), новые размеры и служебные пометки `review:*`;
 *  5. автоматическую цену пересчитывает при смене закупки или курса — но только
 *     пока она автоматическая: цена всех размеров равна записанной в `tdf.pricing`
 *     (или ещё 0 / `price:pending`). Цену, исправленную вручную, не трогает:
 *     ставит `review:cost-changed`, а если она ниже сетки — `review:below-grid`.
 *     Статус, название, описание и ручные теги не трогает никогда.
 *
 * Пропавший из фида размер или модель → остаток 0 (продать нельзя), товар
 * не удаляется: на нём может быть ручная цена и работа менеджера.
 */

import { randomUUID } from "node:crypto";
import type { ShopifyClient } from "../shopify/client";
import { runBulkMutation, runBulkQuery } from "../shopify/bulk";
import { fetchFeed, DEFAULT_FEED_URL, type FeedProduct } from "./feed";
import { loadBrandRegistry, type BrandRegistry } from "./brands";
import { evaluate, REVIEW, HERO_CANDIDATE_TAG, type Evaluation } from "./rules";
import {
  productSetInput,
  variantInput,
  normalizeSize,
  priceProduct,
  pricingMetafield,
  SOURCE_TAG,
  TDF_NAMESPACE,
  PRICE_AUTO_TAG,
  PRICE_PENDING_TAG,
} from "./productInput";
import { compareAtCents, countryCode, retailItalyUsdCents, DEFAULT_COSTS, type CostSettings } from "./economics";
import { markupPriceCents, type AutoPrice } from "./pricing";
import { classifyByFeed } from "./category";
import { loadMarket, type MarketTable } from "./market";
import { resolveCategory } from "../shopify/category";

/** API, под который написаны мутации модуля (changeFromQuantity, productSet.files). */
export const TDF_API_VERSION = "2026-07";

/** Больше стольких смен цены — массовой операцией, а не поштучно. */
const BULK_PRICES_FROM = 50;

/** Моделей в одной bulk-мутации создания (лимит файла — 20 МБ). */
const CREATE_CHUNK = 1000;

/** Теги, которыми синк управляет сам: их ставит и снимает только он. */
export const COST_CHANGED_TAG = "review:cost-changed";
export const EXCLUDED_TAG = "review:excluded";
/** Ручная цена ниже сетки маржи при текущих затратах — не убыток, а повод для решения. */
export const BELOW_GRID_TAG = "review:below-grid";
/** Тестовая партия 08.10.2026: цену ставил скрипт, считаем её автоматической. */
const PRICE_TEST_TAG = "price:test";
const OWNED_TAGS = new Set<string>([
  ...Object.values(REVIEW),
  HERO_CANDIDATE_TAG,
  EXCLUDED_TAG,
  BELOW_GRID_TAG,
  PRICE_AUTO_TAG,
  PRICE_PENDING_TAG,
]);

export const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation TdfProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id handle }
      userErrors { field message code }
    }
  }
`;

const INDEX_QUERY = /* GraphQL */ `
  {
    products(query: "tag:${SOURCE_TAG}") {
      edges {
        node {
          id
          handle
          status
          tags
          key: metafield(namespace: "tdf", key: "product_key") { value }
          pricing: metafield(namespace: "tdf", key: "pricing") { value }
          variants {
            edges {
              node {
                id
                sku
                title
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem { id unitCost { amount } harmonizedSystemCode countryCodeOfOrigin }
              }
            }
          }
        }
      }
    }
  }
`;

export interface IndexedVariant {
  id: string;
  sku: string;
  /** Значение опции «Размер» (у наших товаров она одна) — уже нормализовано. */
  title: string;
  quantity: number;
  inventoryItemId: string;
  costCents: number | null;
  priceCents: number;
  /** Зачёркнутая цена, центы. null — не стоит. */
  compareAtCents: number | null;
  hsCode: string | null;
  countryCode: string | null;
}

export interface IndexedProduct {
  id: string;
  handle: string;
  status: string;
  tags: string[];
  key: string;
  /** Последняя автоматическая цена из `tdf.pricing`, центы. null — не ставилась. */
  autoPriceCents: number | null;
  variants: Map<string, IndexedVariant>;
}

function storedAutoPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const usd = Number(JSON.parse(raw).price_usd);
    return Number.isFinite(usd) ? Math.round(usd * 100) : null;
  } catch {
    return null;
  }
}

/** Все товары TheDoubleF магазина, по ключу модели поставщика. */
export async function fetchIndex(client: ShopifyClient): Promise<Map<string, IndexedProduct>> {
  type Row = Record<string, any>;
  const rows = await runBulkQuery<Row>(client, INDEX_QUERY);
  const byId = new Map<string, IndexedProduct>();
  for (const r of rows) {
    if (!r.__parentId) {
      byId.set(r.id, {
        id: r.id,
        handle: r.handle,
        status: r.status,
        tags: r.tags ?? [],
        key: r.key?.value ?? r.handle,
        autoPriceCents: storedAutoPrice(r.pricing?.value),
        variants: new Map(),
      });
    }
  }
  for (const r of rows) {
    if (!r.__parentId) continue;
    const parent = byId.get(r.__parentId);
    if (!parent || !r.sku) continue;
    const amount = r.inventoryItem?.unitCost?.amount;
    parent.variants.set(r.sku, {
      id: r.id,
      sku: r.sku,
      title: r.title ?? "",
      quantity: r.inventoryQuantity ?? 0,
      inventoryItemId: r.inventoryItem?.id,
      costCents: amount != null ? Math.round(Number(amount) * 100) : null,
      priceCents: Math.round(Number(r.price ?? 0) * 100),
      compareAtCents: r.compareAtPrice != null ? Math.round(Number(r.compareAtPrice) * 100) : null,
      hsCode: r.inventoryItem?.harmonizedSystemCode ?? null,
      countryCode: r.inventoryItem?.countryCodeOfOrigin ?? null,
    });
  }
  return new Map([...byId.values()].map((p) => [p.key, p]));
}

export async function primaryLocationId(client: ShopifyClient): Promise<string> {
  const data = await client.graphql<{ locations: { nodes: { id: string }[] } }>(
    `{ locations(first: 1) { nodes { id } } }`
  );
  const id = data.locations.nodes[0]?.id;
  if (!id) throw new Error("Shopify: у магазина нет локаций");
  return id;
}

// ── План изменений (чистая функция — её и тестируем) ──────────────────────

export interface TagChange {
  productId: string;
  add: string[];
  remove: string[];
}

export interface PriceChange {
  productId: string;
  /** Размеры, у которых цена отличается от новой. */
  variantIds: string[];
  price: AutoPrice;
}

export interface VariantRemap {
  productId: string;
  variantId: string;
  fromSku: string;
  /** Новый ID записи фида (SKU) того же размера. */
  toSku: string;
  supplierVariantId: string | null;
}

export interface SyncPlan {
  /** Поставщик сменил артикул размера: существующий вариант перепривязываем к новому. */
  remaps: VariantRemap[];
  create: Evaluation[];
  quantities: { inventoryItemId: string; quantity: number; from: number }[];
  costs: { inventoryItemId: string; costCents: number }[];
  /** Таможенные данные варианта (R24): HS-код и страна происхождения из фида. */
  customs: { inventoryItemId: string; harmonizedSystemCode?: string; countryCodeOfOrigin?: string }[];
  prices: PriceChange[];
  /** Зачёркнутая цена (розница в Италии с НДС, вариант B от 13.10.2026). null — снять. */
  compareAts: { productId: string; variants: { id: string; compareAtCents: number | null }[] }[];
  newVariants: {
    productId: string;
    evaluation: Evaluation;
    variants: FeedProduct["variants"];
    /** Цена новых размеров — как у модели. */
    priceCents: number | null;
  }[];
  tags: TagChange[];
  /** Перенос в другую категорию (HS-код уточнил раздел): теги, Product type, Category. */
  categories: CategoryChange[];
}

export interface CategoryChange {
  productId: string;
  add: string[];
  remove: string[];
  productType?: string;
  taxonomyId?: string;
}

/**
 * Цена ещё автоматическая (её ведёт синк), если все размеры стоят по последней
 * автоматической цене, или цены ещё нет (0 / `price:pending`), или это тестовая
 * партия. Любая ручная правка цены выводит товар из-под автоматики.
 */
export function isAutoPriced(shop: IndexedProduct): boolean {
  if (shop.tags.includes(PRICE_TEST_TAG) || shop.tags.includes(PRICE_PENDING_TAG)) return true;
  const prices = [...shop.variants.values()].map((v) => v.priceCents);
  if (prices.every((c) => c === 0)) return true;
  return shop.autoPriceCents !== null && prices.every((c) => c === shop.autoPriceCents);
}

/**
 * Один и тот же код? Сравниваем цифры; если Shopify хранит код короче
 * (международные 6 знаков от 8-значного кода ЕС), это не расхождение —
 * иначе синк переписывал бы его каждый проход.
 */
export function sameHsCode(feed: string, stored: string | null): boolean {
  if (!stored) return false;
  const a = feed.replace(/\D/g, "");
  const b = stored.replace(/\D/g, "");
  return a === b || (b.length >= 6 && a.startsWith(b));
}

export function planSync(
  evaluations: Evaluation[],
  index: Map<string, IndexedProduct>,
  opts: { inventoryCap?: number; costs?: CostSettings; market?: MarketTable } = {}
): SyncPlan {
  const cap = opts.inventoryCap ?? Infinity;
  const settings = opts.costs ?? DEFAULT_COSTS;
  const byKey = new Map(evaluations.map((e) => [e.product.key, e]));
  const plan: SyncPlan = { create: [], quantities: [], costs: [], customs: [], prices: [], compareAts: [], newVariants: [], tags: [], categories: [], remaps: [] };

  for (const e of evaluations) {
    if (e.include && !index.has(e.product.key)) plan.create.push(e);
  }

  for (const [key, shop] of index) {
    const e = byKey.get(key);
    const feedVariants = new Map((e?.product.variants ?? []).map((v) => [v.id, v]));

    // Поставщик сменил артикул размера: у нас размер есть, но его SKU в фиде
    // пропал, а в фиде есть другой SKU того же размера. Создать размер заново
    // Shopify не даст (значения опции уникальны) — перепривязываем существующий.
    const remapped = new Map<string, FeedProduct["variants"][number]>();
    if (e) {
      const orphans = [...shop.variants.values()].filter((sv) => !feedVariants.has(sv.sku));
      for (const fv of e.product.variants) {
        if (shop.variants.has(fv.id)) continue;
        const size = normalizeSize(fv.size);
        const sv = orphans.find((o) => normalizeSize(o.title) === size && !remapped.has(o.sku));
        if (!sv) continue;
        remapped.set(sv.sku, fv);
        plan.remaps.push({
          productId: shop.id,
          variantId: sv.id,
          fromSku: sv.sku,
          toSku: fv.id,
          supplierVariantId: fv.supplierVariantId,
        });
      }
    }

    // Остатки: правда — фид. Нет в фиде → 0.
    for (const [sku, sv] of shop.variants) {
      const fv = feedVariants.get(sku) ?? remapped.get(sku);
      const want = fv ? Math.max(0, Math.min(fv.quantity, cap)) : 0;
      if (want !== sv.quantity && sv.inventoryItemId) {
        plan.quantities.push({ inventoryItemId: sv.inventoryItemId, quantity: want, from: sv.quantity });
      }
    }

    // Таможня: код и страну из фида дописываем и исправляем. Пустое в фиде
    // не стирает уже записанное — пропуск у поставщика не повод терять данные.
    if (e) {
      const country = countryCode(e.product.madeIn);
      for (const [sku, sv] of shop.variants) {
        const hs = feedVariants.get(sku)?.hsCode || e.product.hsCode;
        const change: SyncPlan["customs"][number] = { inventoryItemId: sv.inventoryItemId };
        if (hs && !sameHsCode(hs, sv.hsCode)) change.harmonizedSystemCode = hs;
        if (country && country !== sv.countryCode) change.countryCodeOfOrigin = country;
        if (sv.inventoryItemId && (change.harmonizedSystemCode || change.countryCodeOfOrigin)) {
          plan.customs.push(change);
        }
      }
    }

    // Закупка: изменилась → новая себестоимость. Автоматическая цена
    // пересчитывается, ручная — пометка на проверку (I05).
    const auto = isAutoPriced(shop);
    let costChanged = false;
    let price: AutoPrice | null = null;
    let belowGrid = false;
    let modelPriceCents: number | null = [...shop.variants.values()][0]?.priceCents ?? null;
    if (e) {
      const priced = priceProduct(e.product, e.category, settings, opts.market);
      const est = priced.costs;
      price = priced.price;
      if (est) {
        for (const sv of shop.variants.values()) {
          if (sv.costCents !== est.purchaseUsdCents && sv.inventoryItemId) {
            plan.costs.push({ inventoryItemId: sv.inventoryItemId, costCents: est.purchaseUsdCents });
            if (sv.costCents !== null) costChanged = true;
          }
        }
      }
      if (auto && price) {
        const target = price.priceCents;
        const stale = [...shop.variants.values()].filter((v) => v.priceCents !== target);
        if (stale.length > 0 || shop.autoPriceCents !== target) {
          plan.prices.push({ productId: shop.id, variantIds: stale.map((v) => v.id), price });
        }
        modelPriceCents = target;
      } else if (!auto && est && modelPriceCents) {
        // Ручная цена ниже формулы v3.0 (все расходы с наценкой) — повод проверить.
        belowGrid = modelPriceCents < markupPriceCents(est.directCostsCents, est.purchaseUsdCents, settings.fee);
      }
      // Зачёркнутая цена: розница в Италии, если она выше цены размера.
      // Ведём её и у ручных цен — это факт о рынке, а не наша цена.
      const retail = retailItalyUsdCents(e.product.price, settings);
      const compareFixes: SyncPlan["compareAts"][number]["variants"] = [];
      for (const sv of shop.variants.values()) {
        const finalPrice = auto && price ? price.priceCents : sv.priceCents;
        const want = compareAtCents(retail, finalPrice);
        if (want !== sv.compareAtCents) compareFixes.push({ id: sv.id, compareAtCents: want });
      }
      if (compareFixes.length > 0) plan.compareAts.push({ productId: shop.id, variants: compareFixes });
      // Новые размеры, которых в магазине ещё нет.
      const remappedTo = new Set([...remapped.values()].map((v) => v.id));
      const missing = e.product.variants.filter(
        (v) => !shop.variants.has(v.id) && !remappedTo.has(v.id) && v.quantity > 0
      );
      // Размеры в магазине — по самим вариантам, а не по SKU из фида: SKU мог смениться.
      const existingSizes = new Set([...shop.variants.values()].map((sv) => normalizeSize(sv.title)));
      const fresh = missing.filter((v) => !existingSizes.has(normalizeSize(v.size)));
      if (fresh.length > 0) {
        plan.newVariants.push({ productId: shop.id, evaluation: e, variants: fresh, priceCents: modelPriceCents });
      }
    }

    // Служебные теги: пересчитываем только свои.
    // Категория: если товар до сих пор несёт теги, которые мы поставили по
    // данным фида, а с HS-кодом выходит другая категория — переносим. Теги,
    // исправленные менеджером, не совпадут с исходными — такой товар не трогаем.
    if (e?.category) {
      const legacy = classifyByFeed(e.product.productType, e.product.title)?.tags ?? [];
      const target = e.category.tags;
      const have = new Set(shop.tags);
      const untouched = legacy.every((t) => have.has(t));
      const add = target.filter((t) => !have.has(t));
      if (untouched && add.length > 0) {
        const assignment = resolveCategory(target);
        plan.categories.push({
          productId: shop.id,
          add,
          remove: legacy.filter((t) => !target.includes(t)),
          ...(assignment ? { productType: assignment.productType, taxonomyId: assignment.taxonomyId } : {}),
        });
      }
    }

    const want = new Set<string>(e ? e.reviewTags : []);
    if (e?.heroCandidate) want.add(HERO_CANDIDATE_TAG);
    if (!e || !e.include) want.add(EXCLUDED_TAG);
    if (auto) {
      // Модели нет в фиде — пересчитать нечем, пометку цены оставляем как была.
      const priced = e ? price !== null : !shop.tags.includes(PRICE_PENDING_TAG);
      want.add(priced ? PRICE_AUTO_TAG : PRICE_PENDING_TAG);
    }
    if (belowGrid) want.add(BELOW_GRID_TAG);
    const have = new Set(shop.tags);
    const add = [...want].filter((t) => !have.has(t));
    if (costChanged && !auto && !have.has(COST_CHANGED_TAG)) add.push(COST_CHANGED_TAG);
    const remove = shop.tags.filter((t) => OWNED_TAGS.has(t) && !want.has(t));
    if (add.length || remove.length) plan.tags.push({ productId: shop.id, add, remove });
  }
  return plan;
}

// ── Исполнение ─────────────────────────────────────────────────────────────

const SET_QUANTITIES = /* GraphQL */ `
  mutation TdfQty($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } }
  }
`;
const UPDATE_COST = /* GraphQL */ `
  mutation TdfCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } }
  }
`;
const TAGS_ADD = /* GraphQL */ `
  mutation TdfTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;
const TAGS_REMOVE = /* GraphQL */ `
  mutation TdfTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
  }
`;
const UPDATE_PRODUCT_CATEGORY = /* GraphQL */ `
  mutation TdfCategory($product: ProductUpdateInput!) {
    productUpdate(product: $product) { userErrors { field message } }
  }
`;
const UPDATE_CUSTOMS = /* GraphQL */ `
  mutation TdfCustoms($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } }
  }
`;
const UPDATE_PRICES = /* GraphQL */ `
  mutation TdfPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;
const SET_METAFIELDS = /* GraphQL */ `
  mutation TdfMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;
const VARIANTS_CREATE = /* GraphQL */ `
  mutation TdfVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

type Errors = { [k: string]: { userErrors: { message: string }[] } };

function collect(errors: string[], label: string, data: Errors): void {
  for (const payload of Object.values(data)) {
    for (const e of payload.userErrors) errors.push(`${label}: ${e.message}`);
  }
}

export interface SyncStats {
  feedProducts: number;
  eligible: number;
  created: number;
  createFailed: number;
  quantitiesSet: number;
  costsUpdated: number;
  customsUpdated: number;
  categoriesChanged: number;
  pricesUpdated: number;
  compareAtsUpdated: number;
  variantsAdded: number;
  variantsRemapped: number;
  tagsChanged: number;
  errors: string[];
}

export interface SyncOptions {
  feedUrl?: string;
  inventoryCap?: number;
  costs?: CostSettings;
  /** Создать не больше стольких новых моделей за проход (пилот, осторожный старт). */
  createLimit?: number;
  /** Только посчитать план, ничего не писать. */
  dryRun?: boolean;
  registry?: BrandRegistry;
  /** Цены конкурентов; по умолчанию — TDF_MARKET_CSV_URL или снимок data/tdf-market.csv. */
  market?: MarketTable;
  log?: (msg: string) => void;
}

export async function syncTdf(client: ShopifyClient, opts: SyncOptions = {}): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const products = await fetchFeed(opts.feedUrl ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL);
  const registry = opts.registry ?? (await loadBrandRegistry());
  const evaluations = products.map((p) => evaluate(p, registry));
  const locationId = await primaryLocationId(client);
  const index = await fetchIndex(client);
  const market = opts.market ?? (await loadMarket()).table;
  const plan = planSync(evaluations, index, { ...opts, market });
  const create = plan.create.slice(0, opts.createLimit ?? Infinity);

  const stats: SyncStats = {
    feedProducts: products.length,
    eligible: evaluations.filter((e) => e.include).length,
    created: 0,
    createFailed: 0,
    quantitiesSet: 0,
    costsUpdated: 0,
    customsUpdated: 0,
    categoriesChanged: 0,
    pricesUpdated: 0,
    compareAtsUpdated: 0,
    variantsAdded: 0,
    variantsRemapped: 0,
    tagsChanged: 0,
    errors: [],
  };
  log(
    `TDF: фид ${products.length} моделей, к импорту ${stats.eligible}, в магазине ${index.size}; ` +
      `создать ${create.length}, остатков ${plan.quantities.length}, закупок ${plan.costs.length}, кодов ${plan.customs.length}, категорий ${plan.categories.length}, цен ${plan.prices.length}, зачёркнутых ${plan.compareAts.length}, ` +
      `новых размеров ${plan.newVariants.length}, смена артикула ${plan.remaps.length}, тегов ${plan.tags.length}`
  );
  if (opts.dryRun) return stats;

  const buildOpts = { locationId, inventoryCap: opts.inventoryCap, costs: opts.costs, market };

  // Файл bulk-мутации Shopify ограничен 20 МБ, а модель в productSet весит ~4,7 КБ:
  // весь каталог (~4,4 тыс.) упирается в предел — грузим пачками.
  for (let i = 0; i < create.length; i += CREATE_CHUNK) {
    const chunk = create.slice(i, i + CREATE_CHUNK);
    const inputs = chunk.map((e) => ({ input: productSetInput(e, buildOpts) }));
    try {
      const { results } = await runBulkMutation<any>(client, PRODUCT_SET_MUTATION, inputs, {
        onProgress: (op) =>
          log(`TDF: создание товаров ${i + 1}–${i + chunk.length} из ${create.length} — ${op.status}, ${op.objectCount}`),
      });
      for (const r of results) {
        const errs = r.data?.productSet?.userErrors ?? [];
        if (r.data?.productSet?.product && errs.length === 0) stats.created++;
        else {
          stats.createFailed++;
          stats.errors.push(`productSet: ${errs.map((x: any) => x.message).join("; ") || JSON.stringify(r.errors ?? r)}`);
        }
      }
    } catch (err) {
      stats.errors.push(`bulk productSet: ${String(err)}`);
    }
  }

  // Остатки — пачками по 250 позиций.
  for (let i = 0; i < plan.quantities.length; i += 250) {
    const chunk = plan.quantities.slice(i, i + 250);
    const data = await client.graphql<Errors>(SET_QUANTITIES, {
      // С 2026-04 ключ идемпотентности обязателен; повтор той же пачки не задвоит остатки.
      key: randomUUID(),
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: "gid://italian-edit/TdfFeedSync/" + new Date().toISOString().slice(0, 13),
        quantities: chunk.map((q) => ({
          inventoryItemId: q.inventoryItemId,
          locationId,
          quantity: q.quantity,
          changeFromQuantity: null,
        })),
      },
    });
    collect(stats.errors, "остатки", data);
    stats.quantitiesSet += chunk.length;
  }

  for (const c of plan.costs) {
    const data = await client.graphql<Errors>(UPDATE_COST, {
      id: c.inventoryItemId,
      input: { cost: (c.costCents / 100).toFixed(2) },
    });
    collect(stats.errors, "закупка", data);
    stats.costsUpdated++;
  }

  // Таможенные данные — массово: при первом появлении кодов это ~10 тыс. вариантов.
  if (plan.customs.length > 0) {
    try {
      const { results } = await runBulkMutation<any>(
        client,
        UPDATE_CUSTOMS,
        plan.customs.map(({ inventoryItemId, ...input }) => ({ id: inventoryItemId, input })),
        { onProgress: (op) => log(`TDF: таможенные коды — ${op.status}, ${op.objectCount}`) }
      );
      for (const r of results) {
        const errs = r.data?.inventoryItemUpdate?.userErrors ?? [];
        if (errs.length > 0 || r.errors) {
          stats.errors.push(`таможня: ${errs.map((x: any) => x.message).join("; ") || JSON.stringify(r.errors)}`);
        } else stats.customsUpdated++;
      }
    } catch (err) {
      stats.errors.push(`bulk таможня: ${String(err)}`);
    }
  }

  const settings = opts.costs ?? DEFAULT_COSTS;
  if (plan.prices.length > BULK_PRICES_FROM) {
    // Смена логики цен (v3.0) или курса пересчитывает почти весь каталог:
    // поштучно это час, массово — минуты. Сначала цены, потом расчёт в tdf.pricing
    // (по нему следующий проход понимает, что цена ещё автоматическая).
    const priceChanges = plan.prices.filter((pc) => pc.variantIds.length > 0);
    try {
      const { results } = await runBulkMutation<any>(
        client,
        UPDATE_PRICES,
        priceChanges.map((pc) => ({
          productId: pc.productId,
          variants: pc.variantIds.map((id) => ({ id, price: (pc.price.priceCents / 100).toFixed(2) })),
        })),
        { onProgress: (op) => log(`TDF: цены — ${op.status}, ${op.objectCount}`) }
      );
      for (const r of results) {
        const errs = r.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (errs.length > 0 || r.errors) stats.errors.push(`цена: ${errs.map((x: any) => x.message).join("; ") || JSON.stringify(r.errors)}`);
      }
      const meta = await runBulkMutation<any>(
        client,
        SET_METAFIELDS,
        plan.prices.map((pc) => ({ metafields: [{ ownerId: pc.productId, ...pricingMetafield(pc.price, settings) }] })),
        { onProgress: (op) => log(`TDF: расчёт цен — ${op.status}, ${op.objectCount}`) }
      );
      for (const r of meta.results) {
        const errs = r.data?.metafieldsSet?.userErrors ?? [];
        if (errs.length > 0 || r.errors) stats.errors.push(`расчёт цены: ${errs.map((x: any) => x.message).join("; ") || JSON.stringify(r.errors)}`);
        else stats.pricesUpdated++;
      }
    } catch (err) {
      stats.errors.push(`bulk цены: ${String(err)}`);
    }
  } else {
    for (const pc of plan.prices) {
      if (pc.variantIds.length > 0) {
        const data = await client.graphql<Errors>(UPDATE_PRICES, {
          productId: pc.productId,
          variants: pc.variantIds.map((id) => ({ id, price: (pc.price.priceCents / 100).toFixed(2) })),
        });
        collect(stats.errors, "цена", data);
      }
      // Записанная цена — признак «цена ещё автоматическая» для следующего прохода.
      const meta = await client.graphql<Errors>(SET_METAFIELDS, {
        metafields: [{ ownerId: pc.productId, ...pricingMetafield(pc.price, settings) }],
      });
      collect(stats.errors, "расчёт цены", meta);
      stats.pricesUpdated++;
    }
  }

  // Зачёркнутые цены — массово: при первом проходе это весь каталог.
  if (plan.compareAts.length > 0) {
    try {
      const { results } = await runBulkMutation<any>(
        client,
        UPDATE_PRICES,
        plan.compareAts.map((c) => ({
          productId: c.productId,
          variants: c.variants.map((v) => ({
            id: v.id,
            compareAtPrice: v.compareAtCents === null ? null : (v.compareAtCents / 100).toFixed(2),
          })),
        })),
        { onProgress: (op) => log(`TDF: зачёркнутые цены — ${op.status}, ${op.objectCount}`) }
      );
      for (const r of results) {
        const errs = r.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (errs.length > 0 || r.errors) {
          stats.errors.push(`зачёркнутая цена: ${errs.map((x: any) => x.message).join("; ") || JSON.stringify(r.errors)}`);
        } else stats.compareAtsUpdated++;
      }
    } catch (err) {
      stats.errors.push(`bulk зачёркнутые цены: ${String(err)}`);
    }
  }

  for (const r of plan.remaps) {
    const data = await client.graphql<Errors>(UPDATE_PRICES, {
      productId: r.productId,
      variants: [{
        id: r.variantId,
        inventoryItem: { sku: r.toSku },
        metafields: [
          { namespace: TDF_NAMESPACE, key: "variant_id", type: "single_line_text_field", value: r.toSku },
          ...(r.supplierVariantId
            ? [{
                namespace: TDF_NAMESPACE,
                key: "supplier_variant_gid",
                type: "single_line_text_field",
                value: `gid://shopify/ProductVariant/${r.supplierVariantId}`,
              }]
            : []),
        ],
      }],
    });
    collect(stats.errors, "смена артикула", data);
    stats.variantsRemapped++;
  }

  for (const nv of plan.newVariants) {
    const e = nv.evaluation;
    const { costs: est } = priceProduct(e.product, e.category, settings, opts.market);
    const variants = nv.variants.map((v) => {
      // sku у productVariantsBulkCreate живёт только в inventoryItem.
      const { inventoryQuantities, sku: _sku, ...rest } = variantInput(
        v,
        est?.purchaseUsdCents ?? null,
        countryCode(e.product.madeIn),
        buildOpts,
        nv.priceCents,
        compareAtCents(retailItalyUsdCents(e.product.price, settings), nv.priceCents)
      );
      // У productVariantsBulkCreate остаток задаётся полем inventoryQuantities
      // с availableQuantity, а не quantity/name, как у productSet.
      return {
        ...rest,
        inventoryQuantities: inventoryQuantities.map((q) => ({
          locationId: q.locationId,
          availableQuantity: q.quantity,
        })),
      };
    });
    const data = await client.graphql<Errors>(VARIANTS_CREATE, { productId: nv.productId, variants });
    collect(stats.errors, "размеры", data);
    stats.variantsAdded += variants.length;
  }

  for (const c of plan.categories) {
    if (c.add.length) collect(stats.errors, "категория", await client.graphql<Errors>(TAGS_ADD, { id: c.productId, tags: c.add }));
    if (c.remove.length) {
      collect(stats.errors, "категория", await client.graphql<Errors>(TAGS_REMOVE, { id: c.productId, tags: c.remove }));
    }
    if (c.taxonomyId) {
      const data = await client.graphql<Errors>(UPDATE_PRODUCT_CATEGORY, {
        product: { id: c.productId, productType: c.productType, category: c.taxonomyId },
      });
      collect(stats.errors, "категория", data);
    }
    stats.categoriesChanged++;
  }

  for (const t of plan.tags) {
    if (t.add.length) collect(stats.errors, "теги", await client.graphql<Errors>(TAGS_ADD, { id: t.productId, tags: t.add }));
    if (t.remove.length) {
      collect(stats.errors, "теги", await client.graphql<Errors>(TAGS_REMOVE, { id: t.productId, tags: t.remove }));
    }
    stats.tagsChanged++;
  }

  log(`TDF: готово — ${JSON.stringify({ ...stats, errors: stats.errors.length })}`);
  return stats;
}
