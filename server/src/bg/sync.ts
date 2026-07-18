import type { Pool } from "pg";
import type { BgClient } from "./client";
import { mapProduct, type MapOptions } from "./mapProduct";
import { upsertProducts, activeProductIds, updateStock } from "../db/products";
import { logSync } from "../db/syncLog";

/** Разбить массив на батчи фиксированного размера. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const UPSERT_BATCH = 200;
const STATUS_BATCH = 1000;

/**
 * Полный/дельта импорт каталога BG → наша БД.
 * updatedSince задан → тянем только изменившиеся товары (дельта-синк).
 */
export async function importCatalog(
  pool: Pool,
  client: BgClient,
  opts: MapOptions & { updatedSince?: string } = {}
): Promise<number> {
  const { updatedSince, ...mapOpts } = opts;
  let buffer = [];
  let total = 0;

  try {
    for await (const p of client.iterateProducts(
      updatedSince ? { updated_at_min: updatedSince } : {}
    )) {
      buffer.push(mapProduct(p, mapOpts));
      if (buffer.length >= UPSERT_BATCH) {
        await upsertProducts(pool, buffer);
        total += buffer.length;
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      await upsertProducts(pool, buffer);
      total += buffer.length;
    }
    await logSync(pool, updatedSince ? "delta" : "full", total, true);
    return total;
  } catch (err) {
    await logSync(pool, updatedSince ? "delta" : "full", total, false, String(err));
    throw err;
  }
}

/**
 * Быстрая сверка наличия: check-status батчами по 1000 для всех активных товаров.
 * Продано у BG → ставим остаток 0 (с учётом cap для остальных).
 */
export async function syncStockStatuses(
  pool: Pool,
  client: BgClient,
  opts: { inventoryCap?: number } = {}
): Promise<number> {
  const ids = await activeProductIds(pool);
  let updated = 0;
  try {
    for (const batch of chunk(ids, STATUS_BATCH)) {
      const statuses = await client.checkStatuses(batch);
      for (const s of statuses) {
        const raw =
          s.stock_quantity ?? (s.in_stock || s.stock_status === "instock" ? 1 : 0);
        const stock =
          opts.inventoryCap === undefined ? raw : Math.min(raw, opts.inventoryCap);
        await updateStock(pool, s.id, stock);
        updated++;
      }
    }
    await logSync(pool, "status", updated, true);
    return updated;
  } catch (err) {
    await logSync(pool, "status", updated, false, String(err));
    throw err;
  }
}
