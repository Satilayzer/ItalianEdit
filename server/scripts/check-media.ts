/** Диагностика импорта фото: создаёт тестовый черновик с картинками Gucci,
 *  ждёт обработку медиа и печатает статусы/ошибки Shopify. Затем удаляет черновик.
 *  npx tsx scripts/check-media.ts <url1> [url2…]
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { createDraftProduct } from "../src/shopify/draftProduct";
import { uploadProductImages } from "../src/shopify/uploadImages";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("Использование: npx tsx scripts/check-media.ts <url картинки>…");
  process.exit(1);
}
const config = loadConfig();
if (!config.shopify) throw new Error("Shopify не настроен");
const client = new ShopifyClient(config.shopify);

const draft = await createDraftProduct(client, {
  title: "ТЕСТ импорта фото — удалить",
  vendor: "test",
  tags: ["media-test"],
  imageUrls: urls,
  price: 1,
});
console.log("Черновик:", draft.adminUrl);

const stats = await uploadProductImages(client, draft.productId, urls);
console.log(`Загрузка: успешно ${stats.uploaded}, ошибок ${stats.failed}`);

interface MediaNode {
  id: string;
  status: string;
  mediaErrors: { code: string; details?: string; message: string }[];
}

async function mediaStatus(): Promise<MediaNode[]> {
  const data = await client.graphql<{
    product: { media: { nodes: MediaNode[] } };
  }>(
    `query($id: ID!) {
      product(id: $id) {
        media(first: 10) {
          nodes { id status mediaErrors { code details message } }
        }
      }
    }`,
    { id: draft.productId }
  );
  return data.product.media.nodes;
}

let nodes: MediaNode[] = [];
for (let attempt = 1; attempt <= 12; attempt++) {
  await new Promise((r) => setTimeout(r, 5_000));
  nodes = await mediaStatus();
  const processing = nodes.filter((m) => m.status === "PROCESSING").length;
  console.log(`[${attempt * 5}с] статусы: ${nodes.map((m) => m.status).join(", ") || "нет медиа"}`);
  if (processing === 0) break;
}

for (const m of nodes) {
  if (m.mediaErrors.length > 0) {
    console.log("Ошибки:", JSON.stringify(m.mediaErrors, null, 2));
  }
}
if (nodes.length === 0) {
  console.log("Медиа вообще нет — все загрузки отклонены на входе.");
}

await client.graphql(
  `mutation($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { message } }
  }`,
  { input: { id: draft.productId } }
);
console.log("Тестовый черновик удалён.");
