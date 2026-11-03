/**
 * Проверка черновиков TheDoubleF перед публикацией и сама публикация — та же
 * проверка, что у автопубликации в синке (src/tdf/publish.ts): по каждому
 * размеру цена v3.0, зачёркнутая цена выше цены, себестоимость, безубыточность,
 * остаток и HS-код в фиде.
 *
 *   npx tsx scripts/tdf-publish-drafts.ts --brands "Gucci,Prada,Saint Laurent"           сухой прогон
 *   npx tsx scripts/tdf-publish-drafts.ts --brands "Gucci,Prada,Saint Laurent" --apply   в каналы + ACTIVE
 *   npx tsx scripts/tdf-publish-drafts.ts --status active                                та же сверка опубликованных
 *
 * Нужны SHOPIFY_* в server/.env; для --apply — скоупы read_publications и write_publications.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct } from "../src/tdf/productInput";
import { fetchIndex, TDF_API_VERSION } from "../src/tdf/sync";
import { publishProblems, publishProducts } from "../src/tdf/publish";
import { ShopifyClient } from "../src/shopify/client";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const usd = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("Нужны SHOPIFY_SHOP и ключи в server/.env");
  const brands = new Set((opt("brands") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const status = (opt("status") ?? "draft").toUpperCase();
  if (brands.size === 0 && flag("apply")) throw new Error("--apply только с --brands \"Gucci,Prada\"");
  if (flag("apply") && status !== "DRAFT") throw new Error("--apply публикует только черновики");
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
  const index = await fetchIndex(client);

  const head = ["brand", "title", "ok", "problems", "price", "compare_at", "discount", "break_even", "stock", "admin_url"];
  const lines = [head.join(",")];
  const ready = [];
  const problemCount = new Map<string, number>();
  let checked = 0;
  for (const p of index.values()) {
    if (p.status !== status) continue;
    const e = byKey.get(p.key);
    const brand = e?.brand.displayName ?? "";
    if (brands.size > 0 && !brands.has(brand.toLowerCase())) continue;
    checked++;
    const problems = publishProblems(p, e);
    for (const k of new Set(problems.map((x) => x.kind))) problemCount.set(k, (problemCount.get(k) ?? 0) + 1);
    if (problems.length === 0) ready.push(p);
    const v0 = [...p.variants.values()][0];
    const costs = e ? priceProduct(e.product, e.category).costs : null;
    lines.push(
      [
        brand, e?.product.title ?? p.handle, problems.length === 0 ? "да" : "нет",
        problems.map((x) => (x.detail ? `${x.kind} ${x.detail}` : x.kind)).join(" | "),
        usd(v0?.priceCents), usd(v0?.compareAtCents),
        v0?.priceCents && v0.compareAtCents ? `${Math.round((1 - v0.priceCents / v0.compareAtCents) * 100)}%` : "",
        usd(costs?.breakEvenCents), [...p.variants.values()].reduce((s, v) => s + v.quantity, 0),
        `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${p.id.split("/").pop()}`,
      ].map(csvCell).join(",")
    );
  }
  const out = opt("out") ?? "tdf-publish-check.csv";
  writeFileSync(out, "﻿" + lines.join("\n"), "utf8");
  console.log(`Проверено: ${checked}, без замечаний: ${ready.length}. Отчёт: ${out}`);
  for (const [k, n] of [...problemCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

  if (!flag("apply")) return;
  const errors: string[] = [];
  const published = await publishProducts(client, ready, errors);
  console.log(`Опубликовано: ${published} из ${ready.length}`);
  if (errors.length > 0) console.log(errors.slice(0, 20).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
