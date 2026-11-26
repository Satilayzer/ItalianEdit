/**
 * Наши цены против Google Shopping США — только по товарам, которые попали на
 * сайт за последние N дней (по publishedAt в Shopify, статус ACTIVE).
 *
 * Для каждого товара: цена на сайте (минимальная по размерам), закупка и
 * наценка по сетке v3.0 (markupFor) из фида TheDoubleF; запрос «бренд +
 * название из фида» в Google Shopping (Serper, gl=us). Средняя по первым трём
 * ценам в USD и отдельно — по первым трём результатам с брендом в названии.
 * Цены дальше чем в 5 раз от нашей (у IFCHIC бывают «$18 650 090») не берутся.
 * Одна модель (артикул) из разных партий поставщика считается один раз.
 * Итог — таблица по диапазонам закупки, как в отчёте по всему фиду.
 *
 *   npx tsx scripts/recent-google-prices.ts [--days 7] [--out recent-google-prices.csv]
 *
 * Ответы Serper берутся из того же кэша, что у tdf-google-prices.ts
 * (data/google-prices-cache.jsonl): уже оплаченные запросы не повторяются.
 */
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { priceProduct, styleCode } from "../src/tdf/productInput";
import { markupFor } from "../src/tdf/pricing";
import { TDF_API_VERSION } from "../src/tdf/sync";
import { ShopifyClient } from "../src/shopify/client";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const KEY = process.env.SERPER_API_KEY;
if (!KEY) throw new Error("Нужен SERPER_API_KEY");
const DAYS = Number(opt("days") ?? 7);
const CACHE = fileURLToPath(new URL("../data/google-prices-cache.jsonl", import.meta.url));

interface Hit { title: string; source: string; price: number; link: string }

