/**
 * Разовая пересборка описаний товаров BrandsGateway.
 *
 *   npx tsx scripts/rewrite-descriptions.ts            # показать «до/после», ничего не менять
 *   npx tsx scripts/rewrite-descriptions.ts --apply    # записать в Shopify
 *   npx tsx scripts/rewrite-descriptions.ts --limit 3  # сколько примеров показать
 *
 * Та же логика, что у фоновой задачи shopify-descriptions. Оригинал описания
 * при записи сохраняется в метаполе italian_edit.bg_description_raw — если
 * разбор окажется неточным, откатиться будет откуда.
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { parseBgDescription, buildDescriptionHtml, isRewrittenDescription } from "../src/shopify/description";
import { rewriteDescriptions } from "../src/shopify/rewriteDescriptions";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const sampleLimit = limitArg === -1 ? 5 : Number(process.argv[limitArg + 1]) || 5;

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify не настроен в .env");
  process.exit(1);
}
const client = new ShopifyClient(config.shopify);

if (apply) {
  const stats = await rewriteDescriptions(client, { maxProducts: 1000 });
  console.log(
    `Просмотрено ${stats.scanned}, пересобрано ${stats.rewritten}, ` +
      `уже было ${stats.alreadyOurs}, ошибок ${stats.failed}`
  );
  if (stats.foreign.length > 0) {
    console.log(`\nФормат не распознан, оставлены как есть (${stats.foreign.length}):`);
    for (const t of stats.foreign) console.log(`  · ${t}`);
  }
  process.exit(0);
}

const PAGE = /* GraphQL */ `
  query DryRun($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active,draft -tag:'tg-bot'") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        vendor
        descriptionHtml
        mpnMetafield: metafield(namespace: "shopwoo", key: "_sw_mpn") { value }
      }
    }
  }
`;

interface Node {
  id: string;
  title: string;
  vendor: string | null;
  descriptionHtml: string | null;
  mpnMetafield: { value: string | null } | null;
}

let cursor: string | undefined;
let scanned = 0;
let willRewrite = 0;
let alreadyOurs = 0;
const foreign: string[] = [];
const samples: { title: string; before: string; after: string }[] = [];

for (;;) {
  const data = await client.graphql<{
    products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] };
  }>(PAGE, { cursor: cursor ?? null });

  for (const n of data.products.nodes) {
    scanned++;
    const raw = n.descriptionHtml ?? "";
    if (isRewrittenDescription(raw)) {
      alreadyOurs++;
      continue;
    }
    const facts = parseBgDescription(raw);
    if (!facts) {
      foreign.push(n.title);
      continue;
    }
    willRewrite++;
    if (!facts.mpn && n.mpnMetafield?.value) facts.mpn = n.mpnMetafield.value;
    if (samples.length < sampleLimit) {
      samples.push({
        title: n.title,
        before: raw,
        after: buildDescriptionHtml(facts, { title: n.title, vendor: n.vendor }),
      });
    }
  }

  if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
  cursor = data.products.pageInfo.endCursor;
}

for (const s of samples) {
  console.log(`\n${"=".repeat(70)}\n${s.title}\n${"=".repeat(70)}`);
  console.log("\n--- было ---\n" + s.before.replace(/></g, ">\n<"));
  console.log("\n--- станет ---\n" + s.after.replace(/></g, ">\n<"));
}

console.log(`\n${"=".repeat(70)}`);
console.log(`Просмотрено: ${scanned}`);
console.log(`Будет пересобрано: ${willRewrite}`);
console.log(`Уже наша вёрстка: ${alreadyOurs}`);
console.log(`Формат не распознан (оставим как есть): ${foreign.length}`);
for (const t of foreign) console.log(`  · ${t}`);
console.log("\nЭто сухой прогон. Записать: npx tsx scripts/rewrite-descriptions.ts --apply");
