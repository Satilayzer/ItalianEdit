/**
 * Догружает фото TheDoubleF в уже созданные товары.
 *
 * Синк не трогает медиа существующих товаров, а поставщик добавил в фид колонку
 * `additional_images_2` (2026-10-21). Фото в карточке создавались по порядку
 * `images` из фида, поэтому недостающие — это хвост `images` после уже загруженных.
 *
 *   npx tsx scripts/tdf-backfill-images.ts                сухой прогон: сколько товаров и фото добавится
 *   npx tsx scripts/tdf-backfill-images.ts --apply        догрузить фото
 *   npx tsx scripts/tdf-backfill-images.ts --feed <путь>  взять фид из файла вместо ссылки поставщика
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL, type FeedProduct } from "../src/tdf/feed";
import { TDF_API_VERSION } from "../src/tdf/sync";
import { MIN_PHOTOS, REVIEW } from "../src/tdf/rules";
import { ShopifyClient } from "../src/shopify/client";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const feedArg = args.indexOf("--feed") >= 0 ? args[args.indexOf("--feed") + 1] : undefined;

interface StoreProduct {
  id: string;
  title: string;
  vendor: string;
  status: string;
  tags: string[];
  productKey: { value: string } | null;
  mediaCount: { count: number } | null;
}

async function loadFeed(src: string): Promise<Map<string, FeedProduct>> {
  const products = existsSync(src) ? groupProducts(parseFeed(readFileSync(src, "utf8"))) : await fetchFeed(src);
  return new Map(products.map((p) => [p.key, p]));
}

async function storeProducts(client: ShopifyClient): Promise<StoreProduct[]> {
  const out: StoreProduct[] = [];
  let after: string | null = null;
  do {
    const data: {
      products: { nodes: StoreProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
    } = await client.graphql(
      `query($after: String) {
        products(first: 250, after: $after, query: "tag:tdf") {
          nodes {
            id title vendor status tags
            productKey: metafield(namespace: "tdf", key: "product_key") { value }
            mediaCount { count }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after }
    );
    out.push(...data.products.nodes);
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function main() {
  const shop = process.env.SHOPIFY_SHOP;
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN || undefined;
  const clientId = process.env.SHOPIFY_CLIENT_ID || undefined;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || undefined;
  if (!shop || !(adminToken || (clientId && clientSecret))) {
    throw new Error("Нужны SHOPIFY_SHOP и SHOPIFY_ADMIN_TOKEN или SHOPIFY_CLIENT_ID/SECRET в server/.env");
  }
  const client = new ShopifyClient({ shop, adminToken, clientId, clientSecret, apiVersion: TDF_API_VERSION });

  const feed = await loadFeed(feedArg ?? process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL);
  const products = await storeProducts(client);
  console.log(`Фид: ${feed.size} моделей. В магазине товаров tdf: ${products.length}`);

  const plan = products
    .map((sp) => {
      const fp = sp.productKey ? feed.get(sp.productKey.value) : undefined;
      const have = sp.mediaCount?.count ?? 0;
      return { sp, have, missing: fp ? fp.images.slice(have) : [] };
    })
    .filter((x) => x.missing.length > 0);

  const photos = plan.reduce((s, x) => s + x.missing.length, 0);
  const unblocked = plan.filter(
    (x) => x.sp.tags.includes(REVIEW.photos) && x.have < MIN_PHOTOS && x.have + x.missing.length >= MIN_PHOTOS
  );
  console.log(`Догрузить: ${photos} фото в ${plan.length} товаров`);
  console.log(`Черновики с ${REVIEW.photos}, которым хватит фото после догрузки: ${unblocked.length}`);
  if (!apply) return;

  let done = 0;
  const errors: string[] = [];
  for (const { sp, have, missing } of plan) {
    const media = missing.map((url, i) => ({
      originalSource: url,
      mediaContentType: "IMAGE",
      alt: `${sp.vendor} ${sp.title} — view ${have + i + 1}`,
    }));
    try {
      const data = await client.graphql<{
        productUpdate: { userErrors: { field: string[] | null; message: string }[] };
      }>(
        `mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) { userErrors { field message } }
        }`,
        { product: { id: sp.id }, media }
      );
      const errs = data.productUpdate.userErrors;
      if (errs.length) errors.push(`${sp.id}: ${errs.map((e) => e.message).join("; ")}`);
    } catch (err) {
      errors.push(`${sp.id}: ${(err as Error).message}`);
    }
    if (++done % 200 === 0) console.log(`  ${done}/${plan.length}`);
  }
  console.log(`Готово: ${done - errors.length}/${plan.length} товаров. Ошибок: ${errors.length}`);
  console.log(errors.slice(0, 20).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
