import type { ShopifyClient } from "./client";
import { parseBgDescription } from "./description";
import { RAW_METAFIELD } from "./rewriteDescriptions";
import {
  colorFamilies,
  genderValues,
  priceBand,
  PRICE_BAND_COUNTRY,
  saleBand,
  subcategoryValues,
  type PricedVariant,
} from "./facets";

/**
 * Метаполя для фильтров каталога (Search & Discovery): пол, подкатегория,
 * семейство цвета, полоса скидки, диапазон евро-цены. Значения выводит facets.ts.
 *
 * Задача приводит метаполя к вычисленному: пишет новые и изменившиеся,
 * удаляет те, которым значения больше нет (скидку сняли — товар уходит из Sale).
 * Идемпотентна: если всё совпадает, запросов на запись нет.
 *
 * Идём по всему каталогу: «метаполе устарело» поиском Shopify не отобрать,
 * а чтение страницами по 50 дешёвое.
 */

export const FACET_NAMESPACE = "italian_edit";

/** Ключ метаполя → тип. Списки — потому что у товара бывает два пола или два цвета. */
export const FACET_FIELDS = {
  gender: "list.single_line_text_field",
  subcategory: "list.single_line_text_field",
  color: "list.single_line_text_field",
  sale: "single_line_text_field",
  price_band: "single_line_text_field",
} as const;

export type FacetKey = keyof typeof FACET_FIELDS;

interface ProductNode {
  id: string;
  title: string;
  vendor: string | null;
  tags: string[];
  descriptionHtml: string;
  options: { name: string; values: string[] }[];
  variants: { nodes: (PricedVariant & { contextualPricing?: { price: { amount: string } } | null })[] };
  rawDescription: { value: string } | null;
  gender: { value: string } | null;
  subcategory: { value: string } | null;
  color: { value: string } | null;
  sale: { value: string } | null;
  price_band: { value: string } | null;
}

const PRODUCTS_PAGE = /* GraphQL */ `
  query FacetProducts($cursor: String, $q: String!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        vendor
        tags
        descriptionHtml
        options { name values }
        variants(first: 100) {
          nodes {
            price
            compareAtPrice
            contextualPricing(context: { country: ${PRICE_BAND_COUNTRY} }) { price { amount } }
          }
        }
        rawDescription: metafield(namespace: "${RAW_METAFIELD.namespace}", key: "${RAW_METAFIELD.key}") { value }
        gender: metafield(namespace: "${FACET_NAMESPACE}", key: "gender") { value }
        subcategory: metafield(namespace: "${FACET_NAMESPACE}", key: "subcategory") { value }
        color: metafield(namespace: "${FACET_NAMESPACE}", key: "color") { value }
        sale: metafield(namespace: "${FACET_NAMESPACE}", key: "sale") { value }
        price_band: metafield(namespace: "${FACET_NAMESPACE}", key: "price_band") { value }
      }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation FacetSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

const METAFIELDS_DELETE = /* GraphQL */ `
  mutation FacetDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

/** Значения фильтров товара. Пустой список / null — метаполя быть не должно. */
export type FacetValues = Record<FacetKey, string[] | string | null>;

export function computeFacets(
  node: Omit<ProductNode, "id" | "gender" | "subcategory" | "color" | "sale" | "price_band">
): FacetValues {
  // Цвет из описания BG: исходник лежит в метаполе, если описание уже пересобрано.
  const facts = parseBgDescription(node.rawDescription?.value || node.descriptionHtml || "");
  return {
    gender: genderValues(node.tags),
    subcategory: subcategoryValues(node.tags),
    color: colorFamilies({
      title: node.title,
      vendor: node.vendor,
      tags: node.tags,
      options: node.options,
      descriptionColor: facts?.color ?? null,
    }),
    sale: saleBand(node.variants.nodes),
    // Евро-цена рынка International EUR; нет её — диапазона нет (фильтр Price
    // в евро такой товар просто не покажет, в долларах работает штатный фильтр).
    price_band: priceBand(
      node.variants.nodes.map((v) => Number(v.contextualPricing?.price.amount ?? NaN))
    ),
  };
}

