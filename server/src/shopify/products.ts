import type { Pool } from "pg";
import type { ShopifyClient } from "./client";
import type { PushRow } from "../db/products";
import { productsToPush, markPushed, markPushError } from "../db/products";
import { logSync } from "../db/syncLog";
import { warehouseTag } from "./warehouse";
import { genderTags } from "./gender";

const MAX_IMAGES = 8;

interface UserError {
  field?: string[];
  message: string;
}

function throwOnErrors(op: string, errors: UserError[]): void {
  if (errors.length > 0) {
    throw new Error(`Shopify ${op}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Теги товара BG в Shopify: источник, склад (фильтр EU/US),
 * пол (переключатель Women/Men/Unisex) и дизайнер.
 */
export function buildTags(
  row: Pick<PushRow, "brand" | "warehouse" | "gender">
): string[] {
  const tags = ["bg", warehouseTag(row.warehouse), ...genderTags(row.gender)];
  if (row.brand) tags.push(`designer:${row.brand.toLowerCase()}`);
  return tags;
}

export interface ShopifyIds {
  productId: string;
  variantId: string;
  inventoryItemId: string;
}

/** Первая (основная) локация магазина — нужна для установки остатков. */
export async function getPrimaryLocationId(client: ShopifyClient): Promise<string> {
  const data = await client.graphql<{ locations: { nodes: { id: string }[] } }>(
    `{ locations(first: 1) { nodes { id } } }`
  );
  const id = data.locations.nodes[0]?.id;
  if (!id) throw new Error("Shopify: у магазина нет локаций");
  return id;
}

const CREATE_PRODUCT = /* GraphQL */ `
  mutation PushCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        variants(first: 1) { nodes { id inventoryItem { id } } }
      }
      userErrors { field message }
    }
  }
`;

const UPDATE_PRODUCT = /* GraphQL */ `
  mutation PushUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANT = /* GraphQL */ `
  mutation PushVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

const SET_QUANTITY = /* GraphQL */ `
  mutation PushQty($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

async function setVariant(
  client: ShopifyClient,
  productId: string,
  variantId: string,
  row: PushRow
): Promise<void> {
  const data = await client.graphql<{
    productVariantsBulkUpdate: { userErrors: UserError[] };
  }>(UPDATE_VARIANT, {
    productId,
    variants: [
      {
        id: variantId,
        price: row.our_price.toFixed(2),
        inventoryItem: { sku: row.sku, tracked: true },
      },
    ],
  });
  throwOnErrors("variant update", data.productVariantsBulkUpdate.userErrors);
}

async function setStock(
  client: ShopifyClient,
  inventoryItemId: string,
  locationId: string,
  quantity: number
): Promise<void> {
  const data = await client.graphql<{
    inventorySetQuantities: { userErrors: UserError[] };
  }>(SET_QUANTITY, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId, locationId, quantity }],
    },
  });
  throwOnErrors("inventory set", data.inventorySetQuantities.userErrors);
}

/** Создание нового товара BG в Shopify (статус ACTIVE — канал 90% работает без ручной публикации). */
async function createProduct(
  client: ShopifyClient,
  row: PushRow,
  locationId: string
): Promise<ShopifyIds> {
  const data = await client.graphql<{
    productCreate: {
      product: {
        id: string;
        variants: { nodes: { id: string; inventoryItem: { id: string } }[] };
      } | null;
      userErrors: UserError[];
    };
  }>(CREATE_PRODUCT, {
    product: {
      title: row.name,
      descriptionHtml: row.description ? `<p>${escapeHtml(row.description)}</p>` : undefined,
      vendor: row.brand ?? "Italian Edit",
      tags: buildTags(row),
      status: "ACTIVE",
    },
    media: row.images.slice(0, MAX_IMAGES).map((url) => ({
      originalSource: url,
      mediaContentType: "IMAGE",
    })),
  });
  throwOnErrors("productCreate", data.productCreate.userErrors);
  const product = data.productCreate.product;
  const variant = product?.variants.nodes[0];
  if (!product || !variant) throw new Error("Shopify productCreate: нет варианта в ответе");

  const ids: ShopifyIds = {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
  };
  await setVariant(client, ids.productId, ids.variantId, row);
  await setStock(client, ids.inventoryItemId, locationId, row.stock);
  return ids;
}

/** Обновление существующего товара: статус/теги, цена, остаток. */
async function updateProduct(
  client: ShopifyClient,
  row: PushRow,
  ids: ShopifyIds,
  locationId: string
): Promise<void> {
  const data = await client.graphql<{
    productUpdate: { userErrors: UserError[] };
  }>(UPDATE_PRODUCT, {
    product: {
      id: ids.productId,
      status: row.status === "active" ? "ACTIVE" : "ARCHIVED",
      tags: buildTags(row),
    },
  });
  throwOnErrors("productUpdate", data.productUpdate.userErrors);
  await setVariant(client, ids.productId, ids.variantId, row);
  await setStock(client, ids.inventoryItemId, locationId, row.stock);
}

/** Заливка одного товара: создать или обновить. Возвращает shopify-идентификаторы. */
export async function pushProduct(
  client: ShopifyClient,
  row: PushRow,
  locationId: string
): Promise<ShopifyIds> {
  if (row.shopify_product_id && row.shopify_variant_map) {
    const ids: ShopifyIds = {
      productId: row.shopify_product_id,
      variantId: row.shopify_variant_map.variantId,
      inventoryItemId: row.shopify_variant_map.inventoryItemId,
    };
    await updateProduct(client, row, ids, locationId);
    return ids;
  }
  return createProduct(client, row, locationId);
}

export interface PushStats {
  pushed: number;
  failed: number;
  errors: string[];
}

/**
 * Обрабатывает очередь заливки (батч за один запуск — бережём rate limit Shopify).
 * Ошибка одного товара не останавливает остальные.
 */
export async function pushPendingProducts(
  pool: Pool,
  client: ShopifyClient,
  opts: { batch?: number } = {}
): Promise<PushStats> {
  const rows = await productsToPush(pool, opts.batch ?? 25);
  const stats: PushStats = { pushed: 0, failed: 0, errors: [] };
  if (rows.length === 0) return stats;

  const locationId = await getPrimaryLocationId(client);

  for (const row of rows) {
    try {
      const ids = await pushProduct(client, row, locationId);
      await markPushed(pool, row.bg_id, ids);
      stats.pushed++;
    } catch (err) {
      await markPushError(pool, row.bg_id, String(err));
      stats.failed++;
      stats.errors.push(`${row.sku}: ${String(err)}`);
    }
  }

  await logSync(
    pool,
    "shopify-push",
    stats.pushed,
    stats.failed === 0,
    stats.errors.slice(0, 3).join(" | ") || undefined
  );
  return stats;
}
