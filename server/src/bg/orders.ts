import type { Pool } from "pg";
import type { BgClient } from "./client";
import type { BgOrderRequest, BgShipping } from "./types";
import type { ShopifyOrderWebhook } from "../shopify/webhooks";
import {
  orderExists,
  createPendingOrder,
  markOrderSent,
  markOrderError,
  ordersAwaitingTracking,
  saveTracking,
  bgIdBySku,
} from "../db/orders";

export type Alert = (text: string) => Promise<void>;

export interface BuildResult {
  request?: BgOrderRequest;
  /** Позиции, которые не удалось сопоставить с каталогом BG (нет/неизвестный SKU). */
  unmatched: string[];
  /** Причина, по которой заказ нельзя собрать (адрес и т.п.). */
  problem?: string;
}

/**
 * Собирает запрос к BG из вебхука Shopify. Чистая функция:
 * resolveSku инъектируется (в проде — поиск по нашей БД).
 */
export async function buildBgOrder(
  order: ShopifyOrderWebhook,
  resolveSku: (sku: string) => Promise<number | undefined>
): Promise<BuildResult> {
  const addr = order.shipping_address;
  if (!addr?.address1 || !addr.city || !addr.zip || !addr.country_code) {
    return { unmatched: [], problem: "нет полного адреса доставки" };
  }

  const lineItems: BgOrderRequest["line_items"] = [];
  const unmatched: string[] = [];

  for (const item of order.line_items) {
    const label = item.sku || item.title || "позиция без SKU";
    if (!item.sku) {
      unmatched.push(label);
      continue;
    }
    const bgId = await resolveSku(item.sku);
    if (bgId === undefined) {
      unmatched.push(label);
      continue;
    }
    lineItems.push({ product_id: bgId, quantity: item.quantity });
  }

  if (unmatched.length > 0 || lineItems.length === 0) {
    return { unmatched };
  }

  const shipping: BgShipping = {
    first_name: addr.first_name ?? "-",
    last_name: addr.last_name ?? "-",
    company: addr.company,
    address_1: addr.address1,
    address_2: addr.address2,
    city: addr.city,
    // BG требует state; у большинства стран ЕС его нет — шлём код провинции или город.
    state: addr.province_code || addr.province || addr.city,
    postcode: addr.zip,
    country: addr.country_code,
    phone: addr.phone,
    email: order.email,
  };

  return {
    request: {
      order_id: order.order_number,
      line_items: lineItems,
      shipping: [shipping],
    },
    unmatched: [],
  };
}

/**
 * Полный цикл обработки заказа из вебхука: идемпотентность → маппинг → POST в BG.
 * Несопоставленные позиции не передаём автоматически — алерт менеджерам на ручную обработку.
 */
export async function forwardShopifyOrder(
  pool: Pool,
  client: BgClient,
  order: ShopifyOrderWebhook,
  alert: Alert
): Promise<void> {
  const orderId = String(order.id);

  if (await orderExists(pool, orderId)) {
    return; // повторная доставка вебхука — уже обработан
  }
  await createPendingOrder(pool, orderId);

  const built = await buildBgOrder(order, (sku) => bgIdBySku(pool, sku));

  if (built.problem || !built.request) {
    const reason =
      built.problem ??
      `не сопоставлены с BrandsGateway: ${built.unmatched.join(", ")}`;
    await markOrderError(pool, orderId, reason);
    await alert(
      `⚠️ Заказ №${order.order_number}: ${reason}.\nОформите в BrandsGateway вручную.`
    );
    return;
  }

  try {
    const res = await client.createOrder(built.request);
    await markOrderSent(pool, orderId, res.id);
    await alert(
      `✅ Заказ №${order.order_number} передан в BrandsGateway (id ${res.id}).`
    );
  } catch (err) {
    await markOrderError(pool, orderId, String(err));
    await alert(
      `🔴 Заказ №${order.order_number} НЕ передан в BrandsGateway: ${String(err)}\nНужна ручная обработка!`
    );
  }
}

/** Поллинг трек-номеров для переданных заказов. Возвращает число заказов с новым треком. */
export async function pollTracking(
  pool: Pool,
  client: BgClient,
  alert: Alert
): Promise<number> {
  const awaiting = await ordersAwaitingTracking(pool);
  let updated = 0;
  for (const o of awaiting) {
    const bgOrder = await client.getOrder(o.bg_order_id);
    if (bgOrder.tracking_info) {
      await saveTracking(pool, o.shopify_order_id, bgOrder.tracking_info);
      await alert(
        `📦 Заказ (Shopify id ${o.shopify_order_id}) отправлен BrandsGateway, трекинг: ` +
          `${JSON.stringify(bgOrder.tracking_info)}`
      );
      updated++;
    }
  }
  return updated;
}
