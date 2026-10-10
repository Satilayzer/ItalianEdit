/**
 * XML-фид TheDoubleF (Atom + Google Merchant поля).
 *
 * Фид — плоский список ВАРИАНТОВ (одна запись = один размер). Товар собираем
 * сами: варианты одной модели делят ссылку на товар поставщика, отличается
 * только `?variant=`. Все товарные поля (бренд, название, цены, сезон, фото)
 * внутри модели одинаковые — это проверено на живом фиде.
 *
 * Отдельная XML-библиотека не нужна: структура фиксированная, без вложенности
 * и атрибутов, а фид весит ~20 МБ — регулярки справляются за секунду.
 */

export const DEFAULT_FEED_URL =
  "https://feedfiles.woolytech.com/vip-tdf.myshopify.com/Af0dt2zn6O.xml";

/** Одна запись фида = один вариант (размер) товара. */
export interface FeedVariant {
  /** Стабильный ID варианта поставщика, напр. `SPSFERITOCO/XM_SPORM-001_102-40`. */
  id: string;
  /** ID варианта в Shopify поставщика (`?variant=` в ссылке) — нужен для заказа по API. */
  supplierVariantId: string | null;
  /** Handle товара поставщика — ключ группировки вариантов в модель. */
  productKey: string;
  link: string;
  imageLink: string;
  additionalImages: string[];
  /** Цена поставщика до скидки, EUR без VAT. */
  price: number | null;
  /** Цена со скидкой, EUR без VAT. 0 — скидки нет (закупка = price). */
  salePrice: number | null;
  availability: string;
  brand: string;
  gender: string;
  ageGroup: string;
  color: string;
  googleCategory: string;
  productType: string;
  size: string;
  material: string;
  quantity: number;
  season: string;
  madeIn: string;
  title: string;
  description: string;
  barcode: string;
  hsCode: string;
}

/** Модель: общие поля + её размеры. */
export interface FeedProduct {
  key: string;
  brand: string;
  title: string;
  description: string;
  gender: string;
  ageGroup: string;
  color: string;
  productType: string;
  material: string;
  season: string;
  madeIn: string;
  hsCode: string;
  price: number | null;
  salePrice: number | null;
  link: string;
  images: string[];
  variants: FeedVariant[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    });
}

function field(entry: string, tag: string): string {
  // Поля бывают и с префиксом g: (Google Merchant), и без него.
  const re = new RegExp(`<(?:g:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:g:)?${tag}>`);
  const m = entry.match(re);
  return m ? decodeXml(m[1]).trim() : "";
}

/** «EUR 182.46» / «456.15» → 182.46. Пусто или мусор → null (не ноль!). */
export function parseMoney(raw: string): number | null {
  const m = raw.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function productKeyFromLink(link: string): string {
  const m = link.match(/\/products\/([^?#/]+)/);
  return m ? m[1] : link;
}

function supplierVariantIdFromLink(link: string): string | null {
  const m = link.match(/[?&]variant=(\d+)/);
  return m ? m[1] : null;
}

export function parseFeed(xml: string): FeedVariant[] {
  const variants: FeedVariant[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const link = field(e, "link");
    const extra = field(e, "additional_images");
    variants.push({
      id: field(e, "id"),
      supplierVariantId: supplierVariantIdFromLink(link),
      productKey: productKeyFromLink(link),
      link,
      imageLink: field(e, "image_link"),
      additionalImages: extra ? extra.split(/[\s,|]+/).filter((u) => u.startsWith("http")) : [],
      price: parseMoney(field(e, "price")),
      salePrice: parseMoney(field(e, "sale_price")),
      availability: field(e, "availability"),
      brand: field(e, "brand"),
      gender: field(e, "gender"),
      ageGroup: field(e, "age_group"),
      color: field(e, "color"),
      googleCategory: field(e, "google_product_category"),
      productType: field(e, "product_type"),
      size: field(e, "size"),
      material: field(e, "material"),
      quantity: Number.parseInt(field(e, "quantity"), 10) || 0,
      season: field(e, "season"),
      madeIn: field(e, "made_in"),
      title: field(e, "title"),
      description: field(e, "description"),
      barcode: field(e, "barcode"),
      hsCode: field(e, "hs_code"),
    });
  }
  return variants;
}

/** Ссылка без UTM и `?variant=` — каноническая ссылка модели (правило R17). */
function canonicalLink(link: string): string {
  return link.split("?")[0];
}

export function groupProducts(variants: FeedVariant[]): FeedProduct[] {
  const byKey = new Map<string, FeedProduct>();
  for (const v of variants) {
    let p = byKey.get(v.productKey);
    if (!p) {
      p = {
        key: v.productKey,
        brand: v.brand,
        title: v.title,
        description: v.description,
        gender: v.gender,
        ageGroup: v.ageGroup,
        color: v.color,
        productType: v.productType,
        material: v.material,
        season: v.season,
        madeIn: v.madeIn,
        hsCode: v.hsCode,
        price: v.price,
        salePrice: v.salePrice,
        link: canonicalLink(v.link),
        images: [],
        variants: [],
      };
      byKey.set(v.productKey, p);
    }
    for (const url of [v.imageLink, ...v.additionalImages]) {
      if (url && !p.images.includes(url)) p.images.push(url);
    }
    p.variants.push(v);
  }
  return [...byKey.values()];
}

export async function fetchFeed(
  url: string = DEFAULT_FEED_URL,
  fetchFn: typeof fetch = fetch
): Promise<FeedProduct[]> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Фид TheDoubleF: HTTP ${res.status}`);
  const variants = parseFeed(await res.text());
  // Пустой или битый фид не должен «обнулить» каталог при синке (сценарий I03).
  if (variants.length === 0) throw new Error("Фид TheDoubleF пуст — синк пропущен");
  return groupProducts(variants);
}
