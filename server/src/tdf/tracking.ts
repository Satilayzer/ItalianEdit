/**
 * Трек-номера TheDoubleF из их Google-таблицы → отправки в нашем Shopify.
 *
 * Токен поставщика не видит его заказы (нет read_orders), поэтому статусы
 * TheDoubleF ведёт в общей таблице: дата, наш номер заказа, их номер (VIP-…),
 * статус и трек. Таблица открыта по ссылке, читаем её CSV-экспортом — без
 * ключей Google.
 *
 * Для каждой строки с трек-номером:
 *  - позиции TheDoubleF ещё не отправлены → создаём отправку с треком;
 *  - уже отправлены вручную, но без трека → дописываем трек в эту отправку;
 *  - трек уже стоит → ничего не делаем (повторный проход безвреден).
 * Покупатель получает письмо Shopify с треком (TDF_TRACKING_NOTIFY=false — без писем).
 * Другие позиции заказа (BrandsGateway, ручной закуп) не трогаем.
 */

import type { ShopifyClient } from "../shopify/client";
import { parseCsv } from "./brands";
import { TDF_NAMESPACE } from "./productInput";
import { isTdfLine, userErrorText, type Alert, type OurLineItem, type UserError } from "./orders";

export const DEFAULT_TRACKING_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1q_HZNSwRQcMnQti_epASoFSpuHEupuG0oOVc45z66Oc/export?format=csv&gid=0";

/** Тег для менеджеров: трек TheDoubleF записан в заказ. */
export const TAG_SHIPPED = "tdf-order-shipped";

/** Строки старше не смотрим: заказ давно закрыт, а таблица только растёт. */
const MAX_AGE_DAYS = 90;

// ── Таблица ───────────────────────────────────────────────────────────────

export interface SheetRow {
  createdAt: string;
  /** Наш номер в виде «#1001». */
  orderName: string;
  /** Номер у поставщика, «VIP-37222». */
  tdfOrder: string;
  status: string;
  trackingNumbers: string[];
}

