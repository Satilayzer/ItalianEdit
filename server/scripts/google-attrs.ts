/**
 * Атрибуты Google Merchant Center:
 *  - варианты: `mm-google-shopping.*` (пол, возраст, состояние, MPN, size_system, labels), см. google.ts;
 *  - товары: цвет и материал в стандартных атрибутах `shopify.*`, см. googleProduct.ts.
 *
 *   npx tsx scripts/google-attrs.ts [--part variants|products] [--limit N]
 *       [--query "<поиск вариантов>"] [--products-query "<поиск товаров>"] [--write]
 *
 * По умолчанию dry-run обеих частей: печатает, что записал бы, и ничего не меняет.
 * --write — записать. Без --limit идёт по всему активному каталогу.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { googleStoreProducts } from "../src/shopify/googleStoreProducts";
import { googleProductStore } from "../src/shopify/googleProductStore";
import { COLOR_ENTRIES, MATERIAL_ENTRIES } from "../src/shopify/googleProduct";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const write = args.includes("--write");
const limit = opt("limit") ? Number(opt("limit")) : undefined;
const part = opt("part");

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

if (part !== "products") {
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
}

if (part !== "variants") {
  // GID метаобъекта → читаемое имя для плана.
  const names = new Map<string, string>(Object.entries(COLOR_ENTRIES).map(([name, id]) => [id, name]));
  for (const [group, entries] of Object.entries(MATERIAL_ENTRIES)) {
    for (const [name, id] of Object.entries(entries)) names.set(id, `${name} (${group})`);
  }
  const readable = (value: string) =>
    (JSON.parse(value) as string[]).map((id) => names.get(id) ?? id).join(" + ");

  const stats = await googleProductStore(client, {
    maxProducts: limit,
    dryRun: !write,
    query: opt("products-query"),
  });
  if (!write) {
    for (const entry of stats.plan) {
      console.log(`${entry.product}: ${entry.set.map((s) => `${s.key}=${readable(s.value)}`).join(", ")}`);
    }
  }
  console.log(
    `\nТоваров просмотрено ${stats.scanned}, ${write ? "записано" : "к записи"} ${stats.updated}, ошибок ${stats.failed}. ` +
      `Без цвета ${stats.gaps.color}, без материала ${stats.gaps.material}.`
  );
  for (const e of stats.errors.slice(0, 10)) console.log(`  ошибка: ${e}`);
}
