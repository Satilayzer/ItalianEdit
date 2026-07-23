/**
 * Создаёт автоколлекции магазина (существующие не трогает):
 *   npx tsx scripts/setup-collections.ts
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { ensureSmartCollection } from "../src/shopify/collections";
import { TG_COLLECTION_TAG } from "../src/shopify/draftProduct";

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

// Автоколлекции, на которых держатся фильтры витрины (собираются по тегам).
const collections: { title: string; tag: string }[] = [
  { title: "Italian Edit", tag: TG_COLLECTION_TAG }, // товары из ТГ-бота
  { title: "Ships from Europe", tag: "warehouse:eu" }, // переключатель склада
  { title: "Ships from USA", tag: "warehouse:us" },
  { title: "Women", tag: "gender:women" }, // переключатель пола (унисекс = оба тега)
  { title: "Men", tag: "gender:men" },
];

for (const c of collections) {
  const res = await ensureSmartCollection(client, c.title, c.tag);
  console.log(
    res.created
      ? `Коллекция «${c.title}» создана (${res.id}) — тег ${c.tag}`
      : `Коллекция «${c.title}» уже существует (${res.id})`
  );
}
