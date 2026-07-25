import type { ShopifyClient } from "./client";
import { warehouseTag, warehouseFromTags } from "./warehouse";
import { warehouseForBrand } from "./warehouseByBrand";

/**
 * Дотегирование товаров в магазине (режим IMPORT_MODE=app).
 *
 * Приложение BrandsGateway заливает товары само и ставит теги категории/пола,
 * но НЕ ставит склад. Здесь мы читаем товары через наш Shopify Admin API
 * и добавляем недостающие теги, на которых держатся фильтры витрины:
 *   - EU | US            (переключатель «откуда едет» Ships from, выводим из бренда)
 *   - designer:<бренд>   (фильтр по дизайнеру, из vendor)
 * Только ДОБАВЛЯЕМ теги — ничего не удаляем; идемпотентно (уже помеченные пропускаем).
 */

interface ProductNode {
  id: string;
  vendor: string | null;
  tags: string[];
}

const PRODUCTS_PAGE = /* GraphQL */ `
  query TaggerProducts($cursor: String, $q: String!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { id vendor tags }
    }
  }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation TaggerAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

function designerTag(vendor: string): string {
  return `designer:${vendor.trim().toLowerCase()}`;
}

/** Каких тегов не хватает товару (склад + дизайнер). Пусто — трогать не нужно. */
export function missingTags(node: ProductNode): string[] {
  const tags: string[] = [];
  const lower = node.tags.map((t) => t.trim().toLowerCase());

  if (!warehouseFromTags(node.tags)) {
    tags.push(warehouseTag(warehouseForBrand(node.vendor)));
  }
  if (node.vendor) {
    const dt = designerTag(node.vendor);
    if (!lower.includes(dt)) tags.push(dt);
  }
  return tags;
}

export interface TagStats {
  scanned: number;
  tagged: number;
  failed: number;
}

/**
 * Проходит по товарам без тега склада и добавляет недостающие теги.
 * Запрос отбирает кандидатов на стороне Shopify; идемпотентность — в missingTags.
 */
export async function tagStoreProducts(
  client: ShopifyClient,
  opts: { maxProducts?: number } = {}
): Promise<TagStats> {
  const stats: TagStats = { scanned: 0, tagged: 0, failed: 0 };
  const limit = opts.maxProducts ?? 250;
  // Кандидаты: без тега склада (наши TG-товары тоже подхватятся — они EU из Италии).
  // Формат тегов держим через warehouseTag, чтобы запрос не рассинхронился со схемой витрины.
  const query = `-tag:'${warehouseTag("eu")}' -tag:'${warehouseTag("us")}' status:active,draft`;
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

    for (const node of nodes) {
      stats.scanned++;
      const add = missingTags(node);
      if (add.length === 0) continue;
      try {
        const res = await client.graphql<{
          tagsAdd: { userErrors: { message: string }[] };
        }>(TAGS_ADD, { id: node.id, tags: add });
        if (res.tagsAdd.userErrors.length > 0) {
          stats.failed++;
        } else {
          stats.tagged++;
        }
      } catch {
        stats.failed++;
      }
    }

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
