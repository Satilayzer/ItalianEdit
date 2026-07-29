import type { ShopifyClient } from "./client";
import {
  parseBgDescription,
  buildDescriptionHtml,
  isRewrittenDescription,
} from "./description";

/**
 * Пересборка описаний товаров BrandsGateway (режим IMPORT_MODE=app).
 *
 * Приложение BG заливает описание машинным текстом с внутренними кодами —
 * см. description.ts. Здесь мы читаем его, разбираем на факты и записываем
 * человеческую вёрстку обратно.
 *
 * Три предосторожности, без которых задачу нельзя выпускать на живой каталог:
 *
 *  1. Оригинал сохраняем в метаполе `italian_edit.bg_description_raw` в той же
 *     мутации, что и перезапись. Перезаписав описание, мы теряем исходник
 *     безвозвратно, а разбор ещё будет дорабатываться под новые форматы фида.
 *
 *  2. Товары бота обходим стороной (`-tag:tg-bot`): у них настоящий текст
 *     бренда, он заведомо лучше всего, что соберётся из спецификации.
 *
 *  3. Свою вёрстку узнаём по классу-метке и второй раз не трогаем. Если
 *     приложение BG затрёт описание своим при ресинке — метки не будет,
 *     и следующий проход пересоберёт заново (задача самовосстанавливается,
 *     как тегировщик).
 */

interface ProductNode {
  id: string;
  title: string;
  vendor: string | null;
  descriptionHtml: string | null;
  /** MPN из метаполя приложения BG — запасной источник Style Code. */
  mpnMetafield?: { value: string | null } | null;
}

const PRODUCTS_PAGE = /* GraphQL */ `
  query RewriteDescriptionsPage($cursor: String, $q: String!) {
    products(first: 25, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        vendor
        descriptionHtml
        mpnMetafield: metafield(namespace: "shopwoo", key: "_sw_mpn") { value }
      }
    }
  }
`;

const PRODUCT_UPDATE = /* GraphQL */ `
  mutation RewriteDescription($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      userErrors { field message }
    }
  }
`;

export const RAW_METAFIELD = {
  namespace: "italian_edit",
  key: "bg_description_raw",
  type: "multi_line_text_field",
} as const;

export interface DescriptionStats {
  scanned: number;
  /** Описание пересобрано. */
  rewritten: number;
  /** Уже наша вёрстка — трогать нечего. */
  alreadyOurs: number;
  /** Формат не наш (текст бренда, ручное описание) — оставили как есть. */
  foreign: string[];
  failed: number;
}

/** Что записать товару: новое описание + сохранённый оригинал. */
export function buildUpdate(node: ProductNode): Record<string, unknown> | null {
  const raw = node.descriptionHtml ?? "";
  if (isRewrittenDescription(raw)) return null;

  const facts = parseBgDescription(raw);
  if (!facts) return null;

  // В шаблонной фразе MPN есть, в авторском тексте — нет. Тогда берём его
  // из метаполя приложения BG, чтобы Style Code был не только у части товаров.
  if (!facts.mpn && node.mpnMetafield?.value) {
    facts.mpn = node.mpnMetafield.value;
  }

  return {
    id: node.id,
    descriptionHtml: buildDescriptionHtml(facts, {
      title: node.title,
      vendor: node.vendor,
    }),
    metafields: [{ ...RAW_METAFIELD, value: raw }],
  };
}

export async function rewriteDescriptions(
  client: ShopifyClient,
  opts: { maxProducts?: number } = {}
): Promise<DescriptionStats> {
  const stats: DescriptionStats = {
    scanned: 0,
    rewritten: 0,
    alreadyOurs: 0,
    foreign: [],
    failed: 0,
  };
  const limit = opts.maxProducts ?? 250;
  // Товары бота исключаем на стороне Shopify: их описания трогать нельзя.
  const query = "status:active,draft -tag:'tg-bot'";
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
      const product = buildUpdate(node);

      if (!product) {
        if (isRewrittenDescription(node.descriptionHtml ?? "")) stats.alreadyOurs++;
        else stats.foreign.push(node.title);
        continue;
      }

      try {
        const res = await client.graphql<{
          productUpdate: { userErrors: { message: string }[] };
        }>(PRODUCT_UPDATE, { product });
        if (res.productUpdate.userErrors.length > 0) stats.failed++;
        else stats.rewritten++;
      } catch {
        stats.failed++;
      }
    }

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return stats;
}
