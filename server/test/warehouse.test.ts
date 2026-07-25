import { describe, it, expect } from "vitest";
import {
  warehouseTag,
  warehouseFromTags,
  DEFAULT_WAREHOUSE,
} from "../src/shopify/warehouse";
import { buildTags } from "../src/shopify/products";

describe("тег склада", () => {
  it("склад превращается в тег в формате витрины (EU/US)", () => {
    expect(warehouseTag("eu")).toBe("EU");
    expect(warehouseTag("us")).toBe("US");
  });

  it("неизвестный склад — европейский по умолчанию", () => {
    expect(DEFAULT_WAREHOUSE).toBe("eu");
    expect(warehouseTag(null)).toBe("EU");
    expect(warehouseTag(undefined)).toBe("EU");
  });

  it("склад читается обратно из тегов", () => {
    expect(warehouseFromTags(["bg", "US", "designer:prada"])).toBe("us");
    expect(warehouseFromTags(["EU"])).toBe("eu");
  });

  it("регистр и пробелы не мешают", () => {
    expect(warehouseFromTags([" us "])).toBe("us");
  });

  it("нет тега склада — null", () => {
    expect(warehouseFromTags(["bg", "designer:gucci"])).toBeNull();
  });

  it("размерный тег с EU/US не принимается за склад", () => {
    // у товаров приложения есть размеры вида "EU37/US7" — не путаем со складом
    expect(warehouseFromTags(["EU37/US7", "Bags"])).toBeNull();
  });
});

describe("теги товара BrandsGateway", () => {
  it("склад US попадает в теги", () => {
    expect(buildTags({ brand: "Gucci", warehouse: "us", gender: null })).toEqual([
      "bg",
      "US",
      "designer:gucci",
    ]);
  });

  it("склад не определён — едет европейский", () => {
    expect(buildTags({ brand: null, warehouse: null, gender: null })).toEqual([
      "bg",
      "EU",
    ]);
  });

  it("унисекс добавляет женский и мужской тег рядом со складом", () => {
    expect(buildTags({ brand: null, warehouse: "us", gender: "unisex" })).toEqual([
      "bg",
      "US",
      "Women",
      "Men",
    ]);
  });
});
