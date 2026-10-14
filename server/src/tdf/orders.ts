/**
 * Заказы TheDoubleF по API: оплаченный заказ нашего магазина → B2B-заказ
 * у поставщика (его магазин vip-tdf.myshopify.com, Admin GraphQL).
 *
 * Поток по документации поставщика (TDF - Shopify documentation 1.5):
 *  1. draftOrderCalculate — доступные тарифы доставки на адрес покупателя;
 *  2. draftOrderCreate — черновик от лица нашей компании (purchasingEntity),
 *     с выбранным тарифом, оплатой «Bank Transfer» / «Bank Deposit» и poNumber;
 *  3. draftOrderComplete — черновик становится заказом (оплата — переводом).
 *
 * Вебхук не используем: опрос раз в 5 минут переживает простой сервера, а
 * состояние живёт в самом заказе Shopify — метаполе `tdf.claim` (заказ взят в
 * работу), `tdf.order` (что создано у поставщика) и теги для менеджеров:
 *   tdf-order-sent    — заказ у поставщика оформлен;
 *   tdf-order-dryrun  — пробный режим: только расчёт, у поставщика ничего нет;
 *   tdf-order-error   — не прошло, оформить вручную (подробности в алерте);
 *   tdf-order-retry   — ставит менеджер, чтобы прогнать заказ ещё раз.
 *
 * Заказ, где TheDoubleF только часть позиций, передаём частично: остальные
 * позиции ведут свои каналы (приложение BG, ручной закуп).
 */

import { randomUUID } from "node:crypto";
import type { ShopifyClient } from "../shopify/client";
import { TDF_NAMESPACE, SOURCE_TAG } from "./productInput";
import { fetchFeed, DEFAULT_FEED_URL } from "./feed";

export type Alert = (text: string) => Promise<void>;

/** dry-run — только расчёт доставки и суммы; live — заказ у поставщика по-настоящему. */
export type TdfOrderMode = "dry-run" | "live";

export interface TdfOrderSettings {
  mode: TdfOrderMode;
  companyId: string;
  companyLocationId: string;
  companyContactId: string;
  paymentMethod: "Bank Transfer" | "Bank Deposit";
  /** Заказы, созданные раньше, не трогаем: их оформляли вручную. ISO-дата. */
  since: string;
  /** Телефон на случай, если покупатель его не оставил (поставщик требует). */
  fallbackPhone?: string;
}

export const TAG_SENT = "tdf-order-sent";
export const TAG_DRY_RUN = "tdf-order-dryrun";
export const TAG_ERROR = "tdf-order-error";
export const TAG_RETRY = "tdf-order-retry";

/** «Due on receipt» — единственный шаблон в документации поставщика. */
const PAYMENT_TERMS_TEMPLATE = "gid://shopify/PaymentTermsTemplate/1";
/** Окно опроса: старше заказы не смотрим, даже если since раньше. */
const LOOKBACK_DAYS = 30;
/** Пауза между записью claim и проверкой — разводит два инстанса при деплое. */
const CLAIM_SETTLE_MS = 3_000;

// ── Наш заказ ─────────────────────────────────────────────────────────────

export interface OurAddress {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  countryCodeV2: string | null;
  zip: string | null;
  phone: string | null;
}

export interface OurLineItem {
  name: string;
  sku: string | null;
  /** С учётом удалённых/возвращённых позиций. */
  currentQuantity: number;
  variant: {
    id: string;
    supplier: { value: string } | null;
    product: { tags: string[] } | null;
  } | null;
}

export interface OurOrder {
  id: string;
  name: string;
  phone: string | null;
  tags: string[];
  cancelledAt: string | null;
  shippingAddress: OurAddress | null;
  billingAddress: OurAddress | null;
  claim: { value: string } | null;
  lineItems: { nodes: OurLineItem[] };
}

const ORDER_FIELDS = /* GraphQL */ `
  id
  name
  phone
  tags
  cancelledAt
  shippingAddress { ...Addr }
  billingAddress { ...Addr }
  claim: metafield(namespace: "${TDF_NAMESPACE}", key: "claim") { value }
  lineItems(first: 100) {
    nodes {
      name
      sku
      currentQuantity
      variant {
        id
        supplier: metafield(namespace: "${TDF_NAMESPACE}", key: "supplier_variant_gid") { value }
        product { tags }
      }
    }
  }
`;

