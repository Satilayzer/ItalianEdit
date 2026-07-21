import { describe, it, expect } from "vitest";
import {
  genderTags,
  genderFromTags,
  normalizeGender,
  detectGender,
} from "../src/shopify/gender";

describe("нормализация пола из BrandsGateway", () => {
  it("женское во всех написаниях", () => {
    expect(normalizeGender("Woman")).toBe("women");
    expect(normalizeGender("Women")).toBe("women");
    expect(normalizeGender("female")).toBe("women");
    expect(normalizeGender("  WOMEN  ")).toBe("women");
  });

  it("мужское", () => {
    expect(normalizeGender("Man")).toBe("men");
    expect(normalizeGender("Men")).toBe("men");
    expect(normalizeGender("male")).toBe("men");
  });

  it("унисекс", () => {
    expect(normalizeGender("Unisex")).toBe("unisex");
  });

  it("«woman» не читается как «man»", () => {
    // Ловушка подстроки: woman содержит man, women содержит men.
    // При обратном порядке проверок всё женское уехало бы в мужское.
    expect(normalizeGender("Woman")).not.toBe("men");
    expect(normalizeGender("Women")).not.toBe("men");
  });

  it("пусто и мусор — null", () => {
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender("")).toBeNull();
    expect(normalizeGender("   ")).toBeNull();
    expect(normalizeGender("Home decor")).toBeNull();
  });
});

describe("теги пола", () => {
  it("женское и мужское — по одному тегу", () => {
    expect(genderTags("women")).toEqual(["gender:women"]);
    expect(genderTags("men")).toEqual(["gender:men"]);
  });

  it("унисекс получает все три тега", () => {
    // Иначе выбор Women не показал бы унисекс: маршрут тегов Shopify
    // отбирает по одному тегу, без ИЛИ.
    expect(genderTags("unisex")).toEqual([
      "gender:unisex",
      "gender:women",
      "gender:men",
    ]);
  });

  it("пол не определён — тегов нет", () => {
    expect(genderTags(null)).toEqual([]);
    expect(genderTags(undefined)).toEqual([]);
  });

  it("выбор Women достаёт и унисекс", () => {
    const unisexProduct = genderTags("unisex");
    expect(unisexProduct).toContain("gender:women");
    expect(unisexProduct).toContain("gender:men");
  });
});

describe("чтение пола из тегов", () => {
  it("унисекс важнее женского и мужского", () => {
    expect(genderFromTags(genderTags("unisex"))).toBe("unisex");
  });

  it("обычные случаи", () => {
    expect(genderFromTags(["bg", "gender:women"])).toBe("women");
    expect(genderFromTags(["gender:men", "designer:prada"])).toBe("men");
  });

  it("регистр и пробелы не мешают", () => {
    expect(genderFromTags([" Gender:WOMEN "])).toBe("women");
  });

  it("нет тега — null", () => {
    expect(genderFromTags(["bg", "warehouse:eu"])).toBeNull();
    expect(genderFromTags(["gender:martian"])).toBeNull();
  });
});

describe("определение пола по URL бренда", () => {
  it("английские разделы", () => {
    expect(detectGender("https://gucci.com/us/en/c/women/bags")).toBe("women");
    expect(detectGender("https://prada.com/us/en/men/bags")).toBe("men");
  });

  it("итальянские и другие локали", () => {
    expect(detectGender("https://brand.it/donna/borse")).toBe("women");
    expect(detectGender("https://brand.it/uomo/scarpe")).toBe("men");
    expect(detectGender("https://brand.fr/femme/sacs")).toBe("women");
  });

  it("унисекс важнее прочего", () => {
    expect(detectGender("https://brand.com/unisex/scarves")).toBe("unisex");
  });

  it("раздела в URL нет — null", () => {
    expect(detectGender("https://brand.com/p/12345")).toBeNull();
    expect(detectGender(undefined)).toBeNull();
    expect(detectGender("")).toBeNull();
  });
});