function usd(price: string | undefined): number | null {
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
let fromCache = 0;
async function shopping(q: string): Promise<Hit[]> {
  const cached = cache.get(q);
  if (cached) {
    fromCache++;
    return cached;
  }
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

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BANDS = [
  { label: "0–299", from: 0, to: 300 },
  { label: "300–799", from: 300, to: 800 },
  { label: "800–1 199", from: 800, to: 1200 },
  { label: "1 200–1 799", from: 1200, to: 1800 },
  { label: "1 800–2 500", from: 1800, to: 2500 },
  { label: "2 500+", from: 2500, to: Infinity },
];

interface Row {
  brand: string; title: string; siteTitle: string; publishedAt: string; purchase: number; markup: number;
  ours: number; v3: number | null; avg3: number | null; bavg3: number | null; brandHits: number; q: string; top: Hit[];
}

async function main() {
  const client = new ShopifyClient({
    shop: process.env.SHOPIFY_SHOP!,
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || undefined,
    clientId: process.env.SHOPIFY_CLIENT_ID || undefined,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || undefined,
    apiVersion: TDF_API_VERSION,
  });
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
  const query = `status:active published_at:>=${since}`;
  type P = { title: string; vendor: string; publishedAt: string; tags: string[]; key: { value: string } | null; variants: { nodes: { price: string }[] } };
  const site: P[] = [];
  let after: string | null = null;
  for (;;) {
    const d: any = await client.graphql(
      `query($q:String,$after:String){ products(first:100, query:$q, after:$after, sortKey:PUBLISHED_AT, reverse:true){
        nodes{ title vendor publishedAt tags key: metafield(namespace:"tdf", key:"product_key"){ value } variants(first:50){ nodes{ price } } }
        pageInfo{ hasNextPage endCursor } } }`,
      { q: query, after }
    );
    site.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    after = d.products.pageInfo.endCursor;
  }
  console.log(`На сайт за ${DAYS} дн. (с ${since}) попало: ${site.length}`);

  const products = await fetchFeed(opt("feed") ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL);
  const registry = await loadBrandRegistry();
  const byKey = new Map(products.map((p) => [p.key, p]));

  const rows: Row[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const s of site) {
    const fp = s.key ? byKey.get(s.key.value) : undefined;
    if (!fp) {
      skipped.push(`${s.vendor} ${s.title} — нет в фиде TDF (нет закупки)`);
      continue;
    }
    const model = styleCode(fp.variants[0]?.id ?? "") || fp.key;
    if (seen.has(model)) {
      skipped.push(`${s.vendor} ${s.title} — та же модель ${model} ещё одним листингом`);
      continue;
    }
    seen.add(model);
    const e = evaluate(fp, registry);
    const { costs, price } = priceProduct(fp, e.category);
    if (!costs) {
      skipped.push(`${s.vendor} ${s.title} — не посчитать закупку`);
      continue;
    }
    const brandName = e.brand?.displayName ?? s.vendor;
    const q = `${brandName} ${fp.title}`;
    const oursNow = Math.min(...s.variants.nodes.map((v) => Number(v.price)));
    const hits = (await shopping(q)).filter((h) => h.price >= oursNow / 5 && h.price <= oursNow * 5);
    const top = hits.slice(0, 3);
    const brandWord = norm(brandName).split(" ")[0];
    const branded = hits.filter((h) => norm(h.title).includes(brandWord)).slice(0, 3);
    rows.push({
      brand: brandName, title: fp.title, siteTitle: s.title, publishedAt: s.publishedAt.slice(0, 10),
      purchase: costs.purchaseUsdCents / 100, markup: markupFor(costs.purchaseUsdCents).markupBp / 10_000,
      ours: oursNow,
      v3: price ? price.priceCents / 100 : null,
      avg3: avg(top.map((h) => h.price)), bavg3: avg(branded.map((h) => h.price)), brandHits: branded.length, q, top,
    });
  }
  console.log(`Сравнено: ${rows.length}; Serper: из кэша ${fromCache}, кредитов потрачено ${spent}`);
  for (const s of skipped) console.log(`  пропуск: ${s}`);

  // Таблица по диапазонам закупки.
  const pct = (x: number | null) => (x === null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1).replace(".", ",")}%`);
  const money = (x: number | null) => (x === null ? "—" : `$${Math.round(x).toLocaleString("ru-RU")}`);
  function line(label: string, markup: string, rs: Row[], g: (r: Row) => number | null) {
    const withG = rs.filter((r) => g(r) !== null);
    const ratios = withG.map((r) => r.ours / g(r)! - 1);
    const cheaper = ratios.filter((x) => x < 0).length;
    const ours = median(rs.map((r) => r.ours));
    const goog = median(withG.map((r) => g(r)!));
    return [
      label, markup, String(rs.length), money(ours), money(goog),
      pct(median(ratios)),
      withG.length ? `${Math.round((cheaper / withG.length) * 100)}% (${cheaper}/${withG.length})` : "—",
      String(ratios.filter((x) => x > 0.1).length),
    ];
  }
  function table(title: string, g: (r: Row) => number | null) {
    const head = ["Закупка, $", "Наценка", "Моделей", "Наша цена (медиана)", "Google (медиана)", "Мы к Google (медиана)", "Дешевле Google", "Дороже >10%"];
    const body = BANDS.map((b) => {
      const rs = rows.filter((r) => r.purchase >= b.from && r.purchase < b.to);
      return rs.length ? line(b.label, `${Math.round(markupFor(b.from * 100).markupBp / 100)}%`, rs, g) : null;
    }).filter((x): x is string[] => x !== null);
    body.push(line("Всего", "", rows, g));
    console.log(`\n${title}\n| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`);
    for (const r of body) console.log(`| ${r.join(" | ")} |`);
  }
  table("Google: средняя первых трёх результатов", (r) => r.avg3);
  table("Google: средняя первых трёх результатов с брендом в названии", (r) => r.bavg3);

  console.log("\nПо товарам:");
  for (const r of [...rows].sort((a, b) => a.purchase - b.purchase))
    console.log(`  ${r.publishedAt} ${r.brand} | ${r.title} | закупка $${r.purchase.toFixed(0)} +${r.markup * 100}% | наша $${r.ours} | топ-3 ${money(r.avg3)} (${pct(r.avg3 ? r.ours / r.avg3 - 1 : null)}) | с брендом ${money(r.bavg3)} [${r.brandHits}]`);

  const head = ["published", "brand", "feed_title", "site_title", "purchase_usd", "markup", "our_price_usd", "v3_price_usd",
    "g1_usd", "g1_source", "g1_title", "g2_usd", "g2_source", "g2_title", "g3_usd", "g3_source", "g3_title",
    "google_avg3_usd", "diff_vs_avg3", "brand_hits", "google_brand_avg3_usd", "diff_vs_brand_avg3", "query"];
  const out = opt("out") ?? "recent-google-prices.csv";
  writeFileSync(out, "﻿" + [head.join(","), ...rows.map((r) => [
    r.publishedAt, r.brand, r.title, r.siteTitle, r.purchase.toFixed(2), r.markup, r.ours, r.v3 ?? "",
    ...[0, 1, 2].flatMap((k) => (r.top[k] ? [r.top[k].price, r.top[k].source, r.top[k].title] : ["", "", ""])),
    r.avg3?.toFixed(2) ?? "", r.avg3 ? (r.ours / r.avg3 - 1).toFixed(4) : "",
    r.brandHits, r.bavg3?.toFixed(2) ?? "", r.bavg3 ? (r.ours / r.bavg3 - 1).toFixed(4) : "", r.q,
  ].map(csvCell).join(","))].join("\n"), "utf8");
  console.log(`\nФайл: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
