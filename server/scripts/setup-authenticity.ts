/**
 * Публикация страницы Authenticity & Sourcing из src/shopify/authenticity.ts.
 *
 *   npx tsx scripts/setup-authenticity.ts            # показать, что будет сделано
 *   npx tsx scripts/setup-authenticity.ts --apply    # создать/обновить страницу
 *   npx tsx scripts/setup-authenticity.ts --apply --publish   # ...и опубликовать
 *
 * По умолчанию страница создаётся НЕопубликованной: пока на неё нет ссылки
 * в меню и пока текст не согласован, публиковать нечего. Опубликовать —
 * отдельным осознанным флагом `--publish`.
 *
 * Скрипт идемпотентен: ищет страницу по хендлу и обновляет её, а не плодит
 * копии. Источник правды — authenticity.ts, а не поле в админке.
 *
 * Нужен скоуп `write_content`. У приложения из .env его НЕТ (только products,
 * orders и fulfillment-orders — проверяется через scripts/check-scopes.ts),
 * поэтому скрипт сейчас отвечает отказом, как и setup-policies.ts. Пока скоуп
 * не добавят в Dev Dashboard, страница заводится через MCP-коннектор Shopify,
 * у которого права шире. Текст в обоих случаях берётся отсюда же.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import {
  AUTHENTICITY_HANDLE,
  AUTHENTICITY_TITLE,
  AUTHENTICITY_PAGE,
  AUTHENTICITY_HOME,
  AUTHENTICITY_PRODUCT,
  AUTHENTICITY_CHECKOUT,
} from "../src/shopify/authenticity";

const apply = process.argv.includes("--apply");
const publish = process.argv.includes("--publish");

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

// `pageByHandle` появился позже версии API, на которой сидит клиент (2025-01),
// поэтому ищем списком с фильтром — работает в обеих.
const FIND = `
  query ($query: String!) {
    pages(first: 1, query: $query) { nodes { id title handle isPublished } }
  }`;

const CREATE = `
  mutation ($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle isPublished }
      userErrors { field message }
    }
  }`;

const UPDATE = `
  mutation ($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id handle isPublished }
      userErrors { field message }
    }
  }`;

interface PageNode {
  id: string;
  title: string;
  handle: string;
  isPublished: boolean;
}

// Скоупа write_content у приложения может не быть — тогда Shopify отвечает
// «Access denied for pages field». Это не поломка скрипта, а недостающее право,
// и говорить об этом надо словами, а не стектрейсом.
const existing = await client
  .graphql<{ pages: { nodes: PageNode[] } }>(FIND, {
    query: `handle:${AUTHENTICITY_HANDLE}`,
  })
  .then((r) => r.pages.nodes.find((p) => p.handle === AUTHENTICITY_HANDLE) ?? null)
  .catch((err: unknown) => {
    const msg = String(err);
    if (!/Access denied/i.test(msg)) throw err;
    console.error(
      "Нет доступа к страницам: приложению не хватает скоупа write_content.\n" +
        "Проверить права: npx tsx scripts/check-scopes.ts\n" +
        "Добавить скоуп в Dev Dashboard — или завести страницу через MCP-коннектор,\n" +
        "взяв текст из src/shopify/authenticity.ts (он остаётся источником правды)."
    );
    process.exit(1);
  });

console.log(`Страница: ${AUTHENTICITY_TITLE}  (/pages/${AUTHENTICITY_HANDLE})`);
console.log(
  existing
    ? `Уже существует: ${existing.id}, опубликована: ${existing.isPublished ? "да" : "нет"} → будет обновлена`
    : "Не найдена → будет создана"
);
console.log(`Публикация: ${publish ? "да (--publish)" : "нет"}`);

if (!apply) {
  console.log(`\n─── Текст страницы ───\n${AUTHENTICITY_PAGE}\n`);
  // Блоки витрины скрипт не ставит — они правятся в теме, которой нет
  // в репозитории. Печатаем, чтобы текст переносился копированием,
  // а не перенабирался руками (и не расходился с источником правды).
  for (const [where, block] of [
    ["Главная", AUTHENTICITY_HOME],
    ["Страница товара", AUTHENTICITY_PRODUCT],
    ["Корзина (вместо чекаута — нужен Plus)", AUTHENTICITY_CHECKOUT],
  ] as const) {
    console.log(`─── ${where} ───\n${block.heading}\n${block.body}\n`);
  }
  console.log("Сухой прогон. Запись — с флагом --apply.");
  process.exit(0);
}

const body = { title: AUTHENTICITY_TITLE, handle: AUTHENTICITY_HANDLE, body: AUTHENTICITY_PAGE };

interface MutationResult {
  page: { id: string; handle: string; isPublished: boolean } | null;
  userErrors: { field: string[] | null; message: string }[];
}

// isPublished передаём только когда просят опубликовать: иначе повторный прогон
// без --publish снимал бы с публикации уже открытую страницу.
const result = existing
  ? await client
      .graphql<{ pageUpdate: MutationResult }>(UPDATE, {
        id: existing.id,
        page: publish ? { ...body, isPublished: true } : body,
      })
      .then((r) => r.pageUpdate)
  : await client
      .graphql<{ pageCreate: MutationResult }>(CREATE, {
        page: { ...body, isPublished: publish },
      })
      .then((r) => r.pageCreate);

if (result.userErrors.length > 0) {
  for (const e of result.userErrors) {
    console.error(`Ошибка: ${e.field?.join(".") ?? "—"} — ${e.message}`);
  }
  process.exit(1);
}

console.log(
  `\nГотово: ${result.page?.id}, опубликована: ${result.page?.isPublished ? "да" : "нет"}`
);
if (!result.page?.isPublished) {
  console.log("Открыть покупателям: повторить с --apply --publish.");
}
console.log(
  "Ссылку в футер добавлять отдельно (Online Store → Navigation → Footer menu)."
);
