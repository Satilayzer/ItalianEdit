import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Реестр брендов TheDoubleF: какой бренд выводим на старте и под каким именем.
 *
 * Источник правды — таблица Артура и Юли «Italian Edit: решение по стартовому
 * ассортименту», лист «Реестр брендов для запуска», колонка «Финальный статус».
 * Снимок лежит в `server/data/tdf-brands.csv`. Если задан `TDF_BRANDS_CSV_URL`
 * (экспорт листа в CSV), синк читает живую таблицу — правка статуса Юлей
 * подхватывается без деплоя.
 */

export type BrandStatus = "HERO" | "SHOW" | "DISCUSS" | "HIDE";

export interface BrandEntry {
  supplierBrand: string;
  /** Как бренд пишется на сайте (vendor в Shopify): «Dolce&Gabbana» → «Dolce & Gabbana». */
  displayName: string;
  status: BrandStatus;
}

export type BrandRegistry = Map<string, BrandEntry>;

const SNAPSHOT_PATH = fileURLToPath(new URL("../../data/tdf-brands.csv", import.meta.url));

/** Минимальный CSV-парсер: кавычки, запятые и переводы строк внутри кавычек. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeStatus(raw: string): BrandStatus | null {
  const v = raw.trim().toUpperCase();
  return v === "HERO" || v === "SHOW" || v === "DISCUSS" || v === "HIDE" ? v : null;
}

export function brandKey(brand: string): string {
  return brand.trim().toLowerCase();
}

/**
 * Разбирает CSV реестра. Понимает два вида:
 *  - снимок (`supplier_brand,display_name,brand_group,final_status`);
 *  - экспорт листа Google целиком — шапка «Бренд поставщика … Финальный статус»
 *    ищется по названиям колонок, строки-заголовки над ней пропускаются.
 */
export function parseBrandRegistry(csv: string): BrandRegistry {
  const rows = parseCsv(csv);
  const headerAt = rows.findIndex((r) =>
    r.some((c) => /^(supplier_brand|Бренд поставщика)$/i.test(c.trim()))
  );
  if (headerAt < 0) throw new Error("Реестр брендов: не найдена шапка таблицы");
  const header = rows[headerAt].map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iBrand = col("supplier_brand", "бренд поставщика");
  const iName = col("display_name", "название на сайте");
  const iStatus = col("final_status", "финальный статус");
  if (iBrand < 0 || iStatus < 0) throw new Error("Реестр брендов: нет колонки бренда или статуса");

  const registry: BrandRegistry = new Map();
  for (const r of rows.slice(headerAt + 1)) {
    const supplierBrand = (r[iBrand] ?? "").trim();
    const status = normalizeStatus(r[iStatus] ?? "");
    if (!supplierBrand || !status) continue;
    registry.set(brandKey(supplierBrand), {
      supplierBrand,
      displayName: (iName >= 0 && r[iName]?.trim()) || supplierBrand,
      status,
    });
  }
  return registry;
}

export function loadBrandSnapshot(path: string = SNAPSHOT_PATH): BrandRegistry {
  return parseBrandRegistry(readFileSync(path, "utf8"));
}

/** Живая таблица, если задан URL; при любой ошибке — снимок (синк не должен вставать). */
export async function loadBrandRegistry(
  url: string | undefined = process.env.TDF_BRANDS_CSV_URL,
  fetchFn: typeof fetch = fetch
): Promise<BrandRegistry> {
  if (url) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return parseBrandRegistry(await res.text());
      console.warn(`Реестр брендов: HTTP ${res.status}, беру снимок`);
    } catch (err) {
      console.warn("Реестр брендов недоступен, беру снимок:", err);
    }
  }
  return loadBrandSnapshot();
}

/**
 * Бренд, которого нет в реестре (поставщик добавил новый), считаем DISCUSS:
 * скрыт до решения Юли — правило R19 «новое не публикуется автоматически».
 */
export function brandEntry(registry: BrandRegistry, brand: string): BrandEntry {
  return (
    registry.get(brandKey(brand)) ?? {
      supplierBrand: brand,
      displayName: brand.replace(/™/g, "").trim(),
      status: "DISCUSS",
    }
  );
}
