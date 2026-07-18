import type { Pool } from "pg";

export interface OrderRow {
  shopify_order_id: string;
  bg_order_id: number | null;
  status: string; // pending | sent | shipped | error
  tracking: unknown;
  error: string | null;
}

/** Заказ уже есть в БД? (идемпотентность вебхука — Shopify может прислать повторно). */
export async function orderExists(pool: Pool, shopifyOrderId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM orders WHERE shopify_order_id = $1`,
    [shopifyOrderId]
  );
  return rows.length > 0;
}

export async function createPendingOrder(
  pool: Pool,
  shopifyOrderId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO orders (shopify_order_id, status) VALUES ($1, 'pending')
     ON CONFLICT (shopify_order_id) DO NOTHING`,
    [shopifyOrderId]
  );
}

export async function markOrderSent(
  pool: Pool,
  shopifyOrderId: string,
  bgOrderId: number
): Promise<void> {
  await pool.query(
    `UPDATE orders SET bg_order_id = $2, status = 'sent', error = NULL, updated_at = now()
     WHERE shopify_order_id = $1`,
    [shopifyOrderId, bgOrderId]
  );
}

export async function markOrderError(
  pool: Pool,
  shopifyOrderId: string,
  error: string
): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = 'error', error = $2, updated_at = now()
     WHERE shopify_order_id = $1`,
    [shopifyOrderId, error]
  );
}

/** Заказы, переданные в BG, но ещё без трек-номера. */
export async function ordersAwaitingTracking(
  pool: Pool
): Promise<{ shopify_order_id: string; bg_order_id: number }[]> {
  const { rows } = await pool.query(
    `SELECT shopify_order_id, bg_order_id FROM orders
     WHERE status = 'sent' AND bg_order_id IS NOT NULL`
  );
  return rows.map((r) => ({
    shopify_order_id: r.shopify_order_id,
    bg_order_id: Number(r.bg_order_id),
  }));
}

export async function saveTracking(
  pool: Pool,
  shopifyOrderId: string,
  tracking: unknown
): Promise<void> {
  await pool.query(
    `UPDATE orders SET tracking = $2, status = 'shipped', updated_at = now()
     WHERE shopify_order_id = $1`,
    [shopifyOrderId, JSON.stringify(tracking)]
  );
}

/** bg_id товара по SKU (для маппинга позиций заказа). */
export async function bgIdBySku(pool: Pool, sku: string): Promise<number | undefined> {
  const { rows } = await pool.query(
    `SELECT bg_id FROM products WHERE sku = $1 AND status = 'active'`,
    [sku]
  );
  return rows.length > 0 ? Number(rows[0].bg_id) : undefined;
}
