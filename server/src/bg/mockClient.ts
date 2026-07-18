import type { BgClient } from "./client";
import type { BgProduct } from "./types";

/** Тестовый каталог: разные бренды, склады, вариации — без реального API. */
export function sampleCatalog(): BgProduct[] {
  return [
    {
      id: 7503,
      sku: "GG-MARM-01",
      name: "GG Marmont small shoulder bag",
      regular_price: 1800,
      sale_price: 1000,
      stock_quantity: 3,
      brand: { id: 1, name: "Gucci" },
      meta_data: [{ key: "location", value: "Milan, Italy" }],
      updated_at: "2026-07-14T10:00:00Z",
    },
    {
      id: 7528,
      sku: "MK-BAG-77",
      name: "Michael Kors tote bag",
      regular_price: 300,
      sale_price: 180,
      brand: { id: 2, name: "Michael Kors" },
      meta_data: [{ key: "location", value: "Florida" }],
      variations: [
        { id: 7535, sku: "MK-BAG-77-OS", stock_quantity: 5 },
      ],
      updated_at: "2026-07-14T11:00:00Z",
    },
    {
      id: 7601,
      sku: "PRADA-NYL-9",
      name: "Re-Nylon backpack",
      regular_price: 1500,
      sale_price: 950,
      stock_quantity: 1,
      brand: { id: 3, name: "Prada" },
      meta_data: [{ key: "warehouse", value: "Germany" }],
      updated_at: "2026-07-14T12:00:00Z",
    },
  ];
}

/** Мок BgClient: раздаёт заранее заданный каталог, имитирует пагинацию и check-status. */
export function makeMockClient(catalog: BgProduct[]): BgClient {
  return {
    async *iterateProducts() {
      for (const p of catalog) yield p;
    },
    async checkStatuses(ids: number[]) {
      return ids.map((id) => {
        const p = catalog.find((c) => c.id === id);
        return {
          id,
          in_stock: (p?.stock_quantity ?? 0) > 0,
          stock_quantity: p?.stock_quantity ?? 0,
        };
      });
    },
  } as unknown as BgClient;
}
