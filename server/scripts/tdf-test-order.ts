/**
 * Тестовый заказ у TheDoubleF — по их правилам для партнёров: имя и фамилия
 * TEST, товар дешевле 50 €. После боевого создания поставщик просит письмо
 * (vip@thedoublef.com) — скрипт печатает готовый текст.
 *
 *   npx tsx scripts/tdf-test-order.ts                 # только расчёт доставки
 *   npx tsx scripts/tdf-test-order.ts --live          # создать и завершить заказ
 *   npx tsx scripts/tdf-test-order.ts --variant <gid> # свой вариант поставщика
 *
 * Нужны TDF_ORDERS_TOKEN, TDF_COMPANY_*, TDF_TEST_ADDRESS (см. .env.example).
 * Токен лучше передавать в командной строке, а не держать в локальном .env:
 * с ним локальный `npm run dev` тоже начнёт разбирать боевые заказы.
 */
import "dotenv/config";
import { ShopifyClient } from "../src/shopify/client";
import { fetchFeed } from "../src/tdf/feed";
import { TDF_API_VERSION } from "../src/tdf/sync";
import {
  DRAFT_CALCULATE,
  DRAFT_CREATE,
  DRAFT_COMPLETE,
  cheapestRate,
  userErrorText,
  type ShippingRate,
  type UserError,
} from "../src/tdf/orders";

const MAX_EUR = 50;
const args = process.argv.slice(2);
const live = args.includes("--live");
const variantArg = args[args.indexOf("--variant") + 1];

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} не задан`);
  return v;
}

const tdf = new ShopifyClient({
  shop: process.env.TDF_ORDERS_SHOP || "vip-tdf.myshopify.com",
  adminToken: env("TDF_ORDERS_TOKEN"),
  apiVersion: TDF_API_VERSION,
});
const gid = (kind: string, v: string) => (v.startsWith("gid://") ? v : `gid://shopify/${kind}/${v}`);
const address = {
  ...JSON.parse(env("TDF_TEST_ADDRESS")),
  firstName: "TEST",
  lastName: "TEST",
};
if (!address.phone) throw new Error("В TDF_TEST_ADDRESS нужен phone — поставщик требует");

// Вариант: из аргумента или самый дешёвый в наличии из фида.
let variantId = args.includes("--variant") ? variantArg : "";
let label = variantId;
if (!variantId) {
  const price = (p: { price: number | null; salePrice: number | null }) =>
    (p.salePrice && p.salePrice > 0 ? p.salePrice : p.price) ?? Infinity;
  const pick = (await fetchFeed())
    .filter((p) => price(p) < MAX_EUR)
    .flatMap((p) => p.variants.filter((v) => v.quantity > 0 && v.supplierVariantId).map((v) => ({ p, v })))
    .sort((a, b) => price(a.p) - price(b.p))[0];
  if (!pick) throw new Error(`В фиде нет товара дешевле ${MAX_EUR} € в наличии`);
  variantId = `gid://shopify/ProductVariant/${pick.v.supplierVariantId}`;
  label = `${pick.p.brand} — ${pick.p.title}, ${pick.v.size} (${price(pick.p)} € без НДС)`;
}

const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, "");
const input = {
  paymentTerms: { paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/1" },
  lineItems: [{ variantId, quantity: 1 }],
  poNumber: `TEST-${stamp}`,
  purchasingEntity: {
    purchasingCompany: {
      companyId: gid("Company", env("TDF_COMPANY_ID")),
      companyLocationId: gid("CompanyLocation", env("TDF_COMPANY_LOCATION_ID")),
      companyContactId: gid("CompanyContact", env("TDF_COMPANY_CONTACT_ID")),
    },
  },
  shippingAddress: address,
  billingAddress: address,
  ...(process.env.TDF_ORDER_EMAIL ? { email: process.env.TDF_ORDER_EMAIL } : {}),
  note: "TEST ORDER — Italian Edit API integration test",
  customAttributes: [
    { key: "payment_method", value: process.env.TDF_PAYMENT_METHOD === "Bank Deposit" ? "Bank Deposit" : "Bank Transfer" },
  ],
  tags: ["GRAPHQL"],
};

console.log(`Товар: ${label}\nВариант поставщика: ${variantId}\nPO: ${input.poNumber}`);

const calc = await tdf.graphql<{
  draftOrderCalculate: { calculatedDraftOrder: { availableShippingRates: ShippingRate[] } | null; userErrors: UserError[] };
}>(DRAFT_CALCULATE, { input });
if (calc.draftOrderCalculate.userErrors.length > 0) {
  throw new Error(`Расчёт: ${userErrorText(calc.draftOrderCalculate.userErrors)}`);
}
const rates = calc.draftOrderCalculate.calculatedDraftOrder?.availableShippingRates ?? [];
for (const r of rates) console.log(`Тариф: ${r.title} — ${r.price.amount} ${r.price.currencyCode}`);
const rate = cheapestRate(rates);
if (!rate) throw new Error(`Нет тарифа доставки в ${address.countryCode}`);

if (!live) {
  console.log("\nРасчёт прошёл. Боевой тестовый заказ: добавьте --live.");
  process.exit(0);
}

const created = await tdf.graphql<{
  draftOrderCreate: { draftOrder: { id: string; name: string; totalPrice: string } | null; userErrors: UserError[] };
}>(DRAFT_CREATE, { input: { ...input, shippingLine: { shippingRateHandle: rate.handle } } });
const draft = created.draftOrderCreate.draftOrder;
if (!draft) throw new Error(`Черновик: ${userErrorText(created.draftOrderCreate.userErrors)}`);
console.log(`Черновик ${draft.name} (${draft.id}), ${draft.totalPrice} EUR`);

const done = await tdf.graphql<{
  draftOrderComplete: { draftOrder: { id: string; status: string } | null; userErrors: UserError[] };
}>(DRAFT_COMPLETE, { id: draft.id });
const status = done.draftOrderComplete.draftOrder?.status;
console.log(`Статус: ${status}${done.draftOrderComplete.userErrors.length ? ` (${userErrorText(done.draftOrderComplete.userErrors)})` : ""}`);

console.log(`
── Письмо для vip@thedoublef.com ──
Subject: Italian Edit — API test order ${input.poNumber}

Hello,

we have just placed a test order through the API:
- PO number: ${input.poNumber}
- Draft order: ${draft.name} (${draft.id}), status ${status}
- Item: ${label}
- Shipping: ${rate.title}, ${rate.price.amount} ${rate.price.currencyCode}
- Total: ${draft.totalPrice} EUR
- Name on the order: TEST TEST

Please treat it as a test and let us know if everything looks right on your side.

Best regards,
Italian Edit
`);
