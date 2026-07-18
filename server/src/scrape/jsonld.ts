import * as cheerio from "cheerio";
import type { ProductInfo } from "../types";

type Json = Record<string, unknown>;

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isProductType(node: Json): boolean {
  return asArray(node["@type"]).some(
    (t) => typeof t === "string" && t.toLowerCase() === "product"
  );
}

/** Рекурсивно ищет узел Product в JSON-LD (учитывая @graph и вложенные массивы). */
function findProductNode(data: unknown): Json | null {
  for (const item of asArray(data)) {
    if (item == null || typeof item !== "object") continue;
    const node = item as Json;
    if (isProductType(node)) return node;
    const inGraph = findProductNode(node["@graph"]);
    if (inGraph) return inGraph;
  }
  return null;
}

function extractImages(image: unknown): string[] {
  return asArray(image)
    .map((img) => {
      if (typeof img === "string") return img;
      if (img && typeof img === "object") {
        const url = (img as Json).url ?? (img as Json).contentUrl;
        return typeof url === "string" ? url : null;
      }
      return null;
    })
    .filter((u): u is string => !!u);
}

/** Относительные ссылки на фото → абсолютные (от адреса страницы) + дедупликация. */
export function resolveImageUrls(urls: string[], baseUrl: string): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const abs = new URL(u, baseUrl).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      // битую ссылку пропускаем
    }
  }
  return out;
}

function extractOffer(offers: unknown): {
  price?: number;
  currency?: string;
  availability?: string;
} {
  const first = asArray(offers)[0];
  if (!first || typeof first !== "object") return {};
  const offer = first as Json;
  const rawPrice = offer.price ?? offer.lowPrice;
  const price =
    typeof rawPrice === "number"
      ? rawPrice
      : typeof rawPrice === "string"
        ? Number.parseFloat(rawPrice.replace(/[^\d.]/g, ""))
        : undefined;
  const currency =
    typeof offer.priceCurrency === "string" ? offer.priceCurrency : undefined;
  const availability =
    typeof offer.availability === "string"
      ? offer.availability.replace(/^https?:\/\/schema\.org\//i, "")
      : undefined;
  return {
    price: Number.isFinite(price) ? price : undefined,
    currency,
    availability,
  };
}

/** Достаёт данные товара из разметки schema.org Product (JSON-LD) — есть у большинства брендов. */
export function parseJsonLd(html: string, url: string): ProductInfo | null {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const text = $(el).text();
    if (!text.trim()) continue;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    const product = findProductNode(data);
    if (!product) continue;

    const name = typeof product.name === "string" ? product.name.trim() : "";
    if (!name) continue;

    const brandRaw = product.brand;
    const brand =
      typeof brandRaw === "string"
        ? brandRaw
        : brandRaw && typeof brandRaw === "object" &&
            typeof (brandRaw as Json).name === "string"
          ? ((brandRaw as Json).name as string)
          : undefined;

    return {
      title: name,
      url,
      brand,
      description:
        typeof product.description === "string"
          ? product.description.trim()
          : undefined,
      images: resolveImageUrls(extractImages(product.image), url),
      ...extractOffer(product.offers),
      source: "jsonld",
    };
  }
  return null;
}
