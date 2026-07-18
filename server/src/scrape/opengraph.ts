import * as cheerio from "cheerio";
import type { ProductInfo } from "../types";
import { resolveImageUrls } from "./jsonld";

/** Фолбэк: OpenGraph-теги, когда JSON-LD на странице нет. */
export function parseOpenGraph(html: string, url: string): ProductInfo | null {
  const $ = cheerio.load(html);
  const meta = (prop: string) =>
    $(`meta[property="${prop}"], meta[name="${prop}"]`).attr("content")?.trim();

  const title = meta("og:title");
  if (!title) return null;

  const images = resolveImageUrls(
    $('meta[property="og:image"]')
      .toArray()
      .map((el) => $(el).attr("content")?.trim())
      .filter((u): u is string => !!u),
    url
  );

  const rawPrice = meta("product:price:amount") ?? meta("og:price:amount");
  const price = rawPrice ? Number.parseFloat(rawPrice.replace(",", ".")) : undefined;

  return {
    title,
    url,
    brand: meta("product:brand") ?? meta("og:site_name"),
    description: meta("og:description"),
    images,
    price: Number.isFinite(price) ? price : undefined,
    currency: meta("product:price:currency") ?? meta("og:price:currency"),
    source: "opengraph",
  };
}
