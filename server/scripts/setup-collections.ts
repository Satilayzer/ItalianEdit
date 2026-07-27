/**
 * Создаёт автоколлекции магазина (существующие не трогает):
 *   npx tsx scripts/setup-collections.ts
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { ensureSmartCollection } from "../src/shopify/collections";
import { TG_COLLECTION_TAG } from "../src/shopify/draftProduct";
import { warehouseTag } from "../src/shopify/warehouse";
import { genderTags } from "../src/shopify/gender";

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

// Теги берём из тех же функций, что тегируют товары, — чтобы витрина и товары
// не рассинхронились по формату (EU/US, Women/Men).
const collections: { title: string; tag: string }[] = [
  { title: "Italian Edit", tag: TG_COLLECTION_TAG }, // товары из ТГ-бота
  { title: "Ships from Europe", tag: warehouseTag("eu") }, // переключатель склада
  { title: "Ships from USA", tag: warehouseTag("us") },
  { title: "Women", tag: genderTags("women")[0] }, // переключатель пола
  { title: "Men", tag: genderTags("men")[0] },
];

for (const c of collections) {
  const res = await ensureSmartCollection(client, c.title, c.tag);
  const state = res.created ? "создана" : res.updated ? "правило исправлено" : "уже актуальна";
  console.log(`Коллекция «${c.title}» (${res.id}) — тег ${c.tag}: ${state}`);
}
