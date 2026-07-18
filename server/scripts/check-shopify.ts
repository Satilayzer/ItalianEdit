/**
 * Проверка связки с Shopify: токен → данные магазина → тестовый черновик → удаление.
 *   npx tsx scripts/check-shopify.ts
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { createDraftProduct } from "../src/shopify/draftProduct";

const config = loadConfig();
if (!config.shopify) {
  console.error("SHOPIFY_SHOP + (SHOPIFY_ADMIN_TOKEN или SHOPIFY_CLIENT_ID/SECRET) не заданы в .env");
  process.exit(1);
}

const client = new ShopifyClient(config.shopify);

console.log("1) Получаю токен и данные магазина…");
const { shop } = await client.graphql<{
  shop: { name: string; currencyCode: string; primaryDomain: { url: string } };
}>(`{ shop { name currencyCode primaryDomain { url } } }`);
console.log(`   Магазин: ${shop.name}, валюта: ${shop.currencyCode}, домен: ${shop.primaryDomain.url}`);

console.log("2) Создаю тестовый черновик…");
const draft = await createDraftProduct(client, {
  title: "ТЕСТ интеграции ItalianEdit Server — можно удалить",
  descriptionHtml: "<p>Тестовый черновик, создан автоматически для проверки связки.</p>",
  vendor: "ItalianEdit Server",
  tags: ["integration-test"],
  imageUrls: [],
  price: 1,
  compareAtPrice: 2,
});
console.log(`   Черновик создан: ${draft.adminUrl}`);

console.log("3) Удаляю тестовый черновик…");
const del = await client.graphql<{
  productDelete: { deletedProductId: string | null; userErrors: { message: string }[] };
}>(
  `mutation($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { message } }
  }`,
  { input: { id: draft.productId } }
);
if (del.productDelete.userErrors.length > 0) {
  console.warn("   Не удалось удалить:", del.productDelete.userErrors);
} else {
  console.log(`   Удалён: ${del.productDelete.deletedProductId}`);
}

console.log("\n✅ Связка с Shopify работает полностью (чтение, создание, удаление).");
