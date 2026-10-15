import "dotenv/config";
import type { TdfOrderSettings } from "./tdf/orders";

export interface BgConfig {
  baseUrl: string;
  email: string;
  password: string;
  storeId: number;
}

export interface ShopifyEnvConfig {
  shop: string;
  adminToken?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Как импортируются 90% товаров BrandsGateway:
 *  - "app" — базовый тариф BG (GROW): импорт/остатки/заказы делает приложение BG
 *    прямо в Shopify. Наш сервер только дотегирует товары для фильтров витрины.
 *  - "api" — тариф REST API/CSV: импорт/синк/заказы делает наш сервер через API BG.
 */
export type ImportMode = "app" | "api";

/** Заказы TheDoubleF по API: доступ к магазину поставщика + реквизиты нашей B2B-компании. */
export interface TdfOrdersConfig extends TdfOrderSettings {
  shop: string;
  token: string;
}

export interface Config {
  botToken: string;
  serperApiKey?: string;
  defaultCurrency: string;
  port: number;
  databaseUrl?: string;
  bg?: BgConfig;
  shopify?: ShopifyEnvConfig;
  shopifyWebhookSecret?: string;
  /** chat_id телеграм-группы для алертов (узнать: /chatid у бота). */
  alertChatId?: string;
  /** Правило «отдавать 1»: максимум остатка, публикуемого в Shopify. */
  inventoryCap: number;
  /** Сколько товаров заливать в Shopify за один проход (раз в минуту). */
  pushBatch: number;
  importMode: ImportMode;
  /**
   * Запускать ли long polling Телеграма. Канал ручного завода товаров может
   * стоять на паузе — тогда поллинг лишний, а на хостинге ещё и вреден:
   * два инстанса с одним токеном дают 409 Conflict (перекрытие при деплое).
   * Токен обязателен в любом случае — он часть контракта конфига.
   */
  botEnabled: boolean;
  /** Не задан — заказы TheDoubleF оформляются вручную. */
  tdfOrders?: TdfOrdersConfig;
}

export function loadConfig(): Config {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error(
      "BOT_TOKEN не задан. Скопируйте .env.example в .env и вставьте токен от @BotFather."
    );
  }
  const bgEmail = process.env.BG_EMAIL;
  const bgPassword = process.env.BG_PASSWORD;
  const bgStoreId = Number(process.env.BG_STORE_ID);
  const bg =
    bgEmail && bgPassword && bgStoreId
      ? {
          baseUrl: process.env.BG_BASE_URL || "https://nova.shopwoo.com",
          email: bgEmail,
          password: bgPassword,
          storeId: bgStoreId,
        }
      : undefined;

  const shopifyShop = process.env.SHOPIFY_SHOP;
  const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN || undefined;
  const shopifyClientId = process.env.SHOPIFY_CLIENT_ID || undefined;
  const shopifyClientSecret = process.env.SHOPIFY_CLIENT_SECRET || undefined;
  const shopify =
    shopifyShop && (shopifyToken || (shopifyClientId && shopifyClientSecret))
      ? {
          shop: shopifyShop,
          adminToken: shopifyToken,
          clientId: shopifyClientId,
          clientSecret: shopifyClientSecret,
        }
      : undefined;

  return {
    tdfOrders: loadTdfOrders(),
    botToken,
    serperApiKey: process.env.SERPER_API_KEY || undefined,
    defaultCurrency: process.env.DEFAULT_CURRENCY || "EUR",
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL || undefined,
    bg,
    shopify,
    shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || undefined,
    alertChatId: process.env.ALERT_CHAT_ID || undefined,
    inventoryCap: Number(process.env.INVENTORY_CAP ?? 1),
    pushBatch: Number(process.env.SHOPIFY_PUSH_BATCH ?? 25),
    importMode: process.env.IMPORT_MODE === "api" ? "api" : "app",
    botEnabled: process.env.BOT_ENABLED !== "false",
  };
}

/**
 * Включается, когда поставщик выдал токен и ID компании/локации/контакта.
 * Режим по умолчанию — dry-run: только расчёт доставки, у поставщика ничего
 * не создаётся. Боевой режим (TDF_ORDERS_MODE=live) — осознанное решение.
 */
function loadTdfOrders(): TdfOrdersConfig | undefined {
  const token = process.env.TDF_ORDERS_TOKEN;
  const companyId = process.env.TDF_COMPANY_ID;
  const companyLocationId = process.env.TDF_COMPANY_LOCATION_ID;
  const companyContactId = process.env.TDF_COMPANY_CONTACT_ID;
  if (!token || !companyId || !companyLocationId || !companyContactId) return undefined;
  const since = process.env.TDF_ORDERS_SINCE;
  if (!since || Number.isNaN(Date.parse(since))) {
    // Без границы первый проход подхватил бы заказы, уже оформленные вручную.
    throw new Error("TDF_ORDERS_SINCE не задан или не дата (напр. 2026-10-15T00:00:00Z)");
  }
  const gid = (kind: string, v: string) => (v.startsWith("gid://") ? v : `gid://shopify/${kind}/${v}`);
  return {
    shop: process.env.TDF_ORDERS_SHOP || "vip-tdf.myshopify.com",
    token,
    mode: process.env.TDF_ORDERS_MODE === "live" ? "live" : "dry-run",
    companyId: gid("Company", companyId),
    companyLocationId: gid("CompanyLocation", companyLocationId),
    companyContactId: gid("CompanyContact", companyContactId),
    paymentMethod: process.env.TDF_PAYMENT_METHOD === "Bank Deposit" ? "Bank Deposit" : "Bank Transfer",
    since,
    fallbackPhone: process.env.TDF_FALLBACK_PHONE || undefined,
    email: process.env.TDF_ORDER_EMAIL || undefined,
  };
}
