import { describe, it, expect, vi } from "vitest";
import { ShopifyClient } from "../src/shopify/client";
import type { OurLineItem } from "../src/tdf/orders";
import {
  carrierFor,
  normalizeOrderName,
  parseTrackingSheet,
  planTracking,
  syncTdfTracking,
  TAG_SHIPPED,
  type SheetRow,
  type TrackedOrder,
} from "../src/tdf/tracking";

const CSV =
  "CREATED AT,ORDER NUMBER ITALIAN EDIT,ORDER NUMBER TDF,ORDER STATUS,TRACKING NUMBER\r\n" +
  "2026-10-29T21:13:09+01:00,#1001,VIP-37222,FULLFILLED,5581311352\r\n" +
  "2026-11-02T10:00:00+01:00,1002,VIP-37300,PROCESSING,\r\n" +
  ",,,,\r\n";

const tdfItem: OurLineItem = {
  name: "Brown hooded sweatshirt - L",
  sku: "UNU-25-1012UCO/XL_ENTST-DU_323-L",
  currentQuantity: 1,
  variant: { id: "gid://shopify/ProductVariant/1", supplier: null, product: { tags: ["tdf"] } },
};
const bgItem: OurLineItem = {
  name: "Gucci bag",
  sku: "GG-1",
  currentQuantity: 1,
  variant: { id: "gid://shopify/ProductVariant/2", supplier: null, product: { tags: [] } },
};

function order(over: Partial<TrackedOrder> = {}): TrackedOrder {
  return {
    id: "gid://shopify/Order/10",
    name: "#1001",
    tags: [],
    cancelledAt: null,
    tdfRecord: { value: JSON.stringify({ orderName: "VIP-37222" }) },
    fulfillmentOrders: {
      nodes: [
        {
          id: "gid://shopify/FulfillmentOrder/1",
          status: "OPEN",
          lineItems: {
            nodes: [
              { id: "gid://shopify/FulfillmentOrderLineItem/1", remainingQuantity: 1, lineItem: tdfItem },
              { id: "gid://shopify/FulfillmentOrderLineItem/2", remainingQuantity: 1, lineItem: bgItem },
            ],
          },
        },
      ],
    },
    fulfillments: [],
    ...over,
  };
}

/** Заказ, который менеджер отправил вручную без трека (как #1001 на проде). */
const fulfilledBare = (tracking: string | null = null) =>
  order({
    fulfillmentOrders: { nodes: [{ id: "gid://shopify/FulfillmentOrder/1", status: "CLOSED", lineItems: { nodes: [] } }] },
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/7",
        status: "SUCCESS",
        trackingInfo: tracking ? [{ number: tracking }] : [],
        fulfillmentLineItems: { nodes: [{ lineItem: tdfItem }] },
      },
    ],
  });

describe("parseTrackingSheet", () => {
  it("читает колонки по заголовку, нормализует номер и пропускает пустые строки", () => {
    expect(parseTrackingSheet(CSV)).toEqual([
      {
        createdAt: "2026-10-29T21:13:09+01:00",
        orderName: "#1001",
        tdfOrder: "VIP-37222",
        status: "FULLFILLED",
        trackingNumbers: ["5581311352"],
      },
      { createdAt: "2026-11-02T10:00:00+01:00", orderName: "#1002", tdfOrder: "VIP-37300", status: "PROCESSING", trackingNumbers: [] },
    ]);
  });

  it("несколько треков в ячейке и переставленные колонки", () => {
    const rows = parseTrackingSheet('TRACKING NUMBER,ORDER NUMBER ITALIAN EDIT\n"111, 222",#5\n');
    expect(rows).toEqual([{ createdAt: "", orderName: "#5", tdfOrder: "", status: "", trackingNumbers: ["111", "222"] }]);
  });

  it("без колонки трека — ошибка, а не тихий пропуск", () => {
    expect(() => parseTrackingSheet("A,B\n1,2\n")).toThrow(/колонки/);
  });
});

describe("helpers", () => {
  it("normalizeOrderName", () => {
    expect(normalizeOrderName(" 1001 ")).toBe("#1001");
    expect(normalizeOrderName("#1001")).toBe("#1001");
    expect(normalizeOrderName("")).toBe("");
  });
  it("carrierFor: 10 цифр — DHL Express", () => {
    expect(carrierFor("5581311352")).toBe("DHL Express");
    expect(carrierFor("1Z999AA10123456784")).toBe("UPS");
    expect(carrierFor("AB123")).toBeUndefined();
  });
});

