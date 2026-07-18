/**
 * Демонстрация синка на моках против реальной PostgreSQL (без доступов к BG):
 *   npx tsx scripts/demoSync.ts
 */
import "dotenv/config";
import { initDb, db, closeDb } from "../src/db/index";
import { importCatalog, syncStockStatuses } from "../src/bg/sync";
import { sampleCatalog, makeMockClient } from "../src/bg/mockClient";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}

await initDb(url);
const client = makeMockClient(sampleCatalog());

console.log("1) Импорт каталога (наценка ×1.8, cap остатка = 1)…");
const imported = await importCatalog(db(), client, {
  pricing: { defaultMultiplier: 1.8, byBrand: { gucci: 2.5 } },
  inventoryCap: 1,
});
console.log(`   импортировано: ${imported}`);

const { rows } = await db().query(
  `SELECT sku, brand, wholesale_price, our_price, stock, warehouse
   FROM products ORDER BY bg_id`
);
console.table(rows);

console.log("2) Быстрая сверка остатков (check-status)…");
const updated = await syncStockStatuses(db(), client, { inventoryCap: 1 });
console.log(`   обновлено остатков: ${updated}`);

const log = await db().query(
  `SELECT kind, items_updated, ok FROM sync_log ORDER BY id DESC LIMIT 3`
);
console.log("Журнал синхронизаций:");
console.table(log.rows);

await closeDb();