/** «1001», « #1001 » → «#1001». */
export function normalizeOrderName(raw: string): string {
  const v = raw.trim().replace(/^#+/, "");
  return v ? `#${v}` : "";
}

/**
 * Разбор CSV таблицы. Колонки ищем по заголовку, а не по позиции: поставщик
 * может переставить или добавить столбцы.
 */
export function parseTrackingSheet(csv: string): SheetRow[] {
  const [head, ...rows] = parseCsv(csv.replace(/^﻿/, ""));
  if (!head) return [];
  const h = head.map((c) => c.trim().toUpperCase());
  const col = (test: (name: string) => boolean) => h.findIndex(test);
  const ours = col((n) => n.includes("ITALIAN"));
  const tdf = col((n) => n.includes("TDF"));
  const status = col((n) => n.includes("STATUS"));
  const tracking = col((n) => n.includes("TRACKING"));
  const created = col((n) => n.includes("CREATED") || n.includes("DATE"));
  if (ours < 0 || tracking < 0) {
    throw new Error(`таблица TheDoubleF: не нашлись колонки заказа/трека в заголовке «${head.join(", ")}»`);
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows
    .map((r) => ({
      createdAt: cell(r, created),
      orderName: normalizeOrderName(cell(r, ours)),
      tdfOrder: cell(r, tdf),
      status: cell(r, status).toUpperCase(),
      trackingNumbers: cell(r, tracking)
        .split(/[\s,;]+/)
        .map((n) => n.trim())
        .filter(Boolean),
    }))
    .filter((r) => r.orderName);
}

export async function fetchTrackingSheet(url: string, fetchFn: typeof fetch = fetch): Promise<SheetRow[]> {
  const res = await fetchFn(url, { redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("csv")) {
    // Закрыли доступ по ссылке — Google отдаёт страницу входа (HTML), а не CSV.
    throw new Error(`таблица TheDoubleF недоступна: HTTP ${res.status}, ${type || "без типа"} (закрыт доступ по ссылке?)`);
  }
  return parseTrackingSheet(await res.text());
}

/**
 * Служба доставки по формату номера. 10 цифр — накладная DHL Express (так
 * отправляет TheDoubleF); для известной службы Shopify сам строит ссылку
 * отслеживания. Незнакомый формат — без службы, только номер.
 */
export function carrierFor(number: string): string | undefined {
  if (/^\d{10}$/.test(number)) return "DHL Express";
  if (/^1Z[0-9A-Z]{16}$/i.test(number)) return "UPS";
  return undefined;
}

// ── Наш заказ ─────────────────────────────────────────────────────────────

interface FoLineItem {
  id: string;
  remainingQuantity: number;
  lineItem: OurLineItem;
}

export interface TrackedOrder {
  id: string;
  name: string;
  tags: string[];
  cancelledAt: string | null;
  tdfRecord: { value: string } | null;
  fulfillmentOrders: { nodes: { id: string; status: string; lineItems: { nodes: FoLineItem[] } }[] };
  fulfillments: {
    id: string;
    status: string;
    trackingInfo: { number: string | null }[];
    fulfillmentLineItems: { nodes: { lineItem: OurLineItem }[] };
  }[];
}

const LINE_ITEM_FIELDS = /* GraphQL */ `
  name
  sku
  currentQuantity
  variant {
    id
    supplier: metafield(namespace: "${TDF_NAMESPACE}", key: "supplier_variant_gid") { value }
    product { tags }
  }
`;

export const TRACKED_ORDER_QUERY = /* GraphQL */ `
  query TdfTrackedOrder($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        tags
        cancelledAt
        tdfRecord: metafield(namespace: "${TDF_NAMESPACE}", key: "order") { value }
        fulfillmentOrders(first: 20) {
          nodes {
            id
            status
            lineItems(first: 100) { nodes { id remainingQuantity lineItem { ${LINE_ITEM_FIELDS} } } }
          }
        }
        fulfillments(first: 20) {
          id
          status
          trackingInfo { number }
          fulfillmentLineItems(first: 100) { nodes { lineItem { ${LINE_ITEM_FIELDS} } } }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE = /* GraphQL */ `
  mutation TdfFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`;

const TRACKING_UPDATE = /* GraphQL */ `
  mutation TdfTrackingUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: $notifyCustomer
    ) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation TdfShippedTag($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

/** Фулфилмент-ордеры, которые ещё можно отправить. */
const FULFILLABLE = new Set(["OPEN", "IN_PROGRESS"]);

// ── План по заказу (чистая функция — её и тестируем) ─────────────────────

export type TrackingPlan =
  | { kind: "create"; groups: { fulfillmentOrderId: string; lines: { id: string; quantity: number }[] }[] }
  | { kind: "update"; fulfillmentIds: string[] }
  | { kind: "done" }
  | { kind: "problem"; reason: string };

export function planTracking(order: TrackedOrder, numbers: string[]): TrackingPlan {
  if (order.cancelledAt) return { kind: "problem", reason: "заказ отменён у нас" };

  const known = new Set(order.fulfillments.flatMap((f) => f.trackingInfo.map((t) => t.number).filter(Boolean)));
  if (numbers.every((n) => known.has(n))) return { kind: "done" };

  const groups = order.fulfillmentOrders.nodes
    .filter((fo) => FULFILLABLE.has(fo.status))
    .map((fo) => ({
      fulfillmentOrderId: fo.id,
      lines: fo.lineItems.nodes
        .filter((li) => li.remainingQuantity > 0 && isTdfLine(li.lineItem))
        .map((li) => ({ id: li.id, quantity: li.remainingQuantity })),
    }))
    .filter((g) => g.lines.length > 0);
  if (groups.length > 0) return { kind: "create", groups };

  // Отправили вручную, трек не вписали — дописываем его в эти отправки.
  const tdfFulfillments = order.fulfillments.filter(
    (f) => f.status === "SUCCESS" && f.fulfillmentLineItems.nodes.some((n) => isTdfLine(n.lineItem))
  );
  const bare = tdfFulfillments.filter((f) => f.trackingInfo.every((t) => !t.number));
  if (bare.length > 0) return { kind: "update", fulfillmentIds: bare.map((f) => f.id) };

  if (tdfFulfillments.length > 0) {
    const other = [...known].join(", ");
    return { kind: "problem", reason: `позиции TheDoubleF уже отправлены с другим треком (${other})` };
  }
  return { kind: "problem", reason: "в заказе нет позиций TheDoubleF" };
}

// ── Проход ────────────────────────────────────────────────────────────────

export interface TrackingStats {
  rows: number;
  created: number;
  updated: number;
  already: number;
  problems: number;
}

export interface TrackingDeps {
  ours: ShopifyClient;
  alert: Alert;
  /** Слать покупателю письмо Shopify с треком. */
  notifyCustomer: boolean;
  sheetUrl?: string;
  /** Источник строк таблицы (тесты подменяют). */
  loadRows?: () => Promise<SheetRow[]>;
  /**
   * Ключи уже отправленных предупреждений: проход идёт 4 раза в день, и одна
   * и та же проблемная строка не должна алертить каждый раз. Живёт в процессе.
   */
  warned?: Set<string>;
  /** Только показать план, ничего не менять (скрипт проверки). */
  dryRun?: boolean;
  log?: (msg: string) => void;
  now?: () => Date;
}

async function mutate(client: ShopifyClient, query: string, variables: Record<string, unknown>, key: string) {
  const data = await client.graphql<Record<string, { userErrors: UserError[] }>>(query, variables);
  const errors = data[key]?.userErrors ?? [];
  if (errors.length > 0) throw new Error(`${key}: ${userErrorText(errors)}`);
}

async function findOrder(client: ShopifyClient, name: string): Promise<TrackedOrder | null> {
  const data = await client.graphql<{ orders: { nodes: TrackedOrder[] } }>(TRACKED_ORDER_QUERY, {
    query: `name:${name}`,
  });
  // Поиск по name нечёткий — берём только точное совпадение.
  return data.orders.nodes.find((o) => o.name === name) ?? null;
}

function trackingInput(numbers: string[]) {
  const company = carrierFor(numbers[0]);
  return {
    ...(company ? { company } : {}),
    ...(numbers.length === 1 ? { number: numbers[0] } : { numbers }),
  };
}

/** Один проход по таблице. Ошибка по заказу не валит проход. */
export async function syncTdfTracking(deps: TrackingDeps): Promise<TrackingStats> {
  const stats: TrackingStats = { rows: 0, created: 0, updated: 0, already: 0, problems: 0 };
  const warned = deps.warned ?? new Set<string>();
  const log = deps.log ?? (() => {});
  const warnOnce = async (key: string, text: string) => {
    stats.problems++;
    log(text);
    if (deps.dryRun || warned.has(key)) return;
    warned.add(key);
    await deps.alert(text);
  };

  const rows = await (deps.loadRows ?? (() => fetchTrackingSheet(deps.sheetUrl ?? DEFAULT_TRACKING_SHEET_URL)))();
  const floor = (deps.now?.() ?? new Date()).getTime() - MAX_AGE_DAYS * 86_400_000;

  for (const row of rows) {
    if (row.status.includes("CANCEL")) {
      await warnOnce(
        `cancel:${row.orderName}`,
        `⚠️ TheDoubleF: заказ ${row.orderName} (${row.tdfOrder}) в их таблице отменён — проверьте и верните деньги покупателю.`
      );
      continue;
    }
    if (row.trackingNumbers.length === 0) continue;
    const created = Date.parse(row.createdAt);
    if (!Number.isNaN(created) && created < floor) continue;
    stats.rows++;

    const label = `${row.orderName} (${row.tdfOrder || "без номера TDF"})`;
    try {
      const order = await findOrder(deps.ours, row.orderName);
      if (!order) {
        await warnOnce(`missing:${row.orderName}`, `⚠️ TheDoubleF: заказа ${label} из их таблицы у нас нет — трек не записан.`);
        continue;
      }

      // Защита от опечатки в таблице: номер поставщика должен совпасть с нашим.
      let recorded = "";
      try {
        recorded = JSON.parse(order.tdfRecord?.value ?? "{}").orderName ?? "";
      } catch {
        // Битое метаполе — сверять не с чем.
      }
      if (recorded && row.tdfOrder && recorded !== row.tdfOrder) {
        await warnOnce(
          `mismatch:${row.orderName}:${row.tdfOrder}`,
          `⚠️ TheDoubleF: в их таблице у ${row.orderName} заказ ${row.tdfOrder}, а у нас записан ${recorded} — трек не записан, проверьте вручную.`
        );
        continue;
      }

      const plan = planTracking(order, row.trackingNumbers);
      if (plan.kind === "done") {
        stats.already++;
        continue;
      }
      if (plan.kind === "problem") {
        await warnOnce(
          `problem:${row.orderName}:${row.trackingNumbers.join(",")}`,
          `⚠️ TheDoubleF: трек ${row.trackingNumbers.join(", ")} для ${label} не записан — ${plan.reason}.`
        );
        continue;
      }

      const tracking = trackingInput(row.trackingNumbers);
      const what = plan.kind === "create" ? "создам отправку" : "допишу трек в отправку";
      if (deps.dryRun) {
        log(`[проверка] ${label}: ${what}, трек ${row.trackingNumbers.join(", ")} ${tracking.company ?? ""}`.trim());
        if (plan.kind === "create") stats.created++;
        else stats.updated++;
        continue;
      }

      if (plan.kind === "create") {
        // По отправке на фулфилмент-ордер: разные локации в одну отправку не сливаются.
        for (const g of plan.groups) {
          await mutate(
            deps.ours,
            FULFILLMENT_CREATE,
            {
              fulfillment: {
                lineItemsByFulfillmentOrder: [
                  { fulfillmentOrderId: g.fulfillmentOrderId, fulfillmentOrderLineItems: g.lines },
                ],
                trackingInfo: tracking,
                notifyCustomer: deps.notifyCustomer,
              },
            },
            "fulfillmentCreate"
          );
        }
        stats.created++;
      } else {
        for (const id of plan.fulfillmentIds) {
          await mutate(
            deps.ours,
            TRACKING_UPDATE,
            { fulfillmentId: id, trackingInfoInput: tracking, notifyCustomer: deps.notifyCustomer },
            "fulfillmentTrackingInfoUpdate"
          );
        }
        stats.updated++;
      }
      await mutate(deps.ours, TAGS_ADD, { id: order.id, tags: [TAG_SHIPPED] }, "tagsAdd");
      const carrier = tracking.company ? `${tracking.company} ` : "";
      await deps.alert(
        `📦 Заказ ${label}: TheDoubleF отправил, трек ${carrier}${row.trackingNumbers.join(", ")} записан в Shopify` +
          (deps.notifyCustomer ? " (покупатель получит письмо)." : " (без письма покупателю).")
      );
    } catch (err) {
      await warnOnce(`error:${row.orderName}:${String(err)}`, `🔴 TheDoubleF: трек для ${label} не записан — ${String(err)}`);
    }
  }
  return stats;
}
