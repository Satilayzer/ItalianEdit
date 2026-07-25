import type { Warehouse } from "../bg/mapProduct";

/**
 * Тег склада отгрузки — на нём держится фильтр «откуда едет» на витрине.
 *
 * Важно: это НЕ регион покупателя. Товар с европейского склада продаётся
 * и в США — просто едет дольше. Фильтр даёт покупателю выбрать быструю
 * доставку, а не ограничивает каталог по географии.
 */

/** Склад по умолчанию: у BrandsGateway подавляющее большинство стока в Европе. */
export const DEFAULT_WAREHOUSE: Warehouse = "eu";

/** Товары из ТГ-группы менеджер везёт вручную из Италии. */
export const TG_WAREHOUSE: Warehouse = "eu";

/** Метки склада на витрине — EU / US (без префикса), схема переключателя «Ships from». */
const WAREHOUSE_TAG: Record<Warehouse, string> = { eu: "EU", us: "US" };

export function warehouseTag(warehouse: Warehouse | null | undefined): string {
  return WAREHOUSE_TAG[warehouse ?? DEFAULT_WAREHOUSE];
}

/** Достаёт склад из списка тегов товара. Нет тега — null. Регистр не важен. */
export function warehouseFromTags(tags: string[]): Warehouse | null {
  const set = new Set(tags.map((t) => t.trim().toLowerCase()));
  if (set.has("eu")) return "eu";
  if (set.has("us")) return "us";
  return null;
}
