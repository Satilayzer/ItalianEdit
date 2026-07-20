import type { ShopifyClient } from "./client";

/**
 * Снятие метки «новинка» с товаров из ТГ-группы.
 *
 * Коллекция New собирается по тегу `new`. Тег `tg-bot` для этого не годится:
 * он помечает происхождение товара и должен остаться навсегда, иначе мы потеряем
 * возможность отличить товары бота от залитых из BrandsGateway.
 *
 * Товар выпадает из New через NEW_TTL_DAYS дней после создания — сам товар
 * при этом не трогаем: он остаётся опубликованным и в своих категориях.
 */

export const NEW_TAG = "new";
export const NEW_TTL_DAYS = 14;

/** Сколько товаров обрабатываем за один запуск — чтобы не выесть лимит API. */
const MAX_PER_RUN = 250;
const PAGE_SIZE = 50;

/** Граница «свежести»: всё, что создано раньше, из New выпадает. */
export function staleBefore(now: Date, ttlDays = NEW_TTL_DAYS): string {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60_000).toISOString();
}

/** Поисковый запрос Shopify для протухших новинок. */
export function staleQuery(now: Date, ttlDays = NEW_TTL_DAYS): string {
  return `tag:'${NEW_TAG}' AND created_at:<'${staleBefore(now, ttlDays)}'`;
}

const FIND_STALE = /* GraphQL */ `
  query FindStaleNew($q: String!, $cursor: String) {
    products(first: ${PAGE_SIZE}, query: $q, after: $cursor) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const REMOVE_TAG = /* GraphQL */ `
  mutation RemoveNewTag($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

interface FindStaleData {
  products: {
    nodes: { id: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface RemoveTagData {
  tagsRemove: { userErrors: { field?: string[]; message: string }[] };
}

export interface ExpireResult {
  /** Сколько товаров потеряли метку «новинка». */
  expired: number;
  /** Ошибки по отдельным товарам — задача из-за них не падает целиком. */
  errors: string[];
}

/**
 * Снимает тег `new` со всех товаров старше TTL.
 *
 * Пагинацию НЕ продолжаем через курсор после снятия тегов: товары уходят
 * из выборки по мере обработки, и курсор бы поехал. Вместо этого каждый раз
 * запрашиваем первую страницу заново, пока она не опустеет.
 */
export async function expireNewProducts(
  client: ShopifyClient,
  opts: { now?: Date; ttlDays?: number } = {}
): Promise<ExpireResult> {
  const now = opts.now ?? new Date();
  const q = staleQuery(now, opts.ttlDays);
  const errors: string[] = [];
  const seen = new Set<string>();
  let expired = 0;

  while (seen.size < MAX_PER_RUN) {
    const found = await client.graphql<FindStaleData>(FIND_STALE, { q });
    const fresh = found.products.nodes.filter((n) => !seen.has(n.id));
    // Страница пуста или состоит из товаров, которые мы уже пытались обработать
    // (тег не снялся из-за ошибки) — повторять бессмысленно.
    if (fresh.length === 0) break;

    for (const { id } of fresh) {
      if (seen.size >= MAX_PER_RUN) break;
      seen.add(id);
      try {
        const res = await client.graphql<RemoveTagData>(REMOVE_TAG, {
          id,
          tags: [NEW_TAG],
        });
        const errs = res.tagsRemove.userErrors;
        if (errs.length > 0) {
          errors.push(`${id}: ${errs.map((e) => e.message).join("; ")}`);
        } else {
          expired += 1;
        }
      } catch (err) {
        errors.push(`${id}: ${String(err)}`);
      }
    }
  }

  return { expired, errors };
}
