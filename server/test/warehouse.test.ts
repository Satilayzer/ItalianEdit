import { describe, it, expect } from "vitest";
import {
  warehouseTag,
  warehouseFromTags,
  DEFAULT_WAREHOUSE,
  WAREHOUSE_TAG_PREFIX,
} from "../src/shopify/warehouse";
import { buildTags } from "../src/shopify/products";

describe("тег склада", () => {
  it("склад превращается в тег", () => {
    expect(warehouseTag("eu")).toBe("warehouse:eu");
    expect(warehouseTag("us")).toBe("warehouse:us");
  });

  it("неизвестный склад — европейский по умолчанию", () => {
    expect(warehouseTag(null)).toBe(`${WAREHOUSE_TAG_PREFIX}${DEFAULT_WAREHOUSE}`);
    expect(warehouseTag(undefined)).toBe("warehouse:eu");
  });

  it("склад читается обратно из тегов", () => {
    expect(warehouseFromTags(["bg", "warehouse:us", "designer:prada"])).toBe("us");
    expect(warehouseFromTags(["warehouse:eu"])).toBe("eu");
  });

  it("регистр и пробелы не мешают", () => {
    expect(warehouseFromTags([" Warehouse:US "])).toBe("us");
  });

  it("нет тега склада — null", () => {
    expect(warehouseFromTags(["bg", "designer:gucci"])).toBeNull();
  });

  it("мусорное значение не принимается за склад", () => {
    expect(warehouseFromTags(["warehouse:atlantis"])).toBeNull();
  });
});

describe("теги товара BrandsGateway", () => {
  it("склад US попадает в теги", () => {
    expect(buildTags({ brand: "Gucci", warehouse: "us", gender: null })).toEqual([
      "bg",
      "warehouse:us",
      "designer:gucci",
    ]);
  });

  it("склад не определён — едет европейский", () => {
    expect(buildTags({ brand: null, warehouse: null, gender: null })).toEqual([
      "bg",
      "warehouse:eu",
    ]);
  });

  it("унисекс добавляет женский и мужской тег рядом со складом", () => {
    expect(buildTags({ brand: null, warehouse: "us", gender: "unisex" })).toEqual([
      "bg",
      "warehouse:us",
      "gender:women",
      "gender:men",
    ]);
  });
});
