/**
 * Проверка синка треков TheDoubleF на живых данных: читает их таблицу и наш
 * магазин, печатает, что задача tdf-tracking сделала бы. Ничего не меняет.
 *
 *   npx tsx scripts/tdf-tracking-check.ts
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { TDF_API_VERSION } from "../src/tdf/sync";
import { DEFAULT_TRACKING_SHEET_URL, syncTdfTracking } from "../src/tdf/tracking";

// Иначе loadConfig потребует весь набор TDF_ORDERS_* — для проверки он не нужен.
delete process.env.TDF_ORDERS_TOKEN;

const config = loadConfig();
if (!config.shopify) throw new Error("Shopify не настроен в .env");
const ours = new ShopifyClient({ ...config.shopify, apiVersion: TDF_API_VERSION });

const stats = await syncTdfTracking({
  ours,
  alert: async () => {},
  notifyCustomer: false,
  dryRun: true,
  sheetUrl: process.env.TDF_TRACKING_SHEET_URL || DEFAULT_TRACKING_SHEET_URL,
  log: (msg) => console.log(msg),
});
console.log(stats);