describe("planTracking", () => {
  it("открытые позиции TheDoubleF → отправка только их", () => {
    expect(planTracking(order(), ["5581311352"])).toEqual({
      kind: "create",
      groups: [
        { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", lines: [{ id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 1 }] },
      ],
    });
  });
  it("отправлено вручную без трека → дописать трек", () => {
    expect(planTracking(fulfilledBare(), ["5581311352"])).toEqual({ kind: "update", fulfillmentIds: ["gid://shopify/Fulfillment/7"] });
  });
  it("трек уже стоит → ничего", () => {
    expect(planTracking(fulfilledBare("5581311352"), ["5581311352"])).toEqual({ kind: "done" });
  });
  it("отправлено с другим треком → проблема, не перезаписываем", () => {
    expect(planTracking(fulfilledBare("999"), ["5581311352"]).kind).toBe("problem");
  });
  it("отменённый заказ → проблема", () => {
    expect(planTracking(order({ cancelledAt: "2026-11-01" }), ["1"]).kind).toBe("problem");
  });
});

// ── Проход на фейковом магазине ──────────────────────────────────────────

function fakeShop(state: TrackedOrder | null) {
  const calls: { op: string; vars: any }[] = [];
  const routes: Record<string, (v: any) => unknown> = {
    TdfTrackedOrder: () => ({ orders: { nodes: state ? [structuredClone(state)] : [] } }),
    fulfillmentCreate: () => ({ fulfillmentCreate: { fulfillment: { id: "f" }, userErrors: [] } }),
    fulfillmentTrackingInfoUpdate: () => ({ fulfillmentTrackingInfoUpdate: { fulfillment: { id: "f" }, userErrors: [] } }),
    tagsAdd: () => ({ tagsAdd: { userErrors: [] } }),
  };
  const fetchFn = vi.fn(async (_url: string, init: any) => {
    const { query, variables } = JSON.parse(init.body);
    const op = Object.keys(routes).find((k) => query.includes(k))!;
    calls.push({ op, vars: variables });
    return new Response(JSON.stringify({ data: routes[op](variables) }), { status: 200 });
  });
  return { client: new ShopifyClient({ shop: "t.myshopify.com", adminToken: "x" }, fetchFn as unknown as typeof fetch), calls };
}

const row: SheetRow = {
  createdAt: "2026-10-29T21:13:09+01:00",
  orderName: "#1001",
  tdfOrder: "VIP-37222",
  status: "FULLFILLED",
  trackingNumbers: ["5581311352"],
};
const now = () => new Date("2026-11-11T00:00:00Z");

describe("syncTdfTracking", () => {
  it("создаёт отправку с треком DHL, письмом покупателю и тегом", async () => {
    const shop = fakeShop(order());
    const alert = vi.fn().mockResolvedValue(undefined);
    const stats = await syncTdfTracking({ ours: shop.client, alert, notifyCustomer: true, loadRows: async () => [row], now });
    expect(stats).toMatchObject({ rows: 1, created: 1, updated: 0, problems: 0 });
    const create = shop.calls.find((c) => c.op === "fulfillmentCreate")!;
    expect(create.vars.fulfillment).toEqual({
      lineItemsByFulfillmentOrder: [
        {
          fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
          fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 1 }],
        },
      ],
      trackingInfo: { company: "DHL Express", number: "5581311352" },
      notifyCustomer: true,
    });
    expect(shop.calls.find((c) => c.op === "tagsAdd")!.vars.tags).toEqual([TAG_SHIPPED]);
    expect(alert.mock.calls[0][0]).toContain("5581311352");
  });

  it("дописывает трек в ручную отправку", async () => {
    const shop = fakeShop(fulfilledBare());
    const stats = await syncTdfTracking({ ours: shop.client, alert: vi.fn(), notifyCustomer: false, loadRows: async () => [row], now });
    expect(stats.updated).toBe(1);
    const upd = shop.calls.find((c) => c.op === "fulfillmentTrackingInfoUpdate")!;
    expect(upd.vars).toEqual({
      fulfillmentId: "gid://shopify/Fulfillment/7",
      trackingInfoInput: { company: "DHL Express", number: "5581311352" },
      notifyCustomer: false,
    });
  });

  it("повторный проход по записанному треку ничего не меняет", async () => {
    const shop = fakeShop(fulfilledBare("5581311352"));
    const stats = await syncTdfTracking({ ours: shop.client, alert: vi.fn(), notifyCustomer: true, loadRows: async () => [row], now });
    expect(stats).toMatchObject({ already: 1, created: 0, updated: 0 });
    expect(shop.calls.map((c) => c.op)).toEqual(["TdfTrackedOrder"]);
  });

  it("номер TDF не совпал с записанным у нас — не трогаем и алертим один раз", async () => {
    const shop = fakeShop(order({ tdfRecord: { value: JSON.stringify({ orderName: "VIP-1" }) } }));
    const alert = vi.fn().mockResolvedValue(undefined);
    const warned = new Set<string>();
    const deps = { ours: shop.client, alert, notifyCustomer: true, warned, loadRows: async () => [row], now };
    await syncTdfTracking(deps);
    await syncTdfTracking(deps);
    expect(shop.calls.some((c) => c.op === "fulfillmentCreate")).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("строки без трека и старые строки пропускает, неизвестный заказ — алерт", async () => {
    const shop = fakeShop(null);
    const alert = vi.fn().mockResolvedValue(undefined);
    const stats = await syncTdfTracking({
      ours: shop.client,
      alert,
      notifyCustomer: true,
      now,
      loadRows: async () => [
        { ...row, trackingNumbers: [] },
        { ...row, createdAt: "2026-01-01T00:00:00Z" },
        row,
      ],
    });
    expect(stats.rows).toBe(1);
    expect(stats.problems).toBe(1);
    expect(alert.mock.calls[0][0]).toContain("у нас нет");
  });

  it("dry-run ничего не пишет", async () => {
    const shop = fakeShop(order());
    const stats = await syncTdfTracking({ ours: shop.client, alert: vi.fn(), notifyCustomer: true, dryRun: true, loadRows: async () => [row], now });
    expect(stats.created).toBe(1);
    expect(shop.calls.map((c) => c.op)).toEqual(["TdfTrackedOrder"]);
  });
});
