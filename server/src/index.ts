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

const config = loadConfig();
const shopifyClient = config.shopify ? new ShopifyClient(config.shopify) : undefined;
const bot = createBot(config, { shopify: shopifyClient });
const alert = makeAlerter(config.botToken, config.alertChatId);

if (config.databaseUrl) {
  await initDb(config.databaseUrl);
  console.log("PostgreSQL подключена, схема на месте.");
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

// Периодические задачи включаются только когда есть и креды BG, и БД
let lastDeltaSync = new Date().toISOString();
const jobs: Job[] = [];
if (bgClient && isDbReady()) {
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

// Заливка каталога БД → Shopify: работает, как только есть Shopify и БД
if (shopifyClient && isDbReady()) {
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
const stopJobs = startJobs(jobs, (name, err) => {
  console.error(`Задача ${name} упала:`, err);
  void alert(`🔴 Фоновая задача <b>${name}</b> упала: ${String(err)}`);
});
if (jobs.length > 0) {
  console.log(`Планировщик: ${jobs.map((j) => j.name).join(", ")}`);
} else {
  console.log("Планировщик: задач нет (ждём креды BrandsGateway).");
}

console.log("Запускаю бота (long polling)…");
void bot.start({
  onStart: (me) => console.log(`Бот @${me.username} запущен.`),
});

async function shutdown() {
  console.log("Останавливаюсь…");
  stopJobs();
  await bot.stop();
  await api.close();
  await closeDb();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
