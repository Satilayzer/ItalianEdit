/**
 * Сравнение наших цен (Pricing Logic v3.0) с Google Shopping США.
 *
 * По каждой модели фида, которая идёт в магазин: запрос «бренд + название»
 * в Google Shopping (Serper, gl=us), первые три цены в USD → средняя; на
 * сколько наша цена выше или ниже. Вторая средняя — только по результатам
 * с брендом в названии (первая тройка Google часто содержит другие модели).
 *
 *   SERPER_API_KEY=… npx tsx scripts/tdf-google-prices.ts [--feed <путь>] [--limit N] [--out файл.csv]
 *
 * Ответы Serper кэшируются в data/google-prices-cache.jsonl (вне git): при
 * повторном запуске оплаченные запросы не повторяются. Один запрос — 2 кредита.
 */
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct, styleCode } from "../src/tdf/productInput";
import { markupFor } from "../src/tdf/pricing";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const KEY = process.env.SERPER_API_KEY;
if (!KEY) throw new Error("Нужен SERPER_API_KEY");
const CACHE = fileURLToPath(new URL("../data/google-prices-cache.jsonl", import.meta.url));
const CONCURRENCY = 8;

interface Hit { title: string; source: string; price: number; link: string }

/** «$1,234.00» → 1234; «CA$…», «A$…», «€…» и без цены → null (только доллары США). */
export function usd(price: string | undefined): number | null {
  if (!price) return null;
  const p = price.trim();
  if (!/^\$\s?[\d,]+(\.\d+)?/.test(p)) return null;
  const n = Number(p.replace(/^\$\s?/, "").replace(/,/g, "").match(/^[\d.]+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const cache = new Map<string, Hit[]>();
if (existsSync(CACHE)) {
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      cache.set(r.q, r.hits);
    } catch {}
  }
}

let spent = 0;
async function shopping(q: string): Promise<Hit[]> {
  const cached = cache.get(q);
  if (cached) return cached;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "us", hl: "en", num: 10 }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (res?.ok) {
      const j = (await res.json()) as { shopping?: { title: string; source: string; price?: string; link: string }[]; credits?: number };
      spent += j.credits ?? 0;
      const hits = (j.shopping ?? [])
        .map((r) => ({ title: r.title, source: r.source, link: r.link, price: usd(r.price) }))
        .filter((h): h is Hit => h.price !== null);
      cache.set(q, hits);
      appendFileSync(CACHE, JSON.stringify({ q, hits }) + "\n");
      return hits;
    }
    if (res && res.status !== 429 && res.status < 500) throw new Error(`Serper: HTTP ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
  }
  throw new Error(`Serper: не удалось получить «${q}»`);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const feedSrc = opt("feed") ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL;
  const products = existsSync(feedSrc) ? groupProducts(parseFeed(readFileSync(feedSrc, "utf8"))) : await fetchFeed(feedSrc);
  const registry = await loadBrandRegistry();
  let evals = products.map((p) => evaluate(p, registry)).filter((e) => e.include);
  if (opt("limit")) evals = evals.slice(0, Number(opt("limit")));
  console.log(`Моделей: ${evals.length}, в кэше уже: ${evals.filter((e) => cache.has(`${e.brand.displayName} ${e.product.title}`)).length}`);

  const head = [
    "model_code", "brand", "title", "section", "purchase_usd", "duty_rate", "costs_usd", "markup", "our_price_usd",
    "g1_usd", "g1_source", "g1_title", "g2_usd", "g2_source", "g2_title", "g3_usd", "g3_source", "g3_title",
    "google_avg3_usd", "diff_vs_avg3", "brand_hits", "google_brand_avg3_usd", "diff_vs_brand_avg3", "query", "supplier_link",
  ];
  const rows: string[] = new Array(evals.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= evals.length) return;
      const e = evals[i];
      const { costs, price } = priceProduct(e.product, e.category);
      const q = `${e.brand.displayName} ${e.product.title}`;
      const hits = await shopping(q);
      const top = hits.slice(0, 3);
      const avg = top.length ? top.reduce((s, h) => s + h.price, 0) / top.length : null;
      const brand = norm(e.brand.displayName).split(" ")[0];
      const branded = hits.filter((h) => norm(h.title).includes(brand)).slice(0, 3);
      const bavg = branded.length ? branded.reduce((s, h) => s + h.price, 0) / branded.length : null;
      const ours = price ? price.priceCents / 100 : null;
      const cells = [0, 1, 2].flatMap((k) => (top[k] ? [top[k].price, top[k].source, top[k].title] : ["", "", ""]));
      rows[i] = [
        styleCode(e.product.variants[0]?.id ?? ""), e.brand.displayName, e.product.title, e.category?.section ?? "",
        costs ? (costs.purchaseUsdCents / 100).toFixed(2) : "", costs ? costs.dutyBp / 10_000 : "",
        costs ? (costs.directCostsCents / 100).toFixed(2) : "",
        costs ? markupFor(costs.purchaseUsdCents).markupBp / 10_000 : "", ours ?? "",
        ...cells,
        avg !== null ? avg.toFixed(2) : "", avg && ours ? (ours / avg - 1).toFixed(4) : "",
        branded.length, bavg !== null ? bavg.toFixed(2) : "", bavg && ours ? (ours / bavg - 1).toFixed(4) : "",
        q, e.product.link,
      ].map(csvCell).join(",");
      if (++done % 200 === 0) console.log(`${new Date().toISOString().slice(11, 19)} ${done}/${evals.length}, кредитов потрачено ${spent}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const out = opt("out") ?? "tdf-google-prices.csv";
  writeFileSync(out, "﻿" + [head.join(","), ...rows].join("\n"), "utf8");
  console.log(`Готово: ${evals.length} моделей, кредитов потрачено ${spent}. Файл: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
