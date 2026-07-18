import "dotenv/config";

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
  };
}
