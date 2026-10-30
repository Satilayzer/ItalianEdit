import { describe, it, expect } from "vitest";
import { resolveCategory, categoryPatch } from "../src/shopify/category";

/** Короткая запись: сравниваем по хвосту gid, а не по всей строке. */
function node(assignment: { taxonomyId: string } | null): string | null {
  return assignment ? (assignment.taxonomyId.split("/").pop() ?? null) : null;
}

describe("новые правила категорий", () => {
  it("очки, шляпы, рюкзаки, комбинезоны, лейсапы", () => {
    expect(node(resolveCategory(["Accessories", "Sunglasses - Accessories"]))).toBe("aa-2-27");
    expect(node(resolveCategory(["Accessories", "Hats - Accessories"]))).toBe("aa-2-17");
    expect(node(resolveCategory(["Accessories", "Bag Charms - Accessories"]))).toBe("aa-4-8");
    expect(node(resolveCategory(["Bags", "Backpacks - Bags"]))).toBe("lb-1");
    expect(node(resolveCategory(["Clothing", "Jumpsuits - Clothing"]))).toBe("aa-1-9");
    expect(node(resolveCategory(["Clothing", "Suits - Clothing"]))).toBe("aa-1-19");
    expect(node(resolveCategory(["Clothing", "Shorts - Clothing"]))).toBe("aa-1-14");
    expect(node(resolveCategory(["Shoes", "Lace-Ups - Shoes"]))).toBe("aa-8-9");
  });
});

describe("categoryPatch — refineGeneric", () => {
  const generic = {
    tags: ["Accessories", "Sunglasses - Accessories", "Women"],
    category: { id: "gid://shopify/TaxonomyCategory/aa-2" },
    productType: "Clothing Accessories",
  };

  it("без флага общую категорию не трогаем", () => {
    expect(categoryPatch(generic)).toBeNull();
  });

  it("с флагом уточняем и категорию, и тип, если оба наши запасные", () => {
    expect(categoryPatch(generic, { refineGeneric: true })).toEqual({
      category: "gid://shopify/TaxonomyCategory/aa-2-27",
      productType: "Sunglasses",
    });
  });

  it("рюкзак: запасной узел — Handbags из тега Bags", () => {
    expect(
      categoryPatch(
        {
          tags: ["Bags", "Backpacks - Bags"],
          category: { id: "gid://shopify/TaxonomyCategory/aa-5-4" },
          productType: "Handbags",
        },
        { refineGeneric: true }
      )
    ).toEqual({ category: "gid://shopify/TaxonomyCategory/lb-1", productType: "Backpacks" });
  });

  it("тип, поставленный руками, остаётся", () => {
    expect(categoryPatch({ ...generic, productType: "Eyewear" }, { refineGeneric: true })).toEqual({
      category: "gid://shopify/TaxonomyCategory/aa-2-27",
    });
  });

  it("категория не равна запасной — считаем ручной, не трогаем", () => {
    expect(
      categoryPatch(
        { ...generic, category: { id: "gid://shopify/TaxonomyCategory/aa-6" } },
        { refineGeneric: true }
      )
    ).toBeNull();
  });

  it("мюли: частного узла нет — остаются на Shoes", () => {
    expect(
      categoryPatch(
        {
          tags: ["Shoes", "Mules - Shoes"],
          category: { id: "gid://shopify/TaxonomyCategory/aa-8" },
          productType: "Shoes",
        },
        { refineGeneric: true }
      )
    ).toBeNull();
  });
});
