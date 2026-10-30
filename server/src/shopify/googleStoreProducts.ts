import type { ShopifyClient } from "./client";
import {
  computeGoogle,
  planGoogle,
  GOOGLE_NAMESPACE,
  type GoogleKey,
  type GoogleVariantInput,
} from "./google";

/**
 * Метаполя Google Merchant Center на вариантах (`mm-google-shopping.*`):
 * пол, возраст, состояние, MPN, система размеров, custom labels 0–3.
 * Правила — в google.ts.
 *
 * Идём по вариантам активных товаров (в фид Google попадают только они)
 * страницами по 50 и пишем только расхождения: одним productVariantsBulkUpdate
 * на товар в пределах страницы. Идемпотентна: если всё совпадает, записей нет.
 *
 * dryRun — ничего не пишет, возвращает план (для проверки на выборке).
 */

interface VariantNode extends GoogleVariantInput {
  id: string;
  title: string;
  product: { id: string; title: string; tags: string[]; pricing: { value: string } | null };
  metafields: { nodes: { key: string; value: string }[] };
}

const VARIANTS_PAGE = /* GraphQL */ `
  query GoogleVariants($cursor: String, $q: String!) {
    productVariants(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        sku
        price
        compareAtPrice
        selectedOptions { name value }
        product {
          id
          title
          tags
          pricing: metafield(namespace: "tdf", key: "pricing") { value }
        }
        metafields(first: 20, namespace: "${GOOGLE_NAMESPACE}") { nodes { key value } }
      }
    }
  }
`;

const VARIANTS_UPDATE = /* GraphQL */ `
  mutation GoogleVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

export interface GooglePlanEntry {
  product: string;
  variant: string;
  set: { key: GoogleKey; value: string }[];
}

export interface GoogleStats {
  scanned: number;
  /** Вариантов, которым что-то записали (в dryRun — записали бы). */
  updated: number;
  failed: number;
  /** Вариант без пола, MPN или раздела — показать глазами. */
  gaps: { gender: number; mpn: number; section: number };
  /** План записи; заполняется только в dryRun. */
  plan: GooglePlanEntry[];
  errors: string[];
}

export async function googleStoreProducts(
  client: ShopifyClient,
  opts: { maxVariants?: number; dryRun?: boolean; query?: string } = {}
): Promise<GoogleStats> {
  const stats: GoogleStats = {
    scanned: 0,
    updated: 0,
    failed: 0,
    gaps: { gender: 0, mpn: 0, section: 0 },
    plan: [],
    errors: [],
  };
  const limit = opts.maxVariants ?? 50_000;
  const query = opts.query ?? "product_status:active";
  let cursor: string | undefined;

  while (stats.scanned < limit) {
    const data = await client.graphql<{
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: VariantNode[];
      };
    }>(VARIANTS_PAGE, { cursor: cursor ?? null, q: query });

    const { nodes, pageInfo } = data.productVariants;
    if (nodes.length === 0) break;

    // productId → варианты к записи. Порядок товаров сохраняем для читаемого плана.
    const byProduct = new Map<string, { id: string; metafields: object[] }[]>();

    for (const node of nodes) {
      if (stats.scanned >= limit) break;
      stats.scanned++;
      const wanted = computeGoogle(
        { tags: node.product.tags, pricing: node.product.pricing?.value ?? null },
        node
      );
      if (!wanted.gender) stats.gaps.gender++;
      if (!wanted.mpn) stats.gaps.mpn++;
      if (!wanted.custom_label_0) stats.gaps.section++;

      const current = Object.fromEntries(node.metafields.nodes.map((m) => [m.key, m.value]));
      const set = planGoogle(wanted, current);
      if (set.length === 0) continue;

      if (opts.dryRun) {
        stats.plan.push({ product: node.product.title, variant: node.title, set });
        stats.updated++;
        continue;
      }
      const list = byProduct.get(node.product.id) ?? [];
      list.push({
        id: node.id,
        metafields: set.map(({ key, value }) => ({
          namespace: GOOGLE_NAMESPACE,
          key,
          type: "single_line_text_field",
          value,
        })),
      });
      byProduct.set(node.product.id, list);
    }

    for (const [productId, variants] of byProduct) {
      try {
        const res = await client.graphql<{
          productVariantsBulkUpdate: { userErrors: { message: string }[] };
        }>(VARIANTS_UPDATE, { productId, variants });
        const errors = res.productVariantsBulkUpdate.userErrors;
        if (errors.length > 0) {
          stats.failed += variants.length;
          stats.errors.push(`${productId}: ${errors[0].message}`);
        } else {
          stats.updated += variants.length;
        }
      } catch (err) {
        stats.failed += variants.length;
        stats.errors.push(`${productId}: ${(err as Error).message}`);
      }
    }

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
