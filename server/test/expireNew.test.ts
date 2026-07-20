import { describe, it, expect, vi } from "vitest";
import {
  staleBefore,
  staleQuery,
  expireNewProducts,
  NEW_TAG,
  NEW_TTL_DAYS,
} from "../src/shopify/expireNew";
import type { ShopifyClient } from "../src/shopify/client";

const NOW = new Date("2026-07-21T12:00:00.000Z");

/** Заглушка клиента: отдаёт товары по тегу, снятие тега убирает их из выборки. */
function fakeClient(ids: string[], failing: Set<string> = new Set()) {
  const tagged = new Set(ids);
  const calls: string[] = [];
  const client = {
    graphql: vi.fn(async (query: string, vars: Record<string, unknown>) => {
      if (query.includes("FindStaleNew")) {
        calls.push("find");
        return {
          products: {
            nodes: [...tagged].slice(0, 50).map((id) => ({ id })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      }
      const id = vars.id as string;
      calls.push(`remove:${id}`);
      if (failing.has(id)) {
        return { tagsRemove: { userErrors: [{ message: "boom" }] } };
      }
      tagged.delete(id);
      return { tagsRemove: { userErrors: [] } };
    }),
  } as unknown as ShopifyClient;
  return { client, tagged, calls };
}

describe("истечение метки «новинка»", () => {
  it("граница считается от TTL в днях", () => {
    expect(staleBefore(NOW, 14)).toBe("2026-07-07T12:00:00.000Z");
  });

  it("TTL по умолчанию — 14 дней", () => {
    expect(NEW_TTL_DAYS).toBe(14);
    expect(staleBefore(NOW)).toBe(staleBefore(NOW, 14));
  });

  it("запрос ищет по тегу и дате создания", () => {
    const q = staleQuery(NOW);
    expect(q).toContain(`tag:'${NEW_TAG}'`);
    expect(q).toContain("created_at:<'2026-07-07T12:00:00.000Z'");
  });

  it("снимает тег со всех найденных товаров", async () => {
    const { client, tagged } = fakeClient(["gid://p/1", "gid://p/2", "gid://p/3"]);
    const res = await expireNewProducts(client, { now: NOW });
    expect(res.expired).toBe(3);
    expect(res.errors).toEqual([]);
    expect(tagged.size).toBe(0);
  });

  it("пустая выборка — ни одного запроса на снятие", async () => {
    const { client, calls } = fakeClient([]);
    const res = await expireNewProducts(client, { now: NOW });
    expect(res.expired).toBe(0);
    expect(calls.filter((c) => c.startsWith("remove"))).toEqual([]);
  });

  it("товар с ошибкой не обрабатывается повторно", async () => {
    // p/2 не снимается и остаётся в выборке — цикл не должен зациклиться
    const { client, calls } = fakeClient(
      ["gid://p/1", "gid://p/2"],
      new Set(["gid://p/2"])
    );
    const res = await expireNewProducts(client, { now: NOW });
    expect(res.expired).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(calls.filter((c) => c === "remove:gid://p/2")).toHaveLength(1);
  });

  it("ошибка одного товара не срывает обработку остальных", async () => {
    const { client, tagged } = fakeClient(
      ["gid://p/1", "gid://p/2", "gid://p/3"],
      new Set(["gid://p/1"])
    );
    const res = await expireNewProducts(client, { now: NOW });
    expect(res.expired).toBe(2);
    expect(tagged.has("gid://p/1")).toBe(true);
  });
});
