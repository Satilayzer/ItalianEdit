import type { Pool } from "pg";
import type { ProductRow } from "../bg/mapProduct";

/**
 * Вставляет/обновляет товар. Ручную цену не трогаем: если manual_price = TRUE,
 * our_price оставляем как есть (менеджер поставил вручную в Shopify).
 */
export async function upsertProduct(pool: Pool, row: ProductRow): Promise<void> {
  await pool.query(
    `INSERT INTO products
       (bg_id, sku, name, brand, description, images, wholesale_price, sale_price,
        our_price, stock, warehouse, bg_updated_at, status, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active', now())
     ON CONFLICT (bg_id) DO UPDATE SET
       sku = EXCLUDED.sku,
       name = EXCLUDED.name,
       brand = EXCLUDED.brand,
       description = EXCLUDED.description,
       images = EXCLUDED.images,
       wholesale_price = EXCLUDED.wholesale_price,
       sale_price = EXCLUDED.sale_price,
       our_price = CASE WHEN products.manual_price
                        THEN products.our_price ELSE EXCLUDED.our_price END,
       stock = EXCLUDED.stock,
       warehouse = EXCLUDED.warehouse,
       bg_updated_at = EXCLUDED.bg_updated_at,
       status = 'active',
       synced_at = now()`,
    [
      row.bg_id,
      row.sku,
      row.name,
      row.brand,
      row.description,
      JSON.stringify(row.images ?? []),
      row.wholesale_price,
      row.sale_price,
      row.our_price,
      row.stock,
      row.warehouse,
      row.bg_updated_at,
    ]
  );
}

/** Пакетный upsert в одной транзакции. */
export async function upsertProducts(pool: Pool, rows: ProductRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await upsertProduct(client as unknown as Pool, row);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Обновить только остаток (для быстрой синхронизации по check-status). */
export async function updateStock(
  pool: Pool,
  bgId: number,
  stock: number
): Promise<void> {
  await pool.query(
    `UPDATE products SET stock = $2, synced_at = now() WHERE bg_id = $1`,
    [bgId, stock]
  );
}

/** id всех активных товаров — источник для батчей check-status. */
export async function activeProductIds(pool: Pool): Promise<number[]> {
  const { rows } = await pool.query<{ bg_id: string }>(
    `SELECT bg_id FROM products WHERE status = 'active'`
  );
  return rows.map((r) => Number(r.bg_id));
}

/** Товар, ожидающий заливки/обновления в Shopify. */
export interface PushRow {
  bg_id: number;
  sku: string;
  name: string;
  brand: string | null;
  description: string | null;
  images: string[];
  our_price: number;
  stock: number;
  warehouse: "eu" | "us" | null;
  status: string;
  shopify_product_id: string | null;
  shopify_variant_map: { variantId: string; inventoryItemId: string } | null;
}

/**
 * Очередь на заливку в Shopify: изменившиеся с последнего пуша товары.
 * Никогда не заливавшиеся неактивные — пропускаем (нечего архивировать).
 */
export async function productsToPush(pool: Pool, limit: number): Promise<PushRow[]> {
  const { rows } = await pool.query(
    `SELECT bg_id, sku, name, brand, description, images, our_price, stock,
            warehouse, status, shopify_product_id, shopify_variant_map
     FROM products
     WHERE (shopify_synced_at IS NULL OR shopify_synced_at < synced_at)
       AND NOT (shopify_product_id IS NULL AND status <> 'active')
       AND our_price IS NOT NULL
     ORDER BY synced_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    ...r,
    bg_id: Number(r.bg_id),
    our_price: Number(r.our_price),
    images: r.images ?? [],
  }));
}

/** Успешная заливка: сохраняем shopify-идентификаторы и отметку времени. */
export async function markPushed(
  pool: Pool,
  bgId: number,
  ids: { productId: string; variantId: string; inventoryItemId: string }
): Promise<void> {
  await pool.query(
    `UPDATE products
     SET shopify_product_id = $2,
         shopify_variant_map = $3,
         shopify_synced_at = now(),
         push_error = NULL
     WHERE bg_id = $1`,
    [
      bgId,
      ids.productId,
      JSON.stringify({ variantId: ids.variantId, inventoryItemId: ids.inventoryItemId }),
    ]
  );
}

/**
 * Ошибка заливки: запоминаем текст и ставим отметку, чтобы не зациклить очередь —
 * повторная попытка случится при следующем изменении товара в синке.
 */
export async function markPushError(
  pool: Pool,
  bgId: number,
  error: string
): Promise<void> {
  await pool.query(
    `UPDATE products SET push_error = $2, shopify_synced_at = now() WHERE bg_id = $1`,
    [bgId, error.slice(0, 1000)]
  );
}

/** Пометить товары как снятые (исчезли из выгрузки BG). */
export async function markInactive(pool: Pool, bgIds: number[]): Promise<void> {
  if (bgIds.length === 0) return;
  await pool.query(
    `UPDATE products SET status = 'inactive', stock = 0, synced_at = now()
     WHERE bg_id = ANY($1::bigint[])`,
    [bgIds]
  );
}
