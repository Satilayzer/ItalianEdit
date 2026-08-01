import { loadConfig } from "./config";
import { createBot } from "./bot/bot";
import { createApi } from "./api/server";
import { initDb, closeDb, db, isDbReady } from "./db";
import { makeAlerter } from "./alerts";
import { startJobs, type Job } from "./scheduler";
import { BgClient } from "./bg/client";
import { ShopifyClient } from "./shopify/client";
import { importCatalog, syncStockStatuses } from "./bg/sync";
import { forwardShopifyOrder, pollTracking } from "./bg/orders";
import { pushPendingProducts } from "./shopify/products";
import { tagStoreProducts } from "./shopify/tagStoreProducts";
import { categorizeStoreProducts } from "./shopify/categorizeStoreProducts";
import { rewriteDescriptions } from "./shopify/rewriteDescriptions";
import { expireNewProducts, NEW_TTL_DAYS } from "./shopify/expireNew";

const config = loadConfig();
const shopifyClient = config.shopify ? new ShopifyClient(config.shopify) : undefined;
const bot = createBot(config, { shopify: shopifyClient });
const alert = makeAlerter(config.botToken, config.alertChatId);

if (config.databaseUrl) {
  // Недоступная база не должна ронять весь процесс в режиме "app": там она не
  // нужна вовсе, а вместе с ней уедут HTTP API и задачи Shopify. Ровно так и
  // случалось, когда на хостинг по недосмотру уезжал локальный DATABASE_URL
  // с localhost — контейнер валился в цикл перезапусков.
  // В режиме "api" база — основа работы, там падать на старте правильно:
  // тихо работать без каталога и заказов хуже, чем не стартовать.
  try {
    await initDb(config.databaseUrl);
    console.log("PostgreSQL подключена, схема на месте.");
  } catch (err) {
    if (config.importMode === "api") throw err;
    console.warn(
      `Не удалось подключиться к PostgreSQL (${String(err)}). ` +
        `В режиме "app" она не нужна — продолжаю без неё. ` +
        `Если база не планировалась, уберите DATABASE_URL.`
    );
  }
} else {
  console.warn(
    "DATABASE_URL не задан — работаю без БД (для бота не критично, " +
      "понадобится для интеграции BrandsGateway)."
  );
}

const bgClient = config.bg
  ? new BgClient({
      baseUrl: config.bg.baseUrl,
      email: config.bg.email,
      password: config.bg.password,
      storeId: config.bg.storeId,
    })
  : null;

const api = createApi(config, {
  onShopifyOrder: async (order) => {
    // В режиме "app" заказы BG-товаров передаёт приложение BrandsGateway само.
    if (config.importMode === "app") return;
    if (!bgClient || !isDbReady()) {
      await alert(
        `⚠️ Получен заказ №${order.order_number} из Shopify, но BrandsGateway ` +
          `не настроен — оформите вручную.`
      );
      return;
    }
    await forwardShopifyOrder(db(), bgClient, order, alert);
  },
});

if (!config.serperApiKey) {
  console.warn(
    "SERPER_API_KEY не задан — поиск пойдёт через DuckDuckGo (менее надёжно). " +
      "Бесплатный ключ: https://serper.dev"
  );
}

await api.listen({ port: config.port, host: "0.0.0.0" });
console.log(`HTTP API слушает порт ${config.port} (GET /health, POST /api/lookup)`);
if (config.shopifyWebhookSecret) {
  console.log("Вебхук Shopify активен: POST /webhooks/shopify/orders");
}

// Периодические задачи. Режим "api": наш сервер сам синкает каталог/заказы через API BG.
// Режим "app": импорт/остатки/заказы делает приложение BrandsGateway — мы только дотегируем.
let lastDeltaSync = new Date().toISOString();
const jobs: Job[] = [];
if (config.importMode === "api" && bgClient && isDbReady()) {
  jobs.push(
    {
      name: "bg-status-sync",
      intervalMs: 5 * 60_000,
      run: async () => {
        await syncStockStatuses(db(), bgClient, { inventoryCap: config.inventoryCap });
      },
    },
    {
      name: "bg-delta-sync",
      intervalMs: 15 * 60_000,
      run: async () => {
        const since = lastDeltaSync;
        lastDeltaSync = new Date().toISOString();
        await importCatalog(db(), bgClient, {
          updatedSince: since,
          inventoryCap: config.inventoryCap,
        });
      },
    },
    {
      name: "bg-tracking-poll",
      intervalMs: 30 * 60_000,
      run: async () => {
        await pollTracking(db(), bgClient, alert);
      },
    }
  );
}

// Режим "api": заливка каталога БД → Shopify нашим сервером.
if (config.importMode === "api" && shopifyClient && isDbReady()) {
  jobs.push({
    name: "shopify-push",
    intervalMs: 60_000,
    run: async () => {
      const stats = await pushPendingProducts(db(), shopifyClient, {
        batch: config.pushBatch,
      });
      if (stats.pushed > 0 || stats.failed > 0) {
        console.log(
          `shopify-push: залито ${stats.pushed}, ошибок ${stats.failed}`
        );
      }
      if (stats.failed > 0) {
        throw new Error(
          `не залилось ${stats.failed} товаров, например: ${stats.errors[0]}`
        );
      }
    },
  });
}

