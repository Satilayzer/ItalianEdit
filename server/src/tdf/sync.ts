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
  PRICE_AUTO_TAG,
  PRICE_PENDING_TAG,
} from "./productInput";
import { countryCode, DEFAULT_COSTS, type CostSettings } from "./economics";
import { economics, type AutoPrice } from "./pricing";

/** API, под который написаны мутации модуля (changeFromQuantity, productSet.files). */
export const TDF_API_VERSION = "2026-07";

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
                price
                inventoryQuantity
                inventoryItem { id unitCost { amount } }
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
  quantity: number;
  inventoryItemId: string;
  costCents: number | null;
  priceCents: number;
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
      quantity: r.inventoryQuantity ?? 0,
      inventoryItemId: r.inventoryItem?.id,
      costCents: amount != null ? Math.round(Number(amount) * 100) : null,
      priceCents: Math.round(Number(r.price ?? 0) * 100),
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

export interface SyncPlan {
  create: Evaluation[];
  quantities: { inventoryItemId: string; quantity: number; from: number }[];
  costs: { inventoryItemId: string; costCents: number }[];
  prices: PriceChange[];
  newVariants: {
    productId: string;
    evaluation: Evaluation;
    variants: FeedProduct["variants"];
    /** Цена новых размеров — как у модели. */
    priceCents: number | null;
  }[];
  tags: TagChange[];
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

export function planSync(
  evaluations: Evaluation[],
  index: Map<string, IndexedProduct>,
  opts: { inventoryCap?: number; costs?: CostSettings } = {}
): SyncPlan {
  const cap = opts.inventoryCap ?? Infinity;
  const settings = opts.costs ?? DEFAULT_COSTS;
  const byKey = new Map(evaluations.map((e) => [e.product.key, e]));
  const plan: SyncPlan = { create: [], quantities: [], costs: [], prices: [], newVariants: [], tags: [] };

  for (const e of evaluations) {
    if (e.include && !index.has(e.product.key)) plan.create.push(e);
  }

  for (const [key, shop] of index) {
    const e = byKey.get(key);
    const feedVariants = new Map((e?.product.variants ?? []).map((v) => [v.id, v]));

    // Остатки: правда — фид. Нет в фиде → 0.
    for (const [sku, sv] of shop.variants) {
      const fv = feedVariants.get(sku);
      const want = fv ? Math.max(0, Math.min(fv.quantity, cap)) : 0;
      if (want !== sv.quantity && sv.inventoryItemId) {
        plan.quantities.push({ inventoryItemId: sv.inventoryItemId, quantity: want, from: sv.quantity });
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
      const priced = priceProduct(e.product, e.category, settings);
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
        belowGrid = !economics(modelPriceCents, est.directCostsCents, settings.fee).passes;
      }
      // Новые размеры, которых в магазине ещё нет.
      const missing = e.product.variants.filter((v) => !shop.variants.has(v.id) && v.quantity > 0);
      const existingSizes = new Set(
        [...shop.variants.keys()]
          .map((sku) => feedVariants.get(sku))
          .filter(Boolean)
          .map((v) => normalizeSize(v!.size))
      );
      const fresh = missing.filter((v) => !existingSizes.has(normalizeSize(v.size)));
      if (fresh.length > 0) {
        plan.newVariants.push({ productId: shop.id, evaluation: e, variants: fresh, priceCents: modelPriceCents });
      }
    }

    // Служебные теги: пересчитываем только свои.
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
  pricesUpdated: number;
  variantsAdded: number;
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
  log?: (msg: string) => void;
}

export async function syncTdf(client: ShopifyClient, opts: SyncOptions = {}): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const products = await fetchFeed(opts.feedUrl ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL);
  const registry = opts.registry ?? (await loadBrandRegistry());
  const evaluations = products.map((p) => evaluate(p, registry));
  const locationId = await primaryLocationId(client);
  const index = await fetchIndex(client);
  const plan = planSync(evaluations, index, opts);
  const create = plan.create.slice(0, opts.createLimit ?? Infinity);

  const stats: SyncStats = {
    feedProducts: products.length,
    eligible: evaluations.filter((e) => e.include).length,
    created: 0,
    createFailed: 0,
    quantitiesSet: 0,
    costsUpdated: 0,
    pricesUpdated: 0,
    variantsAdded: 0,
    tagsChanged: 0,
    errors: [],
  };
  log(
    `TDF: фид ${products.length} моделей, к импорту ${stats.eligible}, в магазине ${index.size}; ` +
      `создать ${create.length}, остатков ${plan.quantities.length}, закупок ${plan.costs.length}, цен ${plan.prices.length}, ` +
      `новых размеров ${plan.newVariants.length}, тегов ${plan.tags.length}`
  );
  if (opts.dryRun) return stats;

  const buildOpts = { locationId, inventoryCap: opts.inventoryCap, costs: opts.costs };

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

  const settings = opts.costs ?? DEFAULT_COSTS;
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

  for (const nv of plan.newVariants) {
    const e = nv.evaluation;
    const { costs: est } = priceProduct(e.product, e.category, settings);
    const variants = nv.variants.map((v) => {
      // sku у productVariantsBulkCreate живёт только в inventoryItem.
      const { inventoryQuantities, sku: _sku, ...rest } = variantInput(
        v,
        est?.purchaseUsdCents ?? null,
        countryCode(e.product.madeIn),
        buildOpts,
        nv.priceCents
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
