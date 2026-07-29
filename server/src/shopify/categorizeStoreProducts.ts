import type { ShopifyClient } from "./client";
import { categoryPatch, type CategorizableProduct } from "./category";

/**
 * Простановка полей Category и Product type товарам магазина.
 *
 * Ни приложение BrandsGateway, ни бот их не заполняют — у BG есть только свои
 * категорийные теги, у бота легаси `category:*`. Витрине этого хватает
 * (навигация на тегах), а вот фиды Google/Meta, расчёт налогов и маркетплейсы
 * читают именно поля товара. Здесь мы выводим их из тегов (см. category.ts).
 *
 * Только ДОПИСЫВАЕТ пустые поля: категорию, проставленную менеджером вручную,
 * задача не перезаписывает. Идемпотентна — повторный проход ничего не делает.
 *
 * Отобрать кандидатов на стороне Shopify нельзя: поиск товаров не умеет
 * «category пустая». Поэтому идём страницами по всему каталогу и отсеиваем
 * уже заполненные на нашей стороне — дёшево, запросов на запись не порождает.
 */

interface ProductNode extends CategorizableProduct {
  id: string;
  title: string;
}

const PRODUCTS_PAGE = /* GraphQL */ `
  query CategorizerProducts($cursor: String, $q: String!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        tags
        productType
        category { id }
      }
    }
  }
`;

const PRODUCT_UPDATE = /* GraphQL */ `
  mutation CategorizerUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      userErrors { field message }
    }
  }
`;

export interface CategoryStats {
  scanned: number;
  /** Полям проставлены значения. */
  updated: number;
  /** Уже заполнены — трогать нечего. */
  skipped: number;
  /** Категория не опознана по тегам: товар оставлен как есть. */
  unresolved: string[];
  failed: number;
}

export async function categorizeStoreProducts(
  client: ShopifyClient,
  opts: { maxProducts?: number } = {}
): Promise<CategoryStats> {
  const stats: CategoryStats = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    unresolved: [],
    failed: 0,
  };
  const limit = opts.maxProducts ?? 250;
  // Архивные товары не трогаем — они ни в фидах, ни на витрине.
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

    for (const node of nodes) {
      stats.scanned++;
      const patch = categoryPatch(node);

      if (!patch) {
        // Разделяем два разных «ничего не делаем»: поля уже стоят —
        // это норма, а вот неопознанные теги стоит показать глазами.
        if (node.category?.id && node.productType?.trim()) stats.skipped++;
        else stats.unresolved.push(node.title);
        continue;
      }

      try {
        const res = await client.graphql<{
          productUpdate: { userErrors: { message: string }[] };
        }>(PRODUCT_UPDATE, { product: { id: node.id, ...patch } });
        if (res.productUpdate.userErrors.length > 0) stats.failed++;
        else stats.updated++;
      } catch {
        stats.failed++;
      }
    }

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
