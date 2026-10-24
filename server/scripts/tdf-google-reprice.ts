/**
 * Пересчёт сравнения с Google под текущую формулу цены — без новых запросов
 * к Serper: цены Google берутся из прошлого CSV (scripts/tdf-google-prices.ts),
 * наша цена и расходы — заново из фида.
 *
 *   npx tsx scripts/tdf-google-reprice.ts <старый.csv> <новый.csv> [--feed <путь>]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseCsv } from "../src/tdf/brands";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct } from "../src/tdf/productInput";
import { markupFor } from "../src/tdf/pricing";

const [src, out] = process.argv.slice(2);
const feedArg = process.argv.includes("--feed") ? process.argv[process.argv.indexOf("--feed") + 1] : undefined;
const feedSrc = feedArg ?? DEFAULT_FEED_URL;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const products = existsSync(feedSrc) ? groupProducts(parseFeed(readFileSync(feedSrc, "utf8"))) : await fetchFeed(feedSrc);
const registry = await loadBrandRegistry();
const byLink = new Map(products.map((p) => [p.link, evaluate(p, registry)]));

const [head, ...rows] = parseCsv(readFileSync(src, "utf8").replace(/^﻿/, "")).filter((r) => r.length > 1);
const col = (n: string) => head.indexOf(n);
let updated = 0;
let missing = 0;
const outRows = rows.map((r) => {
  const e = byLink.get(r[col("supplier_link")]);
  if (!e || !e.include) {
    missing++;
    return r;
  }
  const { costs, price } = priceProduct(e.product, e.category);
  if (!costs || !price) return r;
  const ours = price.priceCents / 100;
  const set = (name: string, v: unknown) => (r[col(name)] = v === null || v === undefined ? "" : String(v));
  set("purchase_usd", (costs.purchaseUsdCents / 100).toFixed(2));
  set("duty_rate", costs.dutyBp / 10_000);
  set("costs_usd", (costs.directCostsCents / 100).toFixed(2));
  set("markup", markupFor(costs.purchaseUsdCents).markupBp / 10_000);
  set("our_price_usd", ours);
  const avg = Number(r[col("google_avg3_usd")]);
  const bavg = Number(r[col("google_brand_avg3_usd")]);
  set("diff_vs_avg3", avg > 0 ? (ours / avg - 1).toFixed(4) : "");
  set("diff_vs_brand_avg3", bavg > 0 ? (ours / bavg - 1).toFixed(4) : "");
  updated++;
  return r;
});
writeFileSync(out, "﻿" + [head, ...outRows].map((r) => r.map(csvCell).join(",")).join("\n"), "utf8");
console.log(`Пересчитано ${updated}, без пары в фиде ${missing} (оставлены как были). Файл: ${out}`);
