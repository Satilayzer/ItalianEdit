/**
 * Выгрузка для проверки цен TheDoubleF: что стоит в магазине (цена,
 * зачёркнутая цена, себестоимость, HS-код, страна) рядом с исходными ценами
 * поставщика из свежего фида. Из CSV собирается Excel с формулами
 * (tools/price-check/build_xlsx.py).
 *
 *   npx tsx scripts/tdf-price-check.ts [--feed <url|путь>] [--out tdf-price-check.csv]
 *
 * Только читает: нужны SHOPIFY_* в server/.env.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL, type FeedProduct } from "../src/tdf/feed";
import { loadBrandRegistry } from "../src/tdf/brands";
import { evaluate } from "../src/tdf/rules";
import { countryCode, dutyRateBp, usMfnBp, DEFAULT_COSTS } from "../src/tdf/economics";
import { loadMarket, type MarketRow } from "../src/tdf/market";
import { offerUsdCents } from "../src/tdf/pricing";
import { styleCode } from "../src/tdf/productInput";
import { runBulkQuery } from "../src/shopify/bulk";
import { ShopifyClient } from "../src/shopify/client";
import { TDF_API_VERSION } from "../src/tdf/sync";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const QUERY = /* GraphQL */ `
  {
    products(query: "tag:tdf") {
      edges {
        node {
          id
          handle
          title
          vendor
          status
          tags
          key: metafield(namespace: "tdf", key: "product_key") { value }
          pricing: metafield(namespace: "tdf", key: "pricing") { value }
          variants {
            edges {
              node {
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem { unitCost { amount } harmonizedSystemCode countryCodeOfOrigin }
              }
            }
          }
        }
      }
    }
  }
`;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) throw new Error("Нужны SHOPIFY_SHOP и ключи в server/.env");
  const client = new ShopifyClient({
    shop,
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || undefined,
    clientId: process.env.SHOPIFY_CLIENT_ID || undefined,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || undefined,
    apiVersion: TDF_API_VERSION,
  });

  const feedSrc = opt("feed") ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL;
  const products: FeedProduct[] = existsSync(feedSrc)
    ? groupProducts(parseFeed(readFileSync(feedSrc, "utf8")))
    : await fetchFeed(feedSrc);
  const registry = await loadBrandRegistry();
  const market = await loadMarket();
  const ttlDays = Number(process.env.TDF_MARKET_TTL_DAYS) || 14;
  // Последнее предложение каждого конкурента по модели — и пригодно ли оно.
  const latest = new Map<string, MarketRow>();
  for (const r of market.rows) {
    const key = `${r.modelCode}|${r.competitor}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(prev.checkedAt) < Date.parse(r.checkedAt)) latest.set(key, r);
  }
  const offerCells = (model: string, competitor: string) => {
    const r = latest.get(`${model}|${competitor}`);
    if (!r) return ["", "", "", ""];
    const age = (Date.now() - Date.parse(r.checkedAt)) / 86_400_000;
    const problem = offerUsdCents(r.offer).problem ?? (!(age <= ttlDays) ? `старше ${ttlDays} дн.` : "");
    return [(r.offer.totalCents / 100).toFixed(2), r.checkedAt, problem ? `нет: ${problem}` : "да", r.url];
  };
  const byKey = new Map(products.map((p) => [p.key, evaluate(p, registry)]));

  type Row = Record<string, any>;
  const rows = await runBulkQuery<Row>(client, QUERY);
  const items = new Map<string, Row & { variants: Row[] }>();
  for (const r of rows) if (!r.__parentId) items.set(r.id, { ...r, variants: [] });
  for (const r of rows) if (r.__parentId) items.get(r.__parentId)?.variants.push(r);

  const head = [
    "brand", "title", "status", "section", "subcategory", "model_code", "hs_code", "country", "eu",
    "price_eur", "sale_price_eur", "in_feed", "store_price", "prices_differ", "store_compare_at",
    "store_cost", "stock", "price_mode", "review", "supplier_link", "admin_url",
    "duty_rate", "duty_basis", "price_method", "price_decision",
    "farfetch_usd", "farfetch_checked", "farfetch_usable", "farfetch_url",
    "italist_usd", "italist_checked", "italist_usable", "italist_url",
  ];
  const lines = [head.join(",")];
  for (const p of items.values()) {
    const e = byKey.get(p.key?.value ?? p.handle);
    const v0 = p.variants[0] ?? {};
    const prices = new Set(p.variants.map((v) => v.price));
    const country = v0.inventoryItem?.countryCodeOfOrigin ?? (e ? countryCode(e.product.madeIn) : null);
    const section = e?.category?.section ?? ["Clothing", "Shoes", "Bags", "Accessories"].find((s) => p.tags.includes(s)) ?? "";
    const tags: string[] = p.tags;
    const model = (styleCode(e?.product.variants[0]?.id ?? v0.sku ?? "") ?? "").toUpperCase();
    let pricing: { method?: string; decision?: string } | null = null;
    try {
      pricing = p.pricing?.value ? JSON.parse(p.pricing.value) : null;
    } catch {}
    lines.push(
      [
        p.vendor, p.title, p.status, section, e?.category?.tags.at(-1)?.split(" - ")[0] ?? "",
        styleCode(e?.product.variants[0]?.id ?? v0.sku ?? ""), v0.inventoryItem?.harmonizedSystemCode ?? "",
        country ?? "", country ? (EU.has(country) ? "да" : "нет") : "",
        e?.product.price ?? "", e?.product.salePrice ?? "", e ? "да" : "нет",
        v0.price ?? "", prices.size > 1 ? "да" : "", v0.compareAtPrice ?? "",
        v0.inventoryItem?.unitCost?.amount ?? "",
        p.variants.reduce((s, v) => s + (v.inventoryQuantity ?? 0), 0),
        tags.includes("price:auto") ? "авто" : tags.includes("price:pending") ? "нет цены" : "ручная",
        tags.filter((t) => t.startsWith("review:")).join(" "),
        e?.product.link ?? "",
        `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${p.id.split("/").pop()}`,
        e ? dutyRateBp(e.category, country, DEFAULT_COSTS, e.product.hsCode) / 10_000 : "",
        e ? (usMfnBp(e.product.hsCode) !== null ? "HS-код" : "оценка по группе") : "",
        pricing?.method ?? "", pricing?.decision ?? "",
        ...offerCells(model, "farfetch"),
        ...offerCells(model, "italist"),
      ].map(csvCell).join(",")
    );
  }
  const out = opt("out") ?? "tdf-price-check.csv";
  writeFileSync(out, "﻿" + lines.join("\n"), "utf8");
  console.log(`Товаров ${items.size}, в фиде ${[...items.values()].filter((p) => byKey.has(p.key?.value ?? p.handle)).length}. ` +
    `Курс ${DEFAULT_COSTS.eurUsd} на ${DEFAULT_COSTS.eurUsdDate}. Файл: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
