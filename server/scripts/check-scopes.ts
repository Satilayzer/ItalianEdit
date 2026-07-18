/** Показывает, какие access scopes реально есть у текущей установки приложения. */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";

const config = loadConfig();
if (!config.shopify) throw new Error("Shopify не настроен в .env");

const client = new ShopifyClient(config.shopify);
const data = await client.graphql<{
  currentAppInstallation: { accessScopes: { handle: string }[] };
}>(`{ currentAppInstallation { accessScopes { handle } } }`);

const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
console.log("Scopes установки:", scopes.length > 0 ? scopes.join(", ") : "(пусто)");
