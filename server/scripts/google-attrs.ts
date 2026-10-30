/**
 * Метаполя Google Merchant Center на вариантах (`mm-google-shopping.*`), см. google.ts.
 *
 *   npx tsx scripts/google-attrs.ts [--limit N] [--query "<поиск вариантов>"] [--write]
 *
 * По умолчанию dry-run: печатает, что записал бы, и ничего не меняет.
 * --write — записать. Без --limit идёт по всем вариантам активных товаров.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { googleStoreProducts } from "../src/shopify/googleStoreProducts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const write = args.includes("--write");
const limit = opt("limit") ? Number(opt("limit")) : undefined;

const config = loadConfig();
if (!config.shopify) {
  console.error("SHOPIFY_SHOP + (SHOPIFY_ADMIN_TOKEN или SHOPIFY_CLIENT_ID/SECRET) не заданы в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);
const { shop } = await client.graphql<{ shop: { name: string; myshopifyDomain: string } }>(
  `{ shop { name myshopifyDomain } }`
);
console.log(`Магазин: ${shop.name} (${shop.myshopifyDomain}), режим: ${write ? "ЗАПИСЬ" : "dry-run"}`);

const stats = await googleStoreProducts(client, { maxVariants: limit, dryRun: !write, query: opt("query") });

if (!write) {
  let last = "";
  for (const entry of stats.plan) {
    if (entry.product !== last) {
      console.log(`\n${entry.product}`);
      last = entry.product;
    }
    console.log(`  ${entry.variant}: ${entry.set.map((s) => `${s.key}=${s.value}`).join(", ")}`);
  }
}
console.log(
  `\nВариантов просмотрено ${stats.scanned}, ${write ? "записано" : "к записи"} ${stats.updated}, ошибок ${stats.failed}. ` +
    `Без пола ${stats.gaps.gender}, без MPN ${stats.gaps.mpn}, без раздела ${stats.gaps.section}.`
);
for (const e of stats.errors.slice(0, 10)) console.log(`  ошибка: ${e}`);
