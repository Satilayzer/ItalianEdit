/**
 * Проверка черновиков TheDoubleF перед публикацией и сама публикация.
 * По каждому размеру сверяет с текущим расчётом: цену v3.0, зачёркнутую
 * цену (розница в Италии), себестоимость, остаток — и что цена не ниже
 * безубыточности. Публикуются только товары без замечаний и со скидкой.
 *
 *   npx tsx scripts/tdf-publish-drafts.ts --brands "Gucci,Prada,Saint Laurent"           сухой прогон
 *   npx tsx scripts/tdf-publish-drafts.ts --brands "Gucci,Prada,Saint Laurent" --apply   статус ACTIVE
 *   npx tsx scripts/tdf-publish-drafts.ts --status active                                та же сверка опубликованных
 *
 * Нужны SHOPIFY_* в server/.env.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct } from "../src/tdf/productInput";
import { compareAtCents, retailItalyUsdCents, DEFAULT_COSTS } from "../src/tdf/economics";
import { runBulkQuery } from "../src/shopify/bulk";
import { ShopifyClient } from "../src/shopify/client";
import { TDF_API_VERSION } from "../src/tdf/sync";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const QUERY = /* GraphQL */ `
  {
    products(query: "tag:tdf status:__STATUS__") {
      edges {
        node {
          id
          title
          vendor
          tags
          key: metafield(namespace: "tdf", key: "product_key") { value }
          variants {
            edges {
              node {
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem { unitCost { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

const PUBLISH = /* GraphQL */ `
  mutation TdfPublish($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

const cents = (v: string | null | undefined) => (v == null || v === "" ? null : Math.round(Number(v) * 100));
const usd = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("Нужны SHOPIFY_SHOP и ключи в server/.env");
  const brands = new Set((opt("brands") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const status = opt("status") ?? "draft";
  if (brands.size === 0 && flag("apply")) throw new Error("--apply только с --brands \"Gucci,Prada\"");
  if (flag("apply") && status !== "draft") throw new Error("--apply публикует только черновики");
  const client = new ShopifyClient({
    shop,
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || undefined,
    clientId: process.env.SHOPIFY_CLIENT_ID || undefined,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || undefined,
    apiVersion: TDF_API_VERSION,
  });

  const products = await fetchFeed(opt("feed") ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL);
  const registry = await loadBrandRegistry();
  const byKey = new Map(products.map((p) => [p.key, evaluate(p, registry)]));

  type Row = Record<string, any>;
  const rows = await runBulkQuery<Row>(client, QUERY.replace("__STATUS__", status));
  const items = new Map<string, Row & { variants: Row[] }>();
  for (const r of rows) if (!r.__parentId) items.set(r.id, { ...r, variants: [] });
  for (const r of rows) if (r.__parentId) items.get(r.__parentId)?.variants.push(r);

  const head = ["brand", "title", "ok", "problems", "price", "compare_at", "discount", "break_even", "stock", "admin_url"];
  const lines = [head.join(",")];
  const ready: string[] = [];
  const problemCount = new Map<string, number>();
  let checked = 0;
  for (const p of items.values()) {
    if (brands.size > 0 && !brands.has(String(p.vendor).toLowerCase())) continue;
    checked++;
    const problems: string[] = [];
    const kinds = new Set<string>();
    const add = (kind: string, detail = "") => {
      kinds.add(kind);
      problems.push(detail ? `${kind} ${detail}` : kind);
    };
    const e = byKey.get(p.key?.value ?? "");
    const { costs, price } = e ? priceProduct(e.product, e.category) : { costs: null, price: null };
    const retail = e ? retailItalyUsdCents(e.product.price, DEFAULT_COSTS) : null;
    const target = price?.priceCents ?? null;
    const wantCompare = compareAtCents(retail, target);
    const stock = p.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0);
    if (!e) add("нет в фиде");
    else if (!e.include) add("не проходит правила импорта");
    if (e && !target) add("нет расчётной цены");
    if (stock <= 0) add("нет остатка");
    for (const v of p.variants) {
      const pc = cents(v.price);
      const cc = cents(v.compareAtPrice);
      if (target !== null && pc !== target) add("цена", `${v.sku}: ${usd(pc)} вместо ${usd(target)}`);
      if (e && cc !== wantCompare) add("зачёркнутая", `${v.sku}: ${usd(cc)} вместо ${usd(wantCompare)}`);
      if (costs && cents(v.inventoryItem?.unitCost?.amount) !== costs.purchaseUsdCents) add("себестоимость", v.sku);
      if (costs && pc !== null && pc < costs.breakEvenCents) add("ниже безубыточности", v.sku);
      if (pc !== null && !(cc !== null && cc > pc)) add("нет скидки", v.sku);
    }
    for (const k of kinds) problemCount.set(k, (problemCount.get(k) ?? 0) + 1);
    const v0 = p.variants[0] ?? {};
    const pc0 = cents(v0.price);
    const cc0 = cents(v0.compareAtPrice);
    if (problems.length === 0) ready.push(p.id);
    lines.push(
      [
        p.vendor, p.title, problems.length === 0 ? "да" : "нет", problems.join(" | "), usd(pc0), usd(cc0),
        pc0 && cc0 ? `${Math.round((1 - pc0 / cc0) * 100)}%` : "", usd(costs?.breakEvenCents ?? null), stock,
        `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${p.id.split("/").pop()}`,
      ].map(csvCell).join(",")
    );
  }
  const out = opt("out") ?? "tdf-publish-check.csv";
  writeFileSync(out, "﻿" + lines.join("\n"), "utf8");
  console.log(`Черновиков проверено: ${checked}, готовы к публикации: ${ready.length}. Отчёт: ${out}`);
  for (const [k, n] of [...problemCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

  if (!flag("apply")) return;
  let published = 0;
  for (const id of ready) {
    const res = await client.graphql<{ productUpdate: { userErrors: { message: string }[] } }>(PUBLISH, {
      product: { id, status: "ACTIVE" },
    });
    if (res.productUpdate.userErrors.length > 0) {
      console.log(`${id}: ${res.productUpdate.userErrors.map((u) => u.message).join("; ")}`);
    } else published++;
  }
  console.log(`Опубликовано: ${published} из ${ready.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
