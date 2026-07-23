/** Удаляет коллекцию по gid: npx tsx scripts/delete-collection.ts <gid> */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";

const id = process.argv[2];
if (!id) {
  console.error("Использование: npx tsx scripts/delete-collection.ts <gid>");
  process.exit(1);
}
const config = loadConfig();
if (!config.shopify) throw new Error("Shopify не настроен");
const client = new ShopifyClient(config.shopify);

const res = await client.graphql<{
  collectionDelete: { deletedCollectionId: string | null; userErrors: { message: string }[] };
}>(
  `mutation($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) { deletedCollectionId userErrors { message } }
  }`,
  { input: { id } }
);
if (res.collectionDelete.userErrors.length > 0) {
  console.error("Ошибка:", res.collectionDelete.userErrors);
  process.exit(1);
}
console.log("Удалена коллекция:", res.collectionDelete.deletedCollectionId);