const ADDRESS_FRAGMENT = /* GraphQL */ `
  fragment Addr on MailingAddress {
    firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone
  }
`;

const ORDERS_QUERY = /* GraphQL */ `
  query TdfPaidOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
  ${ADDRESS_FRAGMENT}
`;

const ORDER_QUERY = /* GraphQL */ `
  query TdfOrder($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
  ${ADDRESS_FRAGMENT}
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation TdfOrderMeta($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation TdfTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

const TAGS_REMOVE = /* GraphQL */ `
  mutation TdfTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

// ── Магазин поставщика (запросы — как в его документации) ─────────────────

const DRAFT_CALCULATE = /* GraphQL */ `
  mutation CalculateDraftOrder($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        availableShippingRates { handle title price { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

const DRAFT_CREATE = /* GraphQL */ `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id name totalPrice }
      userErrors { field message }
    }
  }
`;

const DRAFT_COMPLETE = /* GraphQL */ `
  mutation draftOrderComplete($id: ID!) {
    draftOrderComplete(id: $id) {
      draftOrder { id status }
      userErrors { field message }
    }
  }
`;

/** Номер итогового заказа — отдельным запросом: права токена на Order не гарантированы. */
const DRAFT_ORDER_LOOKUP = /* GraphQL */ `
  query TdfDraft($id: ID!) {
    draftOrder(id: $id) { order { name } }
  }
`;

interface UserError {
  field?: string[] | null;
  message: string;
}

interface ShippingRate {
  handle: string;
  title: string;
  price: { amount: string; currencyCode: string };
}

// ── Сборка черновика (чистая функция — её и тестируем) ────────────────────

export interface TdfLine {
  variantId: string;
  quantity: number;
  label: string;
}

export interface BuiltDraft {
  /** DraftOrderInput без shippingLine (тариф выбирается после расчёта). */
  input?: Record<string, unknown>;
  /** Позиции TheDoubleF. Пусто — заказ нас не касается. */
  lines: TdfLine[];
  /** Позиции TheDoubleF без ID варианта поставщика — их передать нельзя. */
  unmatched: string[];
  problem?: string;
}

/** Товар TheDoubleF: есть ID варианта поставщика или тег источника у товара. */
function isTdfLine(item: OurLineItem): boolean {
  return Boolean(item.variant?.supplier?.value) || Boolean(item.variant?.product?.tags.includes(SOURCE_TAG));
}

/** SKU нашего варианта (= ID записи фида) → GID варианта в магазине поставщика. */
export type SupplierIds = Map<string, string>;

/**
 * Товары, созданные до появления метаполя `tdf.supplier_variant_gid`, его не
 * имеют (синк существующие товары им не дополняет). Для них ID берём из фида.
 */
export async function loadSupplierIds(url: string = process.env.TDF_FEED_URL || DEFAULT_FEED_URL): Promise<SupplierIds> {
  const ids: SupplierIds = new Map();
  for (const p of await fetchFeed(url)) {
    for (const v of p.variants) {
      if (v.supplierVariantId) ids.set(v.id, `gid://shopify/ProductVariant/${v.supplierVariantId}`);
    }
  }
  return ids;
}

