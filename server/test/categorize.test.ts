import { describe, it, expect } from "vitest";
import { detectCategories, categoryTags } from "../src/shopify/categorize";

describe("определение категории", () => {
  it("сумки по названию", () => {
    expect(detectCategories("GG Marmont small shoulder bag")).toEqual(["bags"]);
    expect(detectCategories("Re-Nylon backpack")).toEqual(["bags"]);
    expect(detectCategories("Large Beau Raffia Tote Bag")).toEqual(["bags"]);
  });

  it("обувь по названию", () => {
    expect(detectCategories("Round-Toe Lace-Up Sneakers")).toEqual(["shoes"]);
    expect(detectCategories("Chelsea Boot")).toEqual(["shoes"]);
  });

  it("платье попадает и в Dresses, и в Clothing", () => {
    const cats = detectCategories("Silk Midi Dress");
    expect(cats).toContain("dresses");
    expect(cats).toContain("clothing");
  });

  it("URL бренда сильнее отсутствия слова в названии", () => {
    expect(detectCategories("Ophidia mini", "https://gucci.com/us/en/c/handbags/x")).toEqual(["bags"]);
  });

  it("детская вещь остаётся и предметной категорией", () => {
    const cats = detectCategories("Kids cotton dress");
    expect(cats).toContain("kids");
    expect(cats).toContain("dresses");
  });

  it("границы слова: laptop не считается топом", () => {
    expect(detectCategories("Laptop sleeve")).not.toContain("clothing");
  });

  it("неоднозначность — лучше ничего, чем неверно", () => {
    // сработали бы и bags, и shoes — доверять нечему
    expect(detectCategories("Sneaker bag")).toEqual([]);
  });

  it("непонятный товар не получает категорию", () => {
    expect(detectCategories("Ophidia mini")).toEqual([]);
    expect(categoryTags("Ophidia mini")).toEqual([]);
  });

  it("теги в формате Shopify", () => {
    expect(categoryTags("Leather Tote")).toEqual(["category:bags"]);
  });
});
