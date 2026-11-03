/**
 * Автопубликация черновиков TheDoubleF (решение 03.11.2026 — исключение из R19
 * для брендов из списка: по умолчанию Gucci, Prada, Saint Laurent).
 *
 * Черновик выходит на витрину, только если по каждому размеру всё сходится
 * с текущим расчётом: цена v3.0, зачёркнутая цена (розница в Италии) выше цены,
 * себестоимость, цена не ниже безубыточности, есть остаток. Пошлина должна
 * считаться по HS-коду: если фид пришёл без кодов (так было 03.11.2026),
 * цена посчитана по оценке группы — такой товар остаётся черновиком.
 *
 * Каналы — те же, что у уже опубликованных товаров TheDoubleF (Online Store,
 * Google, Pinterest, Meta…). Нужны скоупы read_publications и write_publications.
 */
import type { ShopifyClient } from "../shopify/client";
import type { Evaluation } from "./rules";
import type { IndexedProduct } from "./sync";
import { priceProduct, SOURCE_TAG } from "./productInput";
import { compareAtCents, retailItalyUsdCents, DEFAULT_COSTS, type CostSettings } from "./economics";

export const DEFAULT_AUTO_PUBLISH_BRANDS = ["Gucci", "Prada", "Saint Laurent"];

/** Бренды автопубликации, в нижнем регистре. TDF_AUTO_PUBLISH_BRANDS="" выключает. */
export function autoPublishBrands(raw: string | undefined = process.env.TDF_AUTO_PUBLISH_BRANDS): Set<string> {
  const list = raw === undefined ? DEFAULT_AUTO_PUBLISH_BRANDS : raw.split(",");
  return new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export interface PublishProblem {
  kind: string;
  detail?: string;
}

const usd = (c: number | null) => (c === null ? "—" : (c / 100).toFixed(2));

/** Что мешает опубликовать товар. Пустой список — можно. */
export function publishProblems(
  shop: IndexedProduct,
  e: Evaluation | undefined,
  settings: CostSettings = DEFAULT_COSTS
): PublishProblem[] {
  const out: PublishProblem[] = [];
  const add = (kind: string, detail?: string) => out.push(detail ? { kind, detail } : { kind });
  if (!e) {
    add("нет в фиде");
    return out;
  }
  if (!e.include) add("не проходит правила импорта");
  if (!e.product.hsCode) add("нет HS-кода");
  const { costs, price } = priceProduct(e.product, e.category, settings);
  const target = price?.priceCents ?? null;
  if (target === null) add("нет расчётной цены");
  const wantCompare = compareAtCents(retailItalyUsdCents(e.product.price, settings), target);
  const variants = [...shop.variants.values()];
  if (variants.reduce((s, v) => s + v.quantity, 0) <= 0) add("нет остатка");
  for (const v of variants) {
    if (target !== null && v.priceCents !== target) add("цена", `${v.sku}: ${usd(v.priceCents)} вместо ${usd(target)}`);
    if (v.compareAtCents !== wantCompare) add("зачёркнутая", `${v.sku}: ${usd(v.compareAtCents)} вместо ${usd(wantCompare)}`);
    if (costs && v.costCents !== costs.purchaseUsdCents) add("себестоимость", v.sku);
    if (costs && v.priceCents < costs.breakEvenCents) add("ниже безубыточности", v.sku);
    if (!(v.compareAtCents !== null && v.compareAtCents > v.priceCents)) add("нет скидки", v.sku);
  }
  return out;
}

/** Черновики брендов автопубликации, прошедшие проверку. */
export function publishCandidates(
  index: Map<string, IndexedProduct>,
  evaluations: Evaluation[],
  brands: Set<string>,
  settings: CostSettings = DEFAULT_COSTS
): IndexedProduct[] {
  const byKey = new Map(evaluations.map((e) => [e.product.key, e]));
  return [...index.values()].filter((shop) => {
    const e = byKey.get(shop.key);
    return (
      shop.status === "DRAFT" &&
      !!e &&
      brands.has(e.brand.displayName.toLowerCase()) &&
      publishProblems(shop, e, settings).length === 0
    );
  });
}

const CATALOG_PUBLICATIONS = /* GraphQL */ `
  {
    products(first: 1, query: "tag:${SOURCE_TAG} status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes { resourcePublications(first: 20) { nodes { isPublished publication { id } } } }
    }
  }
`;

const PUBLISH = /* GraphQL */ `
  mutation TdfPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

const ACTIVATE = /* GraphQL */ `
  mutation TdfActivate($product: ProductUpdateInput!) {
    productUpdate(product: $product) { userErrors { field message } }
  }
`;

/** Каналы, где опубликован каталог: по последнему обновлённому активному товару TheDoubleF. */
export async function catalogPublicationIds(client: ShopifyClient): Promise<string[]> {
  const data = await client.graphql<{
    products: { nodes: { resourcePublications: { nodes: { isPublished: boolean; publication: { id: string } }[] } }[] };
  }>(CATALOG_PUBLICATIONS);
  const ids = (data.products.nodes[0]?.resourcePublications.nodes ?? [])
    .filter((p) => p.isPublished)
    .map((p) => p.publication.id);
  if (ids.length === 0) throw new Error("не нашёл каналов продаж у опубликованных товаров TheDoubleF");
  return ids;
}

/** Публикует товары в каналы каталога и ставит ACTIVE. Ошибки — в errors, товар остаётся черновиком. */
export async function publishProducts(
  client: ShopifyClient,
  products: IndexedProduct[],
  errors: string[]
): Promise<number> {
  if (products.length === 0) return 0;
  let publications: string[];
  try {
    publications = await catalogPublicationIds(client);
  } catch (err) {
    errors.push(`публикация: каналы продаж недоступны (нужны скоупы read_publications, write_publications) — ${String(err)}`);
    return 0;
  }
  const input = publications.map((publicationId) => ({ publicationId }));
  let published = 0;
  for (const p of products) {
    try {
      const pub = await client.graphql<{ publishablePublish: { userErrors: { message: string }[] } }>(PUBLISH, { id: p.id, input });
      if (pub.publishablePublish.userErrors.length > 0) {
        errors.push(`публикация ${p.handle}: ${pub.publishablePublish.userErrors.map((u) => u.message).join("; ")}`);
        continue;
      }
      const act = await client.graphql<{ productUpdate: { userErrors: { message: string }[] } }>(ACTIVATE, {
        product: { id: p.id, status: "ACTIVE" },
      });
      if (act.productUpdate.userErrors.length > 0) {
        errors.push(`публикация ${p.handle}: ${act.productUpdate.userErrors.map((u) => u.message).join("; ")}`);
        continue;
      }
      published++;
    } catch (err) {
      errors.push(`публикация ${p.handle}: ${String(err)}`);
      // Нет скоупа — дальше то же самое для каждого товара.
      if (/access|scope/i.test(String(err))) break;
    }
  }
  return published;
}
