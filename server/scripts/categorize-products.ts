/**
 * Разовая простановка Category и Product type товарам магазина.
 *
 *   npx tsx scripts/categorize-products.ts            # показать план, ничего не менять
 *   npx tsx scripts/categorize-products.ts --apply    # записать в Shopify
 *
 * Та же логика, что у фоновой задачи shopify-categorizer (см. category.ts):
 * поля выводятся из категорийных тегов и только ДОПИСЫВАЮТСЯ — заполненное
 * вручную не перезаписывается. Нужен, пока сервер не переехал на постоянный
 * хостинг и задачи сами не крутятся.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { categoryPatch } from "../src/shopify/category";
import { categorizeStoreProducts } from "../src/shopify/categorizeStoreProducts";

const apply = process.argv.includes("--apply");

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

if (apply) {
  const stats = await categorizeStoreProducts(client, { maxProducts: 1000 });
  console.log(
    `Просмотрено ${stats.scanned}, заполнено ${stats.updated}, ` +
      `уже было ${stats.skipped}, ошибок ${stats.failed}`
  );
  if (stats.unresolved.length > 0) {
    console.log(`\nКатегория не опознана (${stats.unresolved.length}):`);
    for (const title of stats.unresolved) console.log(`  · ${title}`);
    console.log("Если это не мусор — допишите правило в src/shopify/category.ts.");
  }
  process.exit(0);
}

// ── Сухой прогон: тот же отбор, что в задаче, но без единой мутации ──────────
const PAGE = /* GraphQL */ `
  query DryRun($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active,draft") {
      pageInfo { hasNextPage endCursor }
      nodes { id title tags productType category { id } }
    }
  }
`;

interface Node {
  id: string;
  title: string;
  tags: string[];
  productType: string | null;
  category: { id: string } | null;
}

let cursor: string | undefined;
let scanned = 0;
const planned: { title: string; category?: string; productType?: string }[] = [];
const untouched: string[] = [];
const unresolved: string[] = [];

for (;;) {
  const data = await client.graphql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Node[];
    };
  }>(PAGE, { cursor: cursor ?? null });

  for (const n of data.products.nodes) {
    scanned++;
    const patch = categoryPatch(n);
    if (patch) planned.push({ title: n.title, ...patch });
    else if (n.category?.id && n.productType?.trim()) untouched.push(n.title);
    else unresolved.push(n.title);
  }

  if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
  cursor = data.products.pageInfo.endCursor;
}

console.log(`Просмотрено товаров: ${scanned}\n`);
console.log(`Будет заполнено: ${planned.length}`);
for (const p of planned) {
  const node = p.category?.split("/").pop() ?? "—";
  console.log(`  · ${p.title}\n      category=${node}  productType=${p.productType ?? "—"}`);
}
console.log(`\nУже заполнены, трогать не будем: ${untouched.length}`);
console.log(`Категория не опознана: ${unresolved.length}`);
for (const t of unresolved) console.log(`  · ${t}`);
console.log("\nЭто сухой прогон. Записать: npx tsx scripts/categorize-products.ts --apply");
