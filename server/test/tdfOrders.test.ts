import { describe, it, expect, vi } from "vitest";
import { ShopifyClient } from "../src/shopify/client";
import {
  buildDraftInput,
  cheapestRate,
  forwardTdfOrders,
  needsProcessing,
  ordersSearch,
  TAG_DRY_RUN,
  TAG_ERROR,
  TAG_RETRY,
  TAG_SENT,
  type OurOrder,
  type TdfOrderSettings,
} from "../src/tdf/orders";

const settings: TdfOrderSettings = {
  mode: "live",
  companyId: "gid://shopify/Company/1",
  companyLocationId: "gid://shopify/CompanyLocation/2",
  companyContactId: "gid://shopify/CompanyContact/3",
  paymentMethod: "Bank Transfer",
  since: "2026-10-01T00:00:00Z",
};

const address = {
  firstName: "Anna",
  lastName: "Rossi",
  company: null,
  address1: "Via Roma 1",
  address2: null,
  city: "Milano",
  provinceCode: "MI",
  countryCodeV2: "IT",
  zip: "20100",
  phone: "+390212345",
};

function makeOrder(over: Partial<OurOrder> = {}): OurOrder {
  return {
    id: "gid://shopify/Order/10",
    name: "#1023",
    phone: null,
    tags: [],
    cancelledAt: null,
    shippingAddress: address,
    billingAddress: null,
    claim: null,
    lineItems: {
      nodes: [
        {
          name: "Sneakers - 40",
          sku: "SPSFERITOCO/XM_SPORM-001_102-40",
          currentQuantity: 1,
          variant: {
            id: "gid://shopify/ProductVariant/500",
            supplier: { value: "gid://shopify/ProductVariant/777" },
            product: { tags: ["tdf"] },
          },
        },
        {
          name: "Gucci bag",
          sku: "GG-1",
          currentQuantity: 1,
          variant: { id: "gid://shopify/ProductVariant/501", supplier: null, product: { tags: [] } },
        },
      ],
    },
    ...over,
  };
}

describe("buildDraftInput", () => {
  it("берёт только позиции TheDoubleF и собирает вход по документации поставщика", () => {
    const b = buildDraftInput(makeOrder(), settings);
    expect(b.problem).toBeUndefined();
    expect(b.lines).toEqual([
      { variantId: "gid://shopify/ProductVariant/777", quantity: 1, label: "SPSFERITOCO/XM_SPORM-001_102-40" },
    ]);
    const input = b.input as any;
    expect(input.lineItems).toEqual([{ variantId: "gid://shopify/ProductVariant/777", quantity: 1 }]);
    expect(input.poNumber).toBe("#1023");
    expect(input.purchasingEntity.purchasingCompany.companyContactId).toBe("gid://shopify/CompanyContact/3");
    expect(input.customAttributes).toEqual([{ key: "payment_method", value: "Bank Transfer" }]);
    expect(input.shippingAddress).toMatchObject({ countryCode: "IT", provinceCode: "MI", phone: "+390212345" });
    expect(input.billingAddress).toEqual(input.shippingAddress);
  });

  it("email заказа — наш из настроек, не покупателя", () => {
    expect((buildDraftInput(makeOrder(), settings).input as any).email).toBeUndefined();
    const b = buildDraftInput(makeOrder(), { ...settings, email: "hello@italian-edit.com" });
    expect((b.input as any).email).toBe("hello@italian-edit.com");
  });

  it("заказ без TheDoubleF — пусто, без проблемы", () => {
    const order = makeOrder();
    order.lineItems.nodes = order.lineItems.nodes.slice(1);
    const b = buildDraftInput(order, settings);
    expect(b.lines).toEqual([]);
    expect(b.problem).toBeUndefined();
  });

  it("возвращённая позиция (currentQuantity 0) не передаётся", () => {
    const order = makeOrder();
    order.lineItems.nodes[0].currentQuantity = 0;
    expect(buildDraftInput(order, settings).lines).toEqual([]);
  });

  it("товар с тегом tdf, но без ID варианта поставщика — проблема", () => {
    const order = makeOrder();
    order.lineItems.nodes[0].variant!.supplier = null;
    const b = buildDraftInput(order, settings);
    expect(b.problem).toMatch(/нет ID варианта/);
  });

  it("нет метаполя — ID поставщика берётся из фида по SKU", () => {
    const order = makeOrder();
    order.lineItems.nodes[0].variant!.supplier = null;
    const feed = new Map([["SPSFERITOCO/XM_SPORM-001_102-40", "gid://shopify/ProductVariant/888"]]);
    const b = buildDraftInput(order, settings, feed);
    expect(b.problem).toBeUndefined();
    expect(b.lines[0].variantId).toBe("gid://shopify/ProductVariant/888");
  });

  it("без телефона — запасной из настроек, без него — проблема", () => {
    const order = makeOrder({ shippingAddress: { ...address, phone: null } });
    expect(buildDraftInput(order, settings).problem).toMatch(/телефон/);
    const b = buildDraftInput(order, { ...settings, fallbackPhone: "+3900000" });
    expect((b.input as any).shippingAddress.phone).toBe("+3900000");
  });

  it("без фамилии — проблема (поле обязательное с 08.11)", () => {
    const order = makeOrder({ shippingAddress: { ...address, lastName: null } });
    expect(buildDraftInput(order, settings).problem).toMatch(/фамилии/);
  });
});

