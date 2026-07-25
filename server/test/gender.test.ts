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

describe("теги пола — формат витрины Women/Men", () => {
  it("женское и мужское — по одному тегу", () => {
    expect(genderTags("women")).toEqual(["Women"]);
    expect(genderTags("men")).toEqual(["Men"]);
  });

  it("унисекс — Women + Men (отдельного unisex-тега нет)", () => {
    expect(genderTags("unisex")).toEqual(["Women", "Men"]);
    expect(genderTags("unisex")).not.toContain("Unisex");
  });

  it("пол не определён — тегов нет", () => {
    expect(genderTags(null)).toEqual([]);
    expect(genderTags(undefined)).toEqual([]);
  });

  it("выбор Women достаёт и унисекс", () => {
    const unisex = genderTags("unisex");
    expect(unisex).toContain("Women");
    expect(unisex).toContain("Men");
  });
});

describe("чтение пола из тегов", () => {
  it("оба тега (Women+Men) читаются как унисекс", () => {
    expect(genderFromTags(genderTags("unisex"))).toBe("unisex");
  });

  it("обычные случаи", () => {
    expect(genderFromTags(["bg", "Women"])).toBe("women");
    expect(genderFromTags(["Men", "designer:prada"])).toBe("men");
  });

  it("регистр и пробелы не мешают", () => {
    expect(genderFromTags([" WOMEN "])).toBe("women");
  });

  it("нет тега пола — null", () => {
    expect(genderFromTags(["bg", "EU"])).toBeNull();
    expect(genderFromTags(["Bags", "Brown"])).toBeNull();
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
