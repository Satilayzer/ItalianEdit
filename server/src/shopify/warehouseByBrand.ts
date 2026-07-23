import type { Warehouse } from "../bg/mapProduct";
import { DEFAULT_WAREHOUSE } from "./warehouse";

/**
 * Определение склада по бренду — для режима IMPORT_MODE=app, где товары
 * заливает приложение BrandsGateway, а API у нас нет. Приложение BG проставляет
 * теги категории и пола, но НЕ склад, поэтому склад выводим из бренда (vendor).
 *
 * Источник — документация BrandsGateway о размещении стока по складам:
 * US-склады (Миннесота, Флорида) держат небольшой набор американских марок;
 * весь остальной люкс — на складах ЕС (Италия, Швеция, Германия, Испания).
 */
const US_BRANDS = new Set([
  "michael kors",
  "michaelkors",
  "coach",
  "tory burch",
  "toryburch",
]);

function norm(brand: string): string {
  return brand.trim().toLowerCase();
}

/** Склад бренда: известная US-марка → 'us', иначе склад по умолчанию (EU). */
export function warehouseForBrand(brand: string | null | undefined): Warehouse {
  if (!brand) return DEFAULT_WAREHOUSE;
  return US_BRANDS.has(norm(brand)) ? "us" : DEFAULT_WAREHOUSE;
}

export function isKnownUsBrand(brand: string | null | undefined): boolean {
  return !!brand && US_BRANDS.has(norm(brand));
}
