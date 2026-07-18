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

const italianEdit = await ensureSmartCollection(client, "Italian Edit", TG_COLLECTION_TAG);
console.log(
  italianEdit.created
    ? `Коллекция «Italian Edit» создана (${italianEdit.id}) — собирает товары с тегом ${TG_COLLECTION_TAG}`
    : `Коллекция «Italian Edit» уже существует (${italianEdit.id})`
);