/** Значение метаполя в виде, который хранит Shopify (списки — JSON-массив). */
function serialize(key: FacetKey, value: string[] | string | null): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value) : null;
  return FACET_FIELDS[key].startsWith("list.") ? JSON.stringify([value]) : value;
}

/** Нормализуем хранимое значение для сравнения: порядок в JSON-массиве Shopify сохраняет. */
function stored(field: { value: string } | null): string | null {
  return field?.value ?? null;
}

export interface FacetPlan {
  set: { key: FacetKey; value: string }[];
  remove: FacetKey[];
}

/** Что записать и что удалить, чтобы метаполя товара совпали с вычисленными. */
export function planFacets(node: ProductNode, wanted: FacetValues = computeFacets(node)): FacetPlan {
  const plan: FacetPlan = { set: [], remove: [] };
  for (const key of Object.keys(FACET_FIELDS) as FacetKey[]) {
    const next = serialize(key, wanted[key]);
    const current = stored(node[key]);
    if (next === current) continue;
    if (next === null) plan.remove.push(key);
    else plan.set.push({ key, value: next });
  }
  return plan;
}

export interface FacetStats {
  scanned: number;
  /** Товаров, у которых что-то поменялось. */
  updated: number;
  /** Товаров без единого цвета — словарь стоит пополнить (facets.ts). */
  colorless: string[];
  failed: number;
}

/** Предел metafieldsSet — 25 метаполей за запрос. */
const SET_BATCH = 25;

export async function facetStoreProducts(
  client: ShopifyClient,
  opts: { maxProducts?: number } = {}
): Promise<FacetStats> {
  const stats: FacetStats = { scanned: 0, updated: 0, colorless: [], failed: 0 };
  const limit = opts.maxProducts ?? 20_000;
  // Архив не трогаем — его нет на витрине.
  const query = "status:active,draft";
  let cursor: string | undefined;

  while (stats.scanned < limit) {
    const data = await client.graphql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ProductNode[];
      };
    }>(PRODUCTS_PAGE, { cursor: cursor ?? null, q: query });

    const { nodes, pageInfo } = data.products;
    if (nodes.length === 0) break;

    const toSet: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = [];
    const toDelete: { ownerId: string; namespace: string; key: string }[] = [];
    const touched = new Set<string>();

    for (const node of nodes) {
      stats.scanned++;
      const wanted = computeFacets(node);
      if (Array.isArray(wanted.color) && wanted.color.length === 0) stats.colorless.push(node.title);
      const plan = planFacets(node, wanted);
      if (plan.set.length === 0 && plan.remove.length === 0) continue;
      touched.add(node.id);
      for (const { key, value } of plan.set) {
        toSet.push({ ownerId: node.id, namespace: FACET_NAMESPACE, key, type: FACET_FIELDS[key], value });
      }
      for (const key of plan.remove) {
        toDelete.push({ ownerId: node.id, namespace: FACET_NAMESPACE, key });
      }
    }

    const failedOwners = new Set<string>();
    for (let i = 0; i < toSet.length; i += SET_BATCH) {
      const batch = toSet.slice(i, i + SET_BATCH);
      try {
        const res = await client.graphql<{
          metafieldsSet: { userErrors: { message: string }[] };
        }>(METAFIELDS_SET, { metafields: batch });
        // metafieldsSet атомарен: при ошибке не записалось ничего из пачки.
        if (res.metafieldsSet.userErrors.length > 0) batch.forEach((m) => failedOwners.add(m.ownerId));
      } catch {
        batch.forEach((m) => failedOwners.add(m.ownerId));
      }
    }
    if (toDelete.length > 0) {
      try {
        const res = await client.graphql<{
          metafieldsDelete: { userErrors: { message: string }[] };
        }>(METAFIELDS_DELETE, { metafields: toDelete });
        if (res.metafieldsDelete.userErrors.length > 0) toDelete.forEach((m) => failedOwners.add(m.ownerId));
      } catch {
        toDelete.forEach((m) => failedOwners.add(m.ownerId));
      }
    }

    stats.failed += failedOwners.size;
    stats.updated += touched.size - [...failedOwners].filter((id) => touched.has(id)).length;

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
