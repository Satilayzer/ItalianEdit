import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./brands";
import type { MarketOffer, MarketOffers } from "./pricing";

/**
 * Цены конкурентов для рыночного режима Pricing Logic v1.0 (Farfetch US,
 * Italist US). Собирает команда вручную — сайты отдают регион и валюту по IP,
 * так что проверять нужно с американского IP и в долларах.
 *
 * Источник: снимок `server/data/tdf-market.csv` или живая Google-таблица
 * (`TDF_MARKET_CSV_URL`, экспорт листа в CSV). Одна строка — одно предложение:
 *
 *   model_code, competitor, total_usd, currency, country, checked_at, url, note
 *
 * model_code — «Артикул TDF» (часть SKU до «/», как в таблице проверки цен);
 * competitor — farfetch | italist; total_usd — итог для покупателя в США:
 * товар + доставка + импорт, без sales tax (I02: если пошлина не включена —
 * прибавить её, иначе предложение не сопоставимо). Предложение старше
 * TDF_MARKET_TTL_DAYS (14 дней) не учитываем (I01: устаревшее — исключить).
 * Не USD или не US — исключается в autoPrice() (offerUsdCents).
 */

export type MarketTable = Map<string, MarketOffers>;

const SNAPSHOT_PATH = fileURLToPath(new URL("../../data/tdf-market.csv", import.meta.url));
const DAY_MS = 24 * 60 * 60_000;

export interface MarketRow {
  modelCode: string;
  competitor: "farfetch" | "italist";
  offer: MarketOffer;
  checkedAt: string;
  url: string;
}

export function parseMarket(text: string): MarketRow[] {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const idx = {
    model: col("model_code"),
    competitor: col("competitor"),
    total: col("total_usd"),
    currency: col("currency"),
    country: col("country"),
    checked: col("checked_at"),
    url: col("url"),
  };
  if (idx.model < 0 || idx.competitor < 0 || idx.total < 0) {
    throw new Error("Цены конкурентов: нужны колонки model_code, competitor, total_usd");
  }
  const out: MarketRow[] = [];
  for (const r of rows) {
    const competitor = r[idx.competitor]?.trim().toLowerCase();
    const modelCode = r[idx.model]?.trim().toUpperCase();
    // «1 234,50» / «1,234.50» / «$1234» → центы; мусор — пропускаем строку.
    const raw = (r[idx.total] ?? "").replace(/[^\d.,]/g, "");
    const normalized = /,\d{2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    const total = Number(normalized);
    if (!modelCode || (competitor !== "farfetch" && competitor !== "italist") || !(total > 0)) continue;
    out.push({
      modelCode,
      competitor,
      offer: {
        totalCents: Math.round(total * 100),
        currency: (r[idx.currency] ?? "").trim(),
        country: (r[idx.country] ?? "").trim(),
      },
      checkedAt: (r[idx.checked] ?? "").trim(),
      url: (r[idx.url] ?? "").trim(),
    });
  }
  return out;
}

/**
 * Свежие предложения по модели: у каждого конкурента — последнее по дате.
 * Без даты или старше ttlDays — не берём.
 */
export function buildMarket(rows: MarketRow[], now = new Date(), ttlDays = 14): MarketTable {
  const latest = new Map<string, MarketRow>();
  for (const r of rows) {
    const t = Date.parse(r.checkedAt);
    if (!Number.isFinite(t) || now.getTime() - t > ttlDays * DAY_MS) continue;
    const key = `${r.modelCode}|${r.competitor}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(prev.checkedAt) < t) latest.set(key, r);
  }
  const table: MarketTable = new Map();
  for (const r of latest.values()) {
    const offers = table.get(r.modelCode) ?? { farfetch: null, italist: null };
    offers[r.competitor] = r.offer;
    table.set(r.modelCode, offers);
  }
  return table;
}

export async function loadMarket(
  url: string | undefined = process.env.TDF_MARKET_CSV_URL,
  fetchFn: typeof fetch = fetch,
  ttlDays = Number(process.env.TDF_MARKET_TTL_DAYS) || 14
): Promise<{ rows: MarketRow[]; table: MarketTable }> {
  let text: string | null = null;
  if (url) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) text = await res.text();
      else console.warn(`Цены конкурентов: HTTP ${res.status}, беру снимок`);
    } catch (err) {
      console.warn("Цены конкурентов недоступны, беру снимок:", err);
    }
  }
  if (text === null) {
    try {
      text = readFileSync(SNAPSHOT_PATH, "utf8");
    } catch {
      return { rows: [], table: new Map() };
    }
  }
  const rows = parseMarket(text);
  return { rows, table: buildMarket(rows, new Date(), ttlDays) };
}