export function buildDraftInput(
  order: OurOrder,
  settings: TdfOrderSettings,
  feedIds?: SupplierIds
): BuiltDraft {
  const lines: TdfLine[] = [];
  const unmatched: string[] = [];
  for (const item of order.lineItems.nodes) {
    if (item.currentQuantity <= 0 || !isTdfLine(item)) continue;
    const gid = item.variant?.supplier?.value || (item.sku ? feedIds?.get(item.sku) : undefined);
    if (!gid) {
      unmatched.push(item.sku || item.name);
      continue;
    }
    lines.push({ variantId: gid, quantity: item.currentQuantity, label: item.sku || item.name });
  }
  if (lines.length === 0 && unmatched.length === 0) return { lines, unmatched };
  if (unmatched.length > 0) {
    return { lines, unmatched, problem: `нет ID варианта поставщика у ${unmatched.join(", ")}` };
  }

  const a = order.shippingAddress;
  if (!a?.address1 || !a.city || !a.countryCodeV2 || !a.zip) {
    return { lines, unmatched, problem: "нет полного адреса доставки" };
  }
  if (!a.firstName || !a.lastName) {
    return { lines, unmatched, problem: "в адресе доставки нет имени или фамилии" };
  }
  const phone = a.phone || order.phone || order.billingAddress?.phone || settings.fallbackPhone;
  if (!phone) {
    return { lines, unmatched, problem: "нет телефона покупателя (поставщик требует)" };
  }

  // Поставщик требует оба адреса. Счёт выставляется нашей компании
  // (purchasingEntity), поэтому billing — тот же адрес получателя, как в примере
  // из документации.
  const address = {
    firstName: a.firstName,
    lastName: a.lastName,
    ...(a.company ? { company: a.company } : {}),
    address1: a.address1,
    ...(a.address2 ? { address2: a.address2 } : {}),
    city: a.city,
    countryCode: a.countryCodeV2,
    ...(a.provinceCode ? { provinceCode: a.provinceCode } : {}),
    zip: a.zip,
    phone,
  };

  return {
    lines,
    unmatched,
    input: {
      paymentTerms: { paymentTermsTemplateId: PAYMENT_TERMS_TEMPLATE },
      lineItems: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      poNumber: order.name,
      purchasingEntity: {
        purchasingCompany: {
          companyId: settings.companyId,
          companyLocationId: settings.companyLocationId,
          companyContactId: settings.companyContactId,
        },
      },
      shippingAddress: address,
      billingAddress: address,
      customAttributes: [{ key: "payment_method", value: settings.paymentMethod }],
      tags: ["GRAPHQL"],
    },
  };
}

/** Самый дешёвый тариф: у поставщика обычно один на зону, но на всякий случай. */
export function cheapestRate(rates: ShippingRate[]): ShippingRate | undefined {
  return [...rates].sort((x, y) => Number(x.price.amount) - Number(y.price.amount))[0];
}

/** Строка поиска заказов: оплаченные, не старше since и окна опроса. */
export function ordersSearch(since: string, now: Date = new Date()): string {
  const floor = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const from = new Date(since) > floor ? new Date(since) : floor;
  return `financial_status:paid created_at:>='${from.toISOString()}'`;
}

/** Заказ ещё ждёт обработки? (claim ставится при первом касании.) */
export function needsProcessing(order: OurOrder): boolean {
  if (order.cancelledAt) return false;
  if (order.tags.includes(TAG_RETRY)) return true;
  return !order.claim;
}

// ── Обработка ─────────────────────────────────────────────────────────────

export interface TdfOrderStats {
  scanned: number;
  sent: number;
  dryRun: number;
  failed: number;
}

export interface TdfOrderDeps {
  /** Наш магазин. */
  ours: ShopifyClient;
  /** Магазин поставщика (vip-tdf.myshopify.com, токен из письма TheDoubleF). */
  tdf: ShopifyClient;
  settings: TdfOrderSettings;
  alert: Alert;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Источник ID поставщика по SKU (по умолчанию — фид); грузится раз за проход и только по нужде. */
  supplierIds?: () => Promise<SupplierIds>;
}

function userErrorText(errors: UserError[]): string {
  return errors.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ");
}

async function mutate(client: ShopifyClient, query: string, variables: Record<string, unknown>, key: string) {
  const data = await client.graphql<Record<string, { userErrors: UserError[] }>>(query, variables);
  const errors = data[key]?.userErrors ?? [];
  if (errors.length > 0) throw new Error(`${key}: ${userErrorText(errors)}`);
}

async function setOrderMeta(client: ShopifyClient, orderId: string, key: string, value: string, type: string) {
  await mutate(
    client,
    METAFIELDS_SET,
    { metafields: [{ ownerId: orderId, namespace: TDF_NAMESPACE, key, type, value }] },
    "metafieldsSet"
  );
}

