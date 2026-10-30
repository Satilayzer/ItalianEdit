import type { ShopifyClient } from "./client";
import { FACET_NAMESPACE } from "./facetStoreProducts";
import {
  computeProductAttrs,
  planProductAttrs,
  MATERIAL_GROUPS,
  type ProductAttrValues,
} from "./googleProduct";

/**
 * Цвет и материал товаров в стандартных атрибутах Shopify (`shopify.*`),
 * откуда их берёт фид Google. Правила — в googleProduct.ts.
 *
 * Идём по активным товарам страницами по 50, пишем только расхождения
 * (metafieldsSet по 25). Идемпотентна. dryRun — ничего не пишет, отдаёт план.
 */

interface ProductNode {
  id: string;
  title: string;
  descriptionHtml: string;
  category: { id: string } | null;
  colorFacet: { value: string } | null;
  [key: string]: unknown;
}

/** Алиас GraphQL не может содержать «-»: color-pattern → color_pattern и т. д. */
const alias = (key: string) => key.replace(/-/g, "_");
const KEYS = ["color-pattern", ...MATERIAL_GROUPS] as const;

const PRODUCTS_PAGE = /* GraphQL */ `
  query GoogleProductAttrs($cursor: String, $q: String!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        descriptionHtml
        category { id }
        colorFacet: metafield(namespace: "${FACET_NAMESPACE}", key: "color") { value }
        ${KEYS.map((k) => `${alias(k)}: metafield(namespace: "shopify", key: "${k}") { value }`).join("\n        ")}
      }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation GoogleProductAttrsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

export interface ProductAttrStats {
  scanned: number;
  updated: number;
  failed: number;
  /** Товаров без цвета / без материала (материал — только где у категории есть атрибут). */
  gaps: { color: number; material: number };
  plan: { product: string; set: { key: keyof ProductAttrValues; value: string }[] }[];
  errors: string[];
}

/** Предел metafieldsSet — 25 метаполей за запрос. */
const SET_BATCH = 25;

export async function googleProductStore(
  client: ShopifyClient,
  opts: { maxProducts?: number; dryRun?: boolean; query?: string } = {}
): Promise<ProductAttrStats> {
  const stats: ProductAttrStats = { scanned: 0, updated: 0, failed: 0, gaps: { color: 0, material: 0 }, plan: [], errors: [] };
  const limit = opts.maxProducts ?? 20_000;
  const query = opts.query ?? "status:active";
  let cursor: string | undefined;

  while (stats.scanned < limit) {
    const data = await client.graphql<{
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] };
    }>(PRODUCTS_PAGE, { cursor: cursor ?? null, q: query });

    const { nodes, pageInfo } = data.products;
    if (nodes.length === 0) break;

    const toSet: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = [];
    for (const node of nodes) {
      if (stats.scanned >= limit) break;
      stats.scanned++;
      const wanted = computeProductAttrs({
        categoryId: node.category?.id ?? null,
        descriptionHtml: node.descriptionHtml,
        colorFacet: node.colorFacet?.value ?? null,
      });
      if (!wanted["color-pattern"]) stats.gaps.color++;
      if (!MATERIAL_GROUPS.some((g) => wanted[g])) stats.gaps.material++;

      const current = Object.fromEntries(
        KEYS.map((k) => [k, (node[alias(k)] as { value: string } | null)?.value ?? null])
      );
      const set = planProductAttrs(wanted, current);
      if (set.length === 0) continue;

      stats.updated++;
      if (opts.dryRun) {
        stats.plan.push({ product: node.title, set });
        continue;
      }
      for (const { key, value } of set) {
        toSet.push({ ownerId: node.id, namespace: "shopify", key, type: "list.metaobject_reference", value });
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
        if (res.metafieldsSet.userErrors.length > 0) {
          batch.forEach((m) => failedOwners.add(m.ownerId));
          stats.errors.push(res.metafieldsSet.userErrors[0].message);
        }
      } catch (err) {
        batch.forEach((m) => failedOwners.add(m.ownerId));
        stats.errors.push((err as Error).message);
      }
    }
    stats.failed += failedOwners.size;
    stats.updated -= failedOwners.size;

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
