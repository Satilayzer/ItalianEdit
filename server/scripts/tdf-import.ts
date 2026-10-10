/**
 * Импорт и синхронизация каталога TheDoubleF.
 *
 *   npx tsx scripts/tdf-import.ts                    сухой прогон: сводка + отчёт CSV
 *   npx tsx scripts/tdf-import.ts --apply            полный синк в Shopify (нужны SHOPIFY_* в .env)
 *   npx tsx scripts/tdf-import.ts --apply --limit 50 создать не больше 50 новых моделей (пилот)
 *   npx tsx scripts/tdf-import.ts --jsonl out.jsonl --location gid://shopify/Location/…
 *                                                    только файл для bulk-импорта (без доступа к API)
 *
 * Общие флаги:
 *   --feed <url|путь>   фид (по умолчанию TDF_FEED_URL или ссылка поставщика)
 *   --report <путь>     куда положить отчёт по моделям (по умолчанию tdf-report.csv)
 *   --keys <путь>       импортировать только модели из списка ключей (по строке)
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL, type FeedProduct } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate, type Evaluation } from "../src/tdf/rules";
import { productSetInput, priceProduct } from "../src/tdf/productInput";
import { DEFAULT_COSTS } from "../src/tdf/economics";
import { syncTdf, TDF_API_VERSION } from "../src/tdf/sync";
import { toJsonl } from "../src/shopify/bulk";
import { ShopifyClient } from "../src/shopify/client";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function loadProducts(src: string): Promise<FeedProduct[]> {
  if (existsSync(src)) return groupProducts(parseFeed(readFileSync(src, "utf8")));
  return fetchFeed(src);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function report(evals: Evaluation[], path: string): void {
  const head = [
    "product_key", "brand", "brand_status", "title", "category", "season", "include",
    "skip_reasons", "review", "images", "sizes", "stock", "price_eur", "sale_price_eur",
    "purchase_usd", "duty_rate", "direct_costs_usd", "break_even_usd", "floor_price_usd",
    "price_usd", "price_method", "remaining_usd", "margin", "pricing_decision", "supplier_link",
  ];
  const lines = [head.join(",")];
  for (const e of evals) {
    const p = e.product;
    // Цен конкурентов пока нет — рыночное решение MANUAL_DATA, цена по сетке маржи.
    const { costs: c, price: d } = priceProduct(p, e.category);
    lines.push(
      [
        p.key, e.brand.displayName, e.brand.status, p.title, e.category?.tags.at(-1) ?? "",
        p.season, e.include ? "yes" : "no", e.skipReasons.join(" | "), e.reviewTags.join(" "),
        p.images.length, p.variants.length, p.variants.reduce((s, v) => s + v.quantity, 0),
        p.price, p.salePrice,
        c ? (c.purchaseUsdCents / 100).toFixed(2) : "", c ? c.dutyBp / 100 + "%" : "",
        c ? (c.directCostsCents / 100).toFixed(2) : "", c ? (c.breakEvenCents / 100).toFixed(2) : "",
        c ? (c.floorCents / 100).toFixed(2) : "",
        d ? (d.priceCents / 100).toFixed(2) : "", d?.method ?? "",
        d ? (d.economics.remainingCents / 100).toFixed(2) : "",
        d ? (d.economics.margin * 100).toFixed(1) + "%" : "",
        d?.decision ?? "MANUAL_DATA", p.link,
      ].map(csvCell).join(",")
    );
  }
  // BOM — чтобы Excel открыл кириллицу без танцев.
  writeFileSync(path, "﻿" + lines.join("\n"), "utf8");
}

function summary(evals: Evaluation[]): void {
  const inc = evals.filter((e) => e.include);
  const count = (xs: string[]) =>
    Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  console.log(`Моделей в фиде: ${evals.length}`);
  console.log(`К импорту: ${inc.length} моделей, ${inc.reduce((s, e) => s + e.product.variants.length, 0)} размеров`);
  console.log(`Не импортируем: ${count(evals.flatMap((e) => e.skipReasons.map((r) => r.split(" ")[0] + " " + r.split(" ").slice(1).join(" "))))}`);
  console.log(`Пометки на проверку: ${count(inc.flatMap((e) => e.reviewTags))}`);
  console.log(`Разделы: ${count(inc.map((e) => e.category?.section ?? "без категории"))}`);
  console.log(`Курс EUR/USD ${DEFAULT_COSTS.eurUsd} на ${DEFAULT_COSTS.eurUsdDate}`);
}

async function main() {
  const feedSrc = opt("feed") ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL;
  const registry = await loadBrandRegistry();

  if (flag("apply")) {
    const shop = process.env.SHOPIFY_SHOP;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN || undefined;
    const clientId = process.env.SHOPIFY_CLIENT_ID || undefined;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || undefined;
    if (!shop || !(adminToken || (clientId && clientSecret))) {
      throw new Error("Для --apply нужны SHOPIFY_SHOP и SHOPIFY_ADMIN_TOKEN или SHOPIFY_CLIENT_ID/SECRET в server/.env");
    }
    const client = new ShopifyClient({ shop, adminToken, clientId, clientSecret, apiVersion: TDF_API_VERSION });
    const stats = await syncTdf(client, {
      feedUrl: feedSrc,
      registry,
      inventoryCap: Number(process.env.INVENTORY_CAP ?? 1),
      createLimit: opt("limit") ? Number(opt("limit")) : undefined,
      log: console.log,
    });
    console.log(stats.errors.slice(0, 20).join("\n"));
    return;
  }

  const products = await loadProducts(feedSrc);
  let evals = products.map((p) => evaluate(p, registry));
  summary(evals);
  const reportPath = opt("report") ?? "tdf-report.csv";
  report(evals, reportPath);
  console.log(`Отчёт: ${reportPath}`);

  const jsonlPath = opt("jsonl");
  if (jsonlPath) {
    const locationId = opt("location");
    if (!locationId) throw new Error("--jsonl требует --location gid://shopify/Location/…");
    const keysPath = opt("keys");
    if (keysPath) {
      const keys = new Set(readFileSync(keysPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      evals = evals.filter((e) => keys.has(e.product.key));
    }
    let toCreate = evals.filter((e) => e.include);
    if (opt("limit")) toCreate = toCreate.slice(0, Number(opt("limit")));
    const lines = toCreate.map((e) => ({
      input: productSetInput(e, { locationId, inventoryCap: Number(process.env.INVENTORY_CAP ?? 1) }),
    }));
    writeFileSync(jsonlPath, toJsonl(lines), "utf8");
    console.log(`JSONL для bulk productSet: ${jsonlPath} (${lines.length} моделей)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
