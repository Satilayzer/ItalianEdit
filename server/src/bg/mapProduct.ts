import type { BgProduct, BgMeta } from "./types";
import { computeOurPrice, type PricingRules, DEFAULT_PRICING } from "./pricing";

export type Warehouse = "eu" | "us";

/** Строка каталога в нашей БД (см. db/schema.sql). */
export interface ProductRow {
  bg_id: number;
  sku: string;
  name: string;
  brand: string | null;
  description: string | null;
  images: string[];
  wholesale_price: number | null;
  sale_price: number | null;
  our_price: number | null;
  stock: number;
  warehouse: Warehouse | null;
  bg_updated_at: string | null;
}

export interface MapOptions {
  pricing?: PricingRules;
  /** Максимум остатка, который публикуем (правило «отдавать 1»). */
  inventoryCap?: number;
}

// Коды/названия стран US-складов BrandsGateway (Миннесота, Флорида).
const US_HINTS = ["us", "usa", "united states", "florida", "minnesota", "fl", "mn"];

function metaValue(meta: BgMeta[] | undefined, keyPart: string): string | undefined {
  return meta?.find((m) => m.key.toLowerCase().includes(keyPart))?.value;
}

/**
 * Определяет склад товара. Точный ключ в meta_data подтвердим на реальных данных;
 * пока ищем meta-ключ с «location»/«warehouse» и сопоставляем со списком US-подсказок.
 * Неизвестно → 'eu' (у BG подавляющее большинство стока в Европе).
 */
export function detectWarehouse(p: BgProduct): Warehouse | null {
  const raw =
    metaValue(p.meta_data, "location") ??
    metaValue(p.meta_data, "warehouse") ??
    metaValue(p.meta_data, "country");
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return US_HINTS.some((h) => v === h || v.includes(h)) ? "us" : "eu";
}

/** Суммарный остаток: если есть вариации-размеры, берём их сумму. */
export function totalStock(p: BgProduct): number {
  if (p.variations && p.variations.length > 0) {
    return p.variations.reduce((sum, v) => sum + (v.stock_quantity ?? 0), 0);
  }
  return p.stock_quantity ?? (p.in_stock ? 1 : 0);
}

/** Оптовая цена, по которой считаем наценку. sale_price приоритетнее regular_price. */
export function wholesalePrice(p: BgProduct): number | null {
  const price = p.sale_price ?? p.regular_price;
  return typeof price === "number" && price > 0 ? price : null;
}

/** Остаток для публикации в Shopify с учётом правила «отдавать 1». */
export function cappedStock(stock: number, cap: number | undefined): number {
  if (cap === undefined) return stock;
  return Math.min(stock, cap);
}

/** BG-товар → строка нашего каталога (цена по наценке, склад, ограничение остатка). */
export function mapProduct(p: BgProduct, opts: MapOptions = {}): ProductRow {
  const rules = opts.pricing ?? DEFAULT_PRICING;
  const brand = p.brand?.name ?? null;
  const wholesale = wholesalePrice(p);
  const stock = cappedStock(totalStock(p), opts.inventoryCap);

  const images = [...(p.images ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((img) => img.src)
    .filter(Boolean);

  return {
    bg_id: p.id,
    sku: p.sku,
    name: p.name,
    brand,
    description: p.description ?? null,
    images,
    wholesale_price: wholesale,
    sale_price: p.sale_price ?? null,
    our_price: wholesale ? computeOurPrice(wholesale, brand ?? undefined, rules) : null,
    stock,
    warehouse: detectWarehouse(p),
    bg_updated_at: p.updated_at ?? null,
  };
}
