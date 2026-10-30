/**
 * Цвет и материал для Google Merchant Center — стандартные атрибуты Shopify
 * (категорийные метаполя `shopify.*`).
 *
 * В `mm-google-shopping` приложение Google & YouTube цвета и материала не
 * читает. Их источник — стандартные атрибуты товара: Color (`shopify.color-pattern`)
 * у всех категорий и материал, у каждой группы категорий свой (Fabric у одежды,
 * Footwear material у обуви и т. д.). Значение такого атрибута — ссылка на
 * метаобъект, привязанный к значению таксономии Shopify.
 *
 * Метаобъекты заведены в магазине один раз (30.10.2026, через коннектор): 15 цветов
 * по семействам facets.ts и 17 материалов в каждой из четырёх групп. Читать
 * метаобъекты у серверного приложения прав нет (read_metaobjects), поэтому их
 * GID лежат здесь таблицей. Новый материал или цвет — сначала завести метаобъект
 * (metaobjectUpsert, handle = имя в нижнем регистре через дефис), потом добавить сюда.
 */

import type { ColorFamily } from "./facets";

export type MaterialGroup = "fabric" | "footwear-material" | "bag-case-material" | "clothing-accessory-material";

export const MATERIAL_LABELS = [
  "Cotton", "Wool", "Leather", "Denim", "Polyester", "Cashmere", "Viscose", "Silk", "Nylon",
  "Suede", "Faux leather", "Linen", "PVC", "Faux fur", "Fur", "Velvet", "Metal",
] as const;

export type MaterialLabel = (typeof MATERIAL_LABELS)[number];

const gid = (n: number) => `gid://shopify/Metaobject/${n}`;

/** Значения цвета (метаобъекты shopify--color-pattern). Узор у всех Solid, у Multicolor — Other. */
export const COLOR_ENTRIES: Record<ColorFamily, string> = {
  Black: gid(647585628391),
  White: gid(647585661159),
  Grey: gid(647585693927),
  Beige: gid(647585726695),
  Brown: gid(647585759463),
  Red: gid(647585792231),
  Pink: gid(647585824999),
  Orange: gid(647585857767),
  Yellow: gid(647585890535),
  Green: gid(647585923303),
  Blue: gid(647585956071),
  Purple: gid(647585988839),
  Gold: gid(647586021607),
  Silver: gid(647586054375),
  Multicolor: gid(647586087143),
};

/**
 * Метаобъекты материалов заводились пачкой по группам в порядке MATERIAL_LABELS,
 * и Shopify выдал им GID подряд с шагом 32768 — это сверено с ответом метаобъектов.
 * Таблица ниже разворачивает первый GID группы на все 17 материалов.
 */
const MATERIAL_FIRST_ID: Record<MaterialGroup, number> = {
  fabric: 647586939111,
  "footwear-material": 647587496167,
  "bag-case-material": 647588217063,
  "clothing-accessory-material": 647588774119,
};
const ID_STEP = 32768;

export const MATERIAL_ENTRIES = Object.fromEntries(
  (Object.keys(MATERIAL_FIRST_ID) as MaterialGroup[]).map((group) => [
    group,
    Object.fromEntries(MATERIAL_LABELS.map((label, i) => [label, gid(MATERIAL_FIRST_ID[group] + i * ID_STEP)])),
  ])
) as Record<MaterialGroup, Record<MaterialLabel, string>>;

export const MATERIAL_GROUPS = Object.keys(MATERIAL_FIRST_ID) as MaterialGroup[];

/** Как поставщик пишет материал → наше имя. Остальное совпадает с MATERIAL_LABELS. */
const MATERIAL_ALIASES: Record<string, MaterialLabel> = {
  "eco leather": "Faux leather",
  "eco-leather": "Faux leather",
  "faux leather": "Faux leather",
  "eco fur": "Faux fur",
  "faux fur": "Faux fur",
};

/**
 * Материал из строки описания «Material: Cotton». Такие строки собирает импорт
 * TheDoubleF (productInput.ts) из поля material фида. «Natural fibers»,
 * «Jewellery» и прочее без однозначного соответствия — null: лучше пусто, чем неверно.
 */
export function materialFromDescription(html: string | null | undefined): MaterialLabel | null {
  const m = html?.match(/<li>\s*Material:\s*([^<]+?)\s*<\/li>/i);
  if (!m) return null;
  const raw = m[1].trim().toLowerCase();
  if (MATERIAL_ALIASES[raw]) return MATERIAL_ALIASES[raw];
  return MATERIAL_LABELS.find((l) => l.toLowerCase() === raw) ?? null;
}

/**
 * Группа материала по категории товара: атрибут материала у Shopify свой для
 * каждой ветки таксономии. Сверено с атрибутами узлов (taxonomy.categories):
 * одежда, шляпы, шарфы, галстуки и общий «Clothing Accessories» — Fabric;
 * обувь — Footwear material; сумки и рюкзаки — Bag/Case material; ремни и
 * кошельки — Clothing accessory material. Перчатки, очки, брелоки, украшения —
 * у них свои атрибуты, наших материалов там нет: null, не пишем.
 */
export function materialGroup(categoryId: string | null | undefined): MaterialGroup | null {
  const id = categoryId?.split("/").pop();
  if (!id) return null;
  const under = (node: string) => id === node || id.startsWith(`${node}-`);
  if (under("aa-1") || ["aa-2", "aa-2-17", "aa-2-23", "aa-2-26"].includes(id)) return "fabric";
  if (under("aa-8")) return "footwear-material";
  if (under("aa-5-4") || under("lb-1")) return "bag-case-material";
  if (id === "aa-5-5" || id === "aa-2-6") return "clothing-accessory-material";
  return null;
}

export interface GoogleProductInput {
  categoryId: string | null;
  descriptionHtml: string;
  /** Метаполе italian_edit.color (JSON-список семейств), его ведёт facetStoreProducts. */
  colorFacet: string | null;
}

/** Ключ метаполя shopify.* → значение (JSON-список GID). Ключа нет — не пишем. */
export type ProductAttrValues = Partial<Record<"color-pattern" | MaterialGroup, string>>;

export function computeProductAttrs(p: GoogleProductInput): ProductAttrValues {
  const out: ProductAttrValues = {};

  let families: string[] = [];
  try {
    families = p.colorFacet ? (JSON.parse(p.colorFacet) as string[]) : [];
  } catch {
    families = [];
  }
  const colors = families
    .map((f) => COLOR_ENTRIES[f as ColorFamily])
    .filter((g): g is string => Boolean(g));
  if (colors.length > 0) out["color-pattern"] = JSON.stringify(colors);

  const group = materialGroup(p.categoryId);
  const material = materialFromDescription(p.descriptionHtml);
  if (group && material) out[group] = JSON.stringify([MATERIAL_ENTRIES[group][material]]);

  return out;
}

/** Что записать, чтобы метаполя совпали с вычисленными. Ничего не удаляем. */
export function planProductAttrs(
  wanted: ProductAttrValues,
  current: Partial<Record<string, string | null>>
): { key: keyof ProductAttrValues; value: string }[] {
  return (Object.entries(wanted) as [keyof ProductAttrValues, string][])
    .filter(([key, value]) => current[key] !== value)
    .map(([key, value]) => ({ key, value }));
}
