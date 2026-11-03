/**
 * Проверка токена TheDoubleF перед автоматическим трекингом: какие права у
 * токена и видит ли он отправки (трек-номера) наших заказов у поставщика.
 * Только чтение — ни у нас, ни у поставщика ничего не меняется.
 *
 *   npx tsx scripts/tdf-tracking-probe.ts            # все наши заказы с tdf-order-sent
 *   npx tsx scripts/tdf-tracking-probe.ts 1001 1002  # конкретные заказы
 *
 * Токен — в командной строке, как для tdf-test-order.ts (PowerShell):
 *   $env:TDF_ORDERS_TOKEN="…"; npx tsx scripts/tdf-tracking-probe.ts
 */
import "dotenv/config";
import { loadConfig } from "../src/config";
import { ShopifyClient } from "../src/shopify/client";
import { TDF_API_VERSION } from "../src/tdf/sync";
import { TAG_SENT } from "../src/tdf/orders";
import { TDF_NAMESPACE } from "../src/tdf/productInput";

const token = process.env.TDF_ORDERS_TOKEN;
if (!token) throw new Error("TDF_ORDERS_TOKEN не задан");
// Иначе loadConfig потребует весь набор TDF_ORDERS_* — для пробы он не нужен.
delete process.env.TDF_ORDERS_TOKEN;

const config = loadConfig();
if (!config.shopify) throw new Error("Shopify не настроен в .env");
const ours = new ShopifyClient(config.shopify);
const tdf = new ShopifyClient({
  shop: process.env.TDF_ORDERS_SHOP || "vip-tdf.myshopify.com",
  adminToken: token,
  apiVersion: TDF_API_VERSION,
});

// 1. Права токена.
try {
  const data = await tdf.graphql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(
    `{ currentAppInstallation { accessScopes { handle } } }`
  );
  console.log("Права токена TDF:", data.currentAppInstallation.accessScopes.map((s) => s.handle).join(", ") || "(пусто)");
} catch (err) {
  console.log("Права токена TDF прочитать не удалось:", String(err));
}

// 2. Наши заказы, переданные поставщику.
const names = process.argv.slice(2).map((n) => `name:#${n.replace(/^#/, "")}`);
const search = names.length > 0 ? names.join(" OR ") : `tag:${TAG_SENT}`;
const list = await ours.graphql<{
  orders: { nodes: { name: string; displayFulfillmentStatus: string; tdf: { value: string } | null }[] };
}>(
  `query ($q: String!) {
    orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { name displayFulfillmentStatus tdf: metafield(namespace: "${TDF_NAMESPACE}", key: "order") { value } }
    }
  }`,
  { q: search }
);

// 3. Заказ у поставщика: статус отправки и трек.
const TDF_ORDER = /* GraphQL */ `
  query ($id: ID!) {
    draftOrder(id: $id) {
      name
      order {
        name
        displayFulfillmentStatus
        fulfillments {
          createdAt
          displayStatus
          trackingInfo { company number url }
        }
      }
    }
  }
`;

type TdfOrder = {
  draftOrder: {
    name: string;
    order: {
      name: string;
      displayFulfillmentStatus: string;
      fulfillments: { createdAt: string; displayStatus: string | null; trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
    } | null;
  } | null;
};

if (list.orders.nodes.length === 0) console.log(`Заказов по запросу «${search}» нет.`);
for (const o of list.orders.nodes) {
  const record = o.tdf ? (JSON.parse(o.tdf.value) as { draftOrderId?: string }) : null;
  console.log(`\n${o.name} (у нас: ${o.displayFulfillmentStatus})`);
  if (!record?.draftOrderId) {
    console.log("  нет tdf.order.draftOrderId — у поставщика не оформлялся");
    continue;
  }
  try {
    const { draftOrder } = await tdf.graphql<TdfOrder>(TDF_ORDER, { id: record.draftOrderId });
    if (!draftOrder) {
      console.log(`  черновик ${record.draftOrderId} не найден`);
      continue;
    }
    if (!draftOrder.order) {
      console.log(`  черновик ${draftOrder.name} ещё не стал заказом`);
      continue;
    }
    const t = draftOrder.order;
    console.log(`  у TDF: ${t.name}, ${t.displayFulfillmentStatus}, отправок: ${t.fulfillments.length}`);
    for (const f of t.fulfillments) {
      const tracks = f.trackingInfo.map((i) => `${i.company ?? "?"} ${i.number ?? "—"} ${i.url ?? ""}`.trim());
      console.log(`  • ${f.createdAt} ${f.displayStatus ?? ""}: ${tracks.join("; ") || "без трека"}`);
    }
  } catch (err) {
    console.log("  ошибка чтения у поставщика:", String(err));
  }
}