async function fetchOrder(client: ShopifyClient, id: string): Promise<OurOrder | null> {
  const data = await client.graphql<{ order: OurOrder | null }>(ORDER_QUERY, { id });
  return data.order;
}

/**
 * Берём заказ в работу так, чтобы два инстанса сервера (перекрытие при
 * деплое) не оформили его дважды: свежая проверка → запись своего claim →
 * пауза → чтение. Пишут оба — побеждает последний, и оба это видят.
 */
async function claim(deps: TdfOrderDeps, orderId: string): Promise<OurOrder | null> {
  const fresh = await fetchOrder(deps.ours, orderId);
  if (!fresh || !needsProcessing(fresh)) return null;
  const token = randomUUID();
  await setOrderMeta(deps.ours, orderId, "claim", token, "single_line_text_field");
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(CLAIM_SETTLE_MS);
  const after = await fetchOrder(deps.ours, orderId);
  if (after?.claim?.value !== token) return null;
  if (after.tags.includes(TAG_RETRY)) {
    await mutate(deps.ours, TAGS_REMOVE, { id: orderId, tags: [TAG_RETRY, TAG_ERROR] }, "tagsRemove");
  }
  return after;
}

type Outcome = "sent" | "dry-run" | "failed" | "skipped";

async function processOrder(deps: TdfOrderDeps, listed: OurOrder): Promise<Outcome> {
  // Дешёвая проверка до claim: заказы без TheDoubleF не трогаем вовсе.
  const preview = buildDraftInput(listed, deps.settings);
  if (preview.lines.length === 0 && preview.unmatched.length === 0) return "skipped";
  const order = await claim(deps, listed.id);
  if (!order) return "skipped";

  const { ours, tdf, settings, alert } = deps;
  let built = buildDraftInput(order, settings);
  if (built.unmatched.length > 0 && deps.supplierIds) {
    built = buildDraftInput(order, settings, await deps.supplierIds());
  }
  const fail = async (reason: string, extra = ""): Promise<Outcome> => {
    await mutate(ours, TAGS_ADD, { id: order.id, tags: [TAG_ERROR] }, "tagsAdd");
    await alert(
      `🔴 Заказ ${order.name}: TheDoubleF не оформлен — ${reason}.${extra}\n` +
        `Оформите у поставщика вручную. Повторить автоматически — тег <b>${TAG_RETRY}</b>.`
    );
    return "failed";
  };

  if (built.problem || !built.input) return fail(built.problem ?? "не собрался черновик");

  let draftId: string | null = null;
  try {
    const calc = await tdf.graphql<{
      draftOrderCalculate: {
        calculatedDraftOrder: { availableShippingRates: ShippingRate[] } | null;
        userErrors: UserError[];
      };
    }>(DRAFT_CALCULATE, { input: built.input });
    if (calc.draftOrderCalculate.userErrors.length > 0) {
      return fail(`расчёт: ${userErrorText(calc.draftOrderCalculate.userErrors)}`);
    }
    const rate = cheapestRate(calc.draftOrderCalculate.calculatedDraftOrder?.availableShippingRates ?? []);
    if (!rate) return fail(`нет тарифа доставки в ${order.shippingAddress?.countryCodeV2}`);

    const lines = built.lines.map((l) => `• ${l.label} × ${l.quantity}`).join("\n");
    const shipping = `${rate.title}: ${rate.price.amount} ${rate.price.currencyCode}`;

    if (settings.mode === "dry-run") {
      await mutate(ours, TAGS_ADD, { id: order.id, tags: [TAG_DRY_RUN] }, "tagsAdd");
      await alert(
        `🧪 Заказ ${order.name} — пробный расчёт TheDoubleF (у поставщика ничего не создано):\n` +
          `${lines}\nДоставка ${shipping}\nОформите у поставщика вручную.`
      );
      return "dry-run";
    }

    const created = await tdf.graphql<{
      draftOrderCreate: { draftOrder: { id: string; name: string; totalPrice: string } | null; userErrors: UserError[] };
    }>(DRAFT_CREATE, { input: { ...built.input, shippingLine: { shippingRateHandle: rate.handle } } });
    const draft = created.draftOrderCreate.draftOrder;
    if (!draft) return fail(`черновик: ${userErrorText(created.draftOrderCreate.userErrors)}`);
    draftId = draft.id;
    const record = { draftOrderId: draft.id, draftName: draft.name, totalEur: draft.totalPrice, shipping: rate.title };
    await setOrderMeta(ours, order.id, "order", JSON.stringify(record), "json");

    const done = await tdf.graphql<{
      draftOrderComplete: { draftOrder: { id: string; status: string } | null; userErrors: UserError[] };
    }>(DRAFT_COMPLETE, { id: draft.id });
    // Поставщик иногда отвечает userError вместе с завершённым черновиком
    // («This order has been paid») — правда в статусе.
    if (done.draftOrderComplete.draftOrder?.status !== "COMPLETED") {
      return fail(
        `черновик ${draft.name} создан, но не завершён: ${userErrorText(done.draftOrderComplete.userErrors) || "статус не COMPLETED"}`,
        `\nЧерновик уже у поставщика — не создавайте второй, завершите ${draft.name}.`
      );
    }

    let orderName = "";
    try {
      const look = await tdf.graphql<{ draftOrder: { order: { name: string } | null } | null }>(
        DRAFT_ORDER_LOOKUP,
        { id: draft.id }
      );
      orderName = look.draftOrder?.order?.name ?? "";
    } catch {
      // Номер заказа — для удобства; без прав на Order обходимся номером черновика.
    }
    if (orderName) {
      await setOrderMeta(ours, order.id, "order", JSON.stringify({ ...record, orderName }), "json");
    }
    await mutate(ours, TAGS_ADD, { id: order.id, tags: [TAG_SENT] }, "tagsAdd");
    await alert(
      `✅ Заказ ${order.name} оформлен у TheDoubleF: ${orderName || draft.name} ` +
        `(черновик ${draft.name}), ${draft.totalPrice} EUR, оплата ${settings.paymentMethod}.\n` +
        `${lines}\nДоставка ${shipping}`
    );
    return "sent";
  } catch (err) {
    const note = draftId ? `\nЧерновик ${draftId} уже создан у поставщика — проверьте его, прежде чем оформлять заново.` : "";
    return fail(String(err), note);
  }
}

