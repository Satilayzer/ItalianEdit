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

  it("URL бренда сильнее отсутствия слова в названии", () => {
    expect(detectCategories("Ophidia mini", "https://gucci.com/us/en/c/handbags/x")).toEqual(["bags"]);
  });

  it("неоднозначность среди предметных категорий — лучше ничего", () => {
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

describe("подкатегории одежды", () => {
  it("каждая подкатегория идёт вместе с clothing", () => {
    expect(detectCategories("Silk Midi Dress")).toEqual(["dresses", "clothing"]);
    expect(detectCategories("Cotton Poplin Blouse")).toEqual(["tops", "clothing"]);
    expect(detectCategories("Cashmere Sweater")).toEqual(["sweaters", "clothing"]);
    expect(detectCategories("Wool Blazer")).toEqual(["jackets", "clothing"]);
    expect(detectCategories("Pleated Skirt")).toEqual(["skirts", "clothing"]);
    expect(detectCategories("Tailored Trousers")).toEqual(["pants", "clothing"]);
    expect(detectCategories("Linen Shorts")).toEqual(["shorts", "clothing"]);
    expect(detectCategories("Straight-Leg Jeans")).toEqual(["jeans", "clothing"]);
    expect(detectCategories("Triangle Bikini")).toEqual(["swimwear", "clothing"]);
    expect(detectCategories("Silk Pajama Set")).toEqual(["pajamas", "clothing"]);
    expect(detectCategories("Lace Bralette")).toEqual(["lingerie", "clothing"]);
    expect(detectCategories("Knit Matching Set")).toEqual(["matching-sets", "clothing"]);
  });

  it("приоритет разрешает пересечения слов", () => {
    // «dress» важнее «shirt» и «slip»
    expect(detectCategories("Striped Shirt Dress")).toEqual(["dresses", "clothing"]);
    expect(detectCategories("Satin Slip Dress")).toEqual(["dresses", "clothing"]);
    // «slip» без «dress» — всё-таки бельё
    expect(detectCategories("Silk Slip")).toEqual(["lingerie", "clothing"]);
    // «denim» не тянет в jeans, иначе джинсовка попала бы не туда
    expect(detectCategories("Denim Jacket")).toEqual(["jackets", "clothing"]);
    // «knit» не перебивает платье
    expect(detectCategories("Knit Dress")).toEqual(["dresses", "clothing"]);
  });

  it("одежда перебивает случайное слово из предметных категорий", () => {
    // «boot» в bootcut — не обувь
    expect(detectCategories("Bootcut Jeans")).toEqual(["jeans", "clothing"]);
    // «ring» в drawstring — не украшение
    expect(detectCategories("Drawstring Shorts")).toEqual(["shorts", "clothing"]);
  });

  it("URL раздела одежды без понятного названия — только All Clothing", () => {
    expect(
      detectCategories("Vivienne", "https://brand.com/en/ready-to-wear/vivienne")
    ).toEqual(["clothing"]);
  });

  it("URL подкатегории точнее названия", () => {
    expect(
      detectCategories("Marina", "https://brand.com/c/women-s-apparel/skirts/marina")
    ).toEqual(["skirts", "clothing"]);
  });

  it("границы слова: laptop не считается топом", () => {
    expect(detectCategories("Laptop sleeve")).not.toContain("tops");
  });
});

describe("детская категория", () => {
  it("детское платье попадает и в Kids, и в Dresses", () => {
    const cats = detectCategories("Kids cotton dress");
    expect(cats).toContain("kids");
    expect(cats).toContain("dresses");
    expect(cats).toContain("clothing");
  });

  it("детская обувь остаётся обувью", () => {
    const cats = detectCategories("Baby leather sneakers");
    expect(cats).toContain("kids");
    expect(cats).toContain("shoes");
  });
});