describe("мелочи", () => {
  it("cheapestRate выбирает дешёвый тариф", () => {
    const r = cheapestRate([
      { handle: "a", title: "Express", price: { amount: "40.00", currencyCode: "EUR" } },
      { handle: "b", title: "Standard", price: { amount: "12.50", currencyCode: "EUR" } },
    ]);
    expect(r?.handle).toBe("b");
  });

  it("ordersSearch не уходит дальше окна в 30 дней", () => {
    const now = new Date("2026-12-31T00:00:00Z");
    expect(ordersSearch("2026-01-01T00:00:00Z", now)).toContain("2026-12-01");
    expect(ordersSearch("2026-12-20T00:00:00Z", now)).toContain("2026-12-20");
  });

  it("needsProcessing: claim закрывает, тег retry открывает, отмена закрывает", () => {
    expect(needsProcessing(makeOrder())).toBe(true);
    expect(needsProcessing(makeOrder({ claim: { value: "x" } }))).toBe(false);
    expect(needsProcessing(makeOrder({ claim: { value: "x" }, tags: [TAG_RETRY] }))).toBe(true);
    expect(needsProcessing(makeOrder({ cancelledAt: "2026-10-14" }))).toBe(false);
  });
});

// ── Полный проход на фейковых магазинах ──────────────────────────────────

type Handler = (vars: any) => unknown;

/** Клиент, отвечающий по имени операции/мутации в теле запроса. */
function routedClient(routes: Record<string, Handler>) {
  const calls: { op: string; vars: any }[] = [];
  const fetchFn = vi.fn(async (_url: string, init: any) => {
    const { query, variables } = JSON.parse(init.body);
    const op = Object.keys(routes).find((k) => query.includes(k));
    if (!op) throw new Error(`нет маршрута для запроса: ${query.slice(0, 80)}`);
    calls.push({ op, vars: variables });
    return new Response(JSON.stringify({ data: routes[op](variables) }), { status: 200 });
  });
  const client = new ShopifyClient({ shop: "t.myshopify.com", adminToken: "x" }, fetchFn as unknown as typeof fetch);
  return { client, calls };
}

/** Наш магазин: держит один заказ в памяти, применяет метаполя и теги. */
function ourShop(order: OurOrder) {
  const state = structuredClone(order);
  const shop = routedClient({
    TdfPaidOrders: () => ({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [structuredClone(state)] } }),
    "TdfOrder(": () => ({ order: structuredClone(state) }),
    metafieldsSet: (v) => {
      for (const m of v.metafields) if (m.key === "claim") state.claim = { value: m.value };
      return { metafieldsSet: { userErrors: [] } };
    },
    tagsAdd: (v) => {
      state.tags.push(...v.tags);
      return { tagsAdd: { userErrors: [] } };
    },
    tagsRemove: (v) => {
      state.tags = state.tags.filter((t) => !v.tags.includes(t));
      return { tagsRemove: { userErrors: [] } };
    },
  });
  return { ...shop, state };
}

const rates = {
  draftOrderCalculate: {
    calculatedDraftOrder: {
      availableShippingRates: [{ handle: "h1", title: "Europa", price: { amount: "15.00", currencyCode: "EUR" } }],
    },
    userErrors: [],
  },
};

function tdfShop(over: Record<string, Handler> = {}) {
  return routedClient({
    draftOrderCalculate: () => rates,
    draftOrderCreate: () => ({
      draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/9", name: "#D33", totalPrice: "135.96" }, userErrors: [] },
    }),
    draftOrderComplete: () => ({
      draftOrderComplete: {
        draftOrder: { id: "gid://shopify/DraftOrder/9", status: "COMPLETED" },
        userErrors: [{ field: null, message: "This order has been paid" }],
      },
    }),
    "TdfDraft(": () => ({ draftOrder: { order: { name: "#1022" } } }),
    ...over,
  });
}

const noSleep = async () => {};
/** Тесты не ходят в настоящий фид. */
const emptyFeed = async () => new Map<string, string>();

