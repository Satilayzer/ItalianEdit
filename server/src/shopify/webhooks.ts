import { createHmac, timingSafeEqual } from "node:crypto";

/** Подмножество payload вебхука Shopify orders/paid, которое нам нужно. */
export interface ShopifyOrderWebhook {
  id: number;
  order_number: number;
  email?: string;
  line_items: {
    sku?: string;
    quantity: number;
    title?: string;
  }[];
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    country_code?: string;
    phone?: string;
  };
}

/** Проверка подписи вебхука Shopify (X-Shopify-Hmac-Sha256, base64 HMAC-SHA256 сырого тела). */
export function verifyShopifyHmac(
  rawBody: Buffer,
  hmacHeader: string | undefined,
  secret: string
): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  return digest.length === received.length && timingSafeEqual(digest, received);
}
