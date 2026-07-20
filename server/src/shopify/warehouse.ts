import type { Warehouse } from "../bg/mapProduct";

/**
 * Тег склада отгрузки — на нём держится фильтр «откуда едет» на витрине.
 *
 * Важно: это НЕ регион покупателя. Товар с европейского склада продаётся
 * и в США — просто едет дольше. Фильтр даёт покупателю выбрать быструю
 * доставку, а не ограничивает каталог по географии.
 */

export const WAREHOUSE_TAG_PREFIX = "warehouse:";

/** Склад по умолчанию: у BrandsGateway подавляющее большинство стока в Европе. */
export const DEFAULT_WAREHOUSE: Warehouse = "eu";

/** Товары из ТГ-группы менеджер везёт вручную из Италии. */
export const TG_WAREHOUSE: Warehouse = "eu";

export function warehouseTag(warehouse: Warehouse | null | undefined): string {
  return `${WAREHOUSE_TAG_PREFIX}${warehouse ?? DEFAULT_WAREHOUSE}`;
}

/** Достаёт склад из списка тегов товара. Нет тега — null. */
export function warehouseFromTags(tags: string[]): Warehouse | null {
  for (const tag of tags) {
    const value = tag.trim().toLowerCase();
    if (!value.startsWith(WAREHOUSE_TAG_PREFIX)) continue;
    const warehouse = value.slice(WAREHOUSE_TAG_PREFIX.length);
    if (warehouse === "eu" || warehouse === "us") return warehouse;
  }
  return null;
}