describe("forwardTdfOrders", () => {
  it("live: расчёт → черновик с тарифом → завершение → тег sent", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop();
    const alert = vi.fn().mockResolvedValue(undefined);

    const stats = await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert, sleep: noSleep, supplierIds: emptyFeed });

    expect(stats).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
    expect(tdf.calls.map((c) => c.op)).toEqual(["draftOrderCalculate", "draftOrderCreate", "draftOrderComplete", "TdfDraft("]);
    expect(tdf.calls[1].vars.input.shippingLine).toEqual({ shippingRateHandle: "h1" });
    expect(ours.state.tags).toContain(TAG_SENT);
    expect(alert.mock.calls[0][0]).toMatch(/#1022.*135\.96 EUR/);
  });

  it("повторный проход тот же заказ не трогает", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop();
    const alert = vi.fn().mockResolvedValue(undefined);
    await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert, sleep: noSleep, supplierIds: emptyFeed });
    await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert, sleep: noSleep, supplierIds: emptyFeed });
    expect(tdf.calls.filter((c) => c.op === "draftOrderCreate")).toHaveLength(1);
  });

  it("dry-run: только расчёт, у поставщика ничего не создаётся", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop();
    const alert = vi.fn().mockResolvedValue(undefined);
    const stats = await forwardTdfOrders({
      ours: ours.client, tdf: tdf.client, settings: { ...settings, mode: "dry-run" }, alert, sleep: noSleep, supplierIds: emptyFeed,
    });
    expect(stats.dryRun).toBe(1);
    expect(tdf.calls.map((c) => c.op)).toEqual(["draftOrderCalculate"]);
    expect(ours.state.tags).toEqual([TAG_DRY_RUN]);
  });

  it("заказ без TheDoubleF: ни claim, ни запросов к поставщику", async () => {
    const order = makeOrder();
    order.lineItems.nodes = order.lineItems.nodes.slice(1);
    const ours = ourShop(order);
    const tdf = tdfShop();
    await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert: vi.fn(), sleep: noSleep, supplierIds: emptyFeed });
    expect(ours.state.claim).toBeNull();
    expect(tdf.calls).toHaveLength(0);
  });

  it("чужой claim после паузы — второй инстанс отступает", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop();
    // Пока «мы» ждём, другой инстанс перезаписывает claim своим.
    const sleep = async () => {
      ours.state.claim = { value: "other-instance" };
    };
    const stats = await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert: vi.fn(), sleep, supplierIds: emptyFeed });
    expect(stats.sent).toBe(0);
    expect(tdf.calls).toHaveLength(0);
  });

  it("ошибка поставщика при создании → тег error и алерт на ручное оформление", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop({
      draftOrderCreate: () => ({ draftOrderCreate: { draftOrder: null, userErrors: [{ field: ["lineItems"], message: "out of stock" }] } }),
    });
    const alert = vi.fn().mockResolvedValue(undefined);
    const stats = await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert, sleep: noSleep, supplierIds: emptyFeed });
    expect(stats.failed).toBe(1);
    expect(ours.state.tags).toContain(TAG_ERROR);
    expect(alert.mock.calls[0][0]).toMatch(/lineItems: out of stock/);
  });

  it("черновик создан, но не завершён — алерт предупреждает не создавать второй", async () => {
    const ours = ourShop(makeOrder());
    const tdf = tdfShop({
      draftOrderComplete: () => ({
        draftOrderComplete: { draftOrder: { id: "gid://shopify/DraftOrder/9", status: "OPEN" }, userErrors: [{ message: "boom" }] },
      }),
    });
    const alert = vi.fn().mockResolvedValue(undefined);
    await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert, sleep: noSleep, supplierIds: emptyFeed });
    expect(alert.mock.calls[0][0]).toMatch(/не создавайте второй/);
  });

  it("товар без метаполя: ID из фида, фид качается один раз", async () => {
    const order = makeOrder();
    order.lineItems.nodes[0].variant!.supplier = null;
    const ours = ourShop(order);
    const tdf = tdfShop();
    const feed = vi.fn(async () => new Map([["SPSFERITOCO/XM_SPORM-001_102-40", "gid://shopify/ProductVariant/888"]]));
    const stats = await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert: vi.fn(), sleep: noSleep, supplierIds: feed });
    expect(stats.sent).toBe(1);
    expect(feed).toHaveBeenCalledTimes(1);
    expect(tdf.calls[1].vars.input.lineItems).toEqual([{ variantId: "gid://shopify/ProductVariant/888", quantity: 1 }]);
  });

  it("тег retry: заказ с ошибкой прогоняется ещё раз, теги ошибки снимаются", async () => {
    const ours = ourShop(makeOrder({ claim: { value: "old" }, tags: [TAG_ERROR, TAG_RETRY] }));
    const tdf = tdfShop();
    const stats = await forwardTdfOrders({ ours: ours.client, tdf: tdf.client, settings, alert: vi.fn(), sleep: noSleep, supplierIds: emptyFeed });
    expect(stats.sent).toBe(1);
    expect(ours.state.tags).toEqual([TAG_SENT]);
  });
});