// Режим "app": приложение BrandsGateway залило товары само, но без тега склада.
// Дотегируем их через наш Admin API — на этом держится фильтр EU/US на витрине.
if (config.importMode === "app" && shopifyClient) {
  jobs.push({
    name: "shopify-tagger",
    intervalMs: 10 * 60_000,
    run: async () => {
      const stats = await tagStoreProducts(shopifyClient);
      if (stats.tagged > 0 || stats.failed > 0) {
        console.log(
          `shopify-tagger: просмотрено ${stats.scanned}, дотегировано ${stats.tagged}, ошибок ${stats.failed}`
        );
      }
      if (stats.failed > 0) {
        throw new Error(`не дотегировалось ${stats.failed} товаров`);
      }
    },
  });
}
// Режим "app": приложение BG заливает описание машинным текстом с внутренними
// кодами. Пересобираем его в человеческую вёрстку, оригинал складываем в метаполе.
// Товары бота задача обходит: там настоящий текст бренда.
if (config.importMode === "app" && shopifyClient) {
  jobs.push({
    name: "shopify-descriptions",
    intervalMs: 30 * 60_000,
    run: async () => {
      const stats = await rewriteDescriptions(shopifyClient);
      if (stats.rewritten > 0 || stats.failed > 0) {
        console.log(
          `shopify-descriptions: просмотрено ${stats.scanned}, пересобрано ${stats.rewritten}, ошибок ${stats.failed}`
        );
      }
      if (stats.foreign.length > 0) {
        // Формат фида BG расширяется. Нераспознанное описание оставляем как есть
        // и показываем глазами — правится разбором в description.ts.
        console.warn(
          `shopify-descriptions: формат не распознан у ${stats.foreign.length} товаров, ` +
            `например «${stats.foreign[0]}»`
        );
      }
      if (stats.failed > 0) {
        throw new Error(`не пересобралось описание у ${stats.failed} товаров`);
      }
    },
  });
}

// Категория и тип товара: ни приложение BG, ни бот их не заполняют, а фиды
// Google/Meta, налоги и маркетплейсы читают именно эти поля. Выводим из тегов.
// Задача нужна в обоих режимах: товары бота тоже приходят без Category.
if (shopifyClient) {
  jobs.push({
    name: "shopify-categorizer",
    intervalMs: 15 * 60_000,
    run: async () => {
      const stats = await categorizeStoreProducts(shopifyClient);
      if (stats.updated > 0 || stats.failed > 0) {
        console.log(
          `shopify-categorizer: просмотрено ${stats.scanned}, заполнено ${stats.updated}, ошибок ${stats.failed}`
        );
      }
      if (stats.unresolved.length > 0) {
        // Не ошибка: словарь BG расширяется, и незнакомую категорию лучше
        // показать глазами, чем проставить наугад. Правится в category.ts.
        console.warn(
          `shopify-categorizer: категория не опознана у ${stats.unresolved.length} товаров, ` +
            `например «${stats.unresolved[0]}»`
        );
      }
      if (stats.failed > 0) {
        throw new Error(`не проставилась категория у ${stats.failed} товаров`);
      }
    },
  });
}

// Снятие метки «новинка»: нужен только Shopify, БД не участвует.
// Раз в 6 часов — TTL измеряется днями, чаще смысла нет.
if (shopifyClient) {
  jobs.push({
    name: "shopify-expire-new",
    intervalMs: 6 * 60 * 60_000,
    run: async () => {
      const stats = await expireNewProducts(shopifyClient);
      if (stats.expired > 0) {
        console.log(
          `shopify-expire-new: снята метка «новинка» с ${stats.expired} товаров ` +
            `(старше ${NEW_TTL_DAYS} дней)`
        );
      }
      if (stats.errors.length > 0) {
        throw new Error(
          `не снялась метка у ${stats.errors.length} товаров, например: ${stats.errors[0]}`
        );
      }
    },
  });
}

const stopJobs = startJobs(jobs, (name, err) => {
  console.error(`Задача ${name} упала:`, err);
  void alert(`🔴 Фоновая задача <b>${name}</b> упала: ${String(err)}`);
});
if (jobs.length > 0) {
  console.log(`Планировщик: ${jobs.map((j) => j.name).join(", ")}`);
} else {
  console.log("Планировщик: задач нет (ждём креды BrandsGateway).");
}

if (config.botEnabled) {
  console.log("Запускаю бота (long polling)…");
  // Ошибку поллинга обязательно ловим здесь. Без catch реджект остаётся
  // необработанным, и Node убивает процесс целиком — вместе с HTTP API и всеми
  // задачами Shopify, которые к Телеграму отношения не имеют.
  // Типичный случай — 409 Conflict: второй инстанс с тем же токеном. На Render
  // это происходит на каждом деплое, пока новый процесс и старый живут внахлёст.
  void bot
    .start({ onStart: (me) => console.log(`Бот @${me.username} запущен.`) })
    .catch((err) => {
      console.error("Бот остановлен (long polling прерван):", err);
      void alert(
        `🔴 Телеграм-бот остановлен: ${String(err)}\n` +
          `Задачи Shopify продолжают работать.`
      );
    });
} else {
  console.log("Бот выключен (BOT_ENABLED=false) — работают только задачи Shopify.");
}

async function shutdown() {
  console.log("Останавливаюсь…");
  stopJobs();
  if (config.botEnabled) await bot.stop();
  await api.close();
  await closeDb();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