/** Один проход: оплаченные заказы → TheDoubleF. Ошибки по заказу не валят проход. */
export async function forwardTdfOrders(input: TdfOrderDeps): Promise<TdfOrderStats> {
  const stats: TdfOrderStats = { scanned: 0, sent: 0, dryRun: 0, failed: 0 };
  // Фид весит ~20 МБ — качаем не больше раза за проход и только если понадобился.
  const source = input.supplierIds ?? (() => loadSupplierIds());
  let cached: Promise<SupplierIds> | null = null;
  const deps: TdfOrderDeps = {
    ...input,
    supplierIds: () => {
      cached ??= source().catch((err) => {
        cached = null;
        throw err;
      });
      return cached;
    },
  };
  const query = ordersSearch(deps.settings.since, deps.now?.() ?? new Date());
  let after: string | null = null;
  do {
    type Page = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OurOrder[] } };
    const page: Page = await deps.ours.graphql<Page>(ORDERS_QUERY, { query, after });
    for (const order of page.orders.nodes) {
      stats.scanned++;
      if (!needsProcessing(order)) continue;
      let outcome: Outcome;
      try {
        outcome = await processOrder(deps, order);
      } catch (err) {
        // Сбой на нашей стороне (claim, теги). Тег ошибки — по возможности,
        // чтобы менеджер увидел заказ в админке.
        await mutate(deps.ours, TAGS_ADD, { id: order.id, tags: [TAG_ERROR] }, "tagsAdd").catch(() => {});
        await deps.alert(`🔴 Заказ ${order.name}: сбой передачи в TheDoubleF — ${String(err)}`);
        outcome = "failed";
      }
      if (outcome === "sent") stats.sent++;
      else if (outcome === "dry-run") stats.dryRun++;
      else if (outcome === "failed") stats.failed++;
    }
    after = page.orders.pageInfo.hasNextPage ? page.orders.pageInfo.endCursor : null;
  } while (after);
  return stats;
}
