/**
 * Значения для фильтров витрины, которых нет в «сырых» полях товара.
 *
 * Фильтры каталога строит Shopify Search & Discovery. Цену, наличие, размер
 * (опция варианта) и дизайнера (vendor) он берёт из товара сам, а вот пол,
 * подкатегорию, цвет и скидку — только из метаполей. Здесь мы выводим их
 * из тегов, опций, описания BG и цен; задача facetStoreProducts кладёт
 * результат в метаполя `italian_edit.*`.
 *
 * Главное — цвет. Поставщик пишет оттенок как есть: Emerald, Lime, Olive,
 * Bordeaux, Ecru… Покупатель же ищет «зелёное», поэтому каждый оттенок
 * сводится к базовому семейству (Green, Red, White…) по словарю ниже.
 */

import { genderFromTags } from "./gender";

/** Семейства цвета — ровно эти значения видит покупатель в фильтре Color. */
export const COLOR_FAMILIES = [
  "Black",
  "White",
  "Grey",
  "Beige",
  "Brown",
  "Red",
  "Pink",
  "Orange",
  "Yellow",
  "Green",
  "Blue",
  "Purple",
  "Gold",
  "Silver",
  "Multicolor",
] as const;

export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/**
 * Оттенок → семейство. Ключи в нижнем регистре; фразы из нескольких слов
 * проверяются раньше одиночных слов (см. colorFamilies), поэтому «rose gold»
 * уходит в Gold, а не в Pink, и «off white» не превращается в «white» + мусор.
 *
 * Спорные оттенки разложены так, как их раскладывают крупные люкс-площадки:
 * khaki — зелёный, camel и nude — бежевый, teal и turquoise — синий, coral — оранжевый.
 */
const SHADES: Record<string, ColorFamily> = {
  // ── Black ──
  black: "Black", jet: "Black", onyx: "Black", ebony: "Black", noir: "Black",
  nero: "Black", "чёрный": "Black", "черный": "Black",

  // ── White ──
  white: "White", ivory: "White", "off white": "White", "off-white": "White",
  "optic white": "White", "optical white": "White", snow: "White", chalk: "White",
  milk: "White", bianco: "White", blanc: "White", "белый": "White",

  // ── Grey ──
  grey: "Grey", gray: "Grey", charcoal: "Grey", anthracite: "Grey", graphite: "Grey",
  slate: "Grey", ash: "Grey", smoke: "Grey", pewter: "Grey", grigio: "Grey",
  melange: "Grey", "серый": "Grey",

  // ── Beige ──
  beige: "Beige", cream: "Beige", ecru: "Beige", sand: "Beige", camel: "Beige",
  nude: "Beige", taupe: "Beige", stone: "Beige", oatmeal: "Beige", natural: "Beige",
  champagne: "Beige", biscuit: "Beige", vanilla: "Beige", "бежевый": "Beige",

  // ── Brown ──
  brown: "Brown", chocolate: "Brown", cognac: "Brown", tan: "Brown", coffee: "Brown",
  mocha: "Brown", espresso: "Brown", chestnut: "Brown", caramel: "Brown",
  hazelnut: "Brown", walnut: "Brown", tobacco: "Brown", rust: "Brown", marrone: "Brown",
  "коричневый": "Brown",

  // ── Red ──
  red: "Red", burgundy: "Red", bordeaux: "Red", wine: "Red", maroon: "Red",
  cherry: "Red", scarlet: "Red", crimson: "Red", ruby: "Red", oxblood: "Red",
  carmine: "Red", rosso: "Red", "красный": "Red", "бордовый": "Red",

  // ── Pink ──
  pink: "Pink", rose: "Pink", blush: "Pink", fuchsia: "Pink", magenta: "Pink",
  "powder pink": "Pink", salmon: "Pink", peony: "Pink", rosa: "Pink",
  "розовый": "Pink",

  // ── Orange ──
  orange: "Orange", coral: "Orange", tangerine: "Orange", apricot: "Orange",
  peach: "Orange", terracotta: "Orange", amber: "Orange", arancione: "Orange",
  "оранжевый": "Orange",

  // ── Yellow ──
  yellow: "Yellow", mustard: "Yellow", lemon: "Yellow", canary: "Yellow",
  ochre: "Yellow", butter: "Yellow", giallo: "Yellow", "жёлтый": "Yellow",
  "желтый": "Yellow",

  // ── Green ──
  green: "Green", emerald: "Green", lime: "Green", olive: "Green", khaki: "Green",
  mint: "Green", sage: "Green", forest: "Green", bottle: "Green", jade: "Green",
  pistachio: "Green", moss: "Green", military: "Green", army: "Green", fern: "Green",
  "bottle green": "Green", "army green": "Green", verde: "Green",
  "зелёный": "Green", "зеленый": "Green", "изумрудный": "Green",
  "салатовый": "Green", "оливковый": "Green", "мятный": "Green", "хаки": "Green",

  // ── Blue ──
  blue: "Blue", navy: "Blue", cobalt: "Blue", azure: "Blue", denim: "Blue",
  indigo: "Blue", sky: "Blue", royal: "Blue", teal: "Blue", turquoise: "Blue",
  aqua: "Blue", cyan: "Blue", petrol: "Blue", sapphire: "Blue", cerulean: "Blue",
  "light blue": "Blue", "navy blue": "Blue", blu: "Blue", azzurro: "Blue",
  "синий": "Blue", "голубой": "Blue",

  // ── Purple ──
  purple: "Purple", violet: "Purple", lilac: "Purple", lavender: "Purple",
  plum: "Purple", mauve: "Purple", aubergine: "Purple", grape: "Purple",
  orchid: "Purple", viola: "Purple", "фиолетовый": "Purple", "сиреневый": "Purple",

  // ── Gold / Silver ──
  gold: "Gold", golden: "Gold", "rose gold": "Gold", brass: "Gold", bronze: "Gold",
  oro: "Gold", "золотой": "Gold",
  silver: "Silver", "silver-tone": "Silver", metallic: "Silver", chrome: "Silver",
  platinum: "Silver", argento: "Silver", "серебряный": "Silver",

  // ── Multicolor ──
  multicolor: "Multicolor", multicolour: "Multicolor", multi: "Multicolor",
  "multi-color": "Multicolor", "multi-colour": "Multicolor", rainbow: "Multicolor",
  multicolore: "Multicolor", "разноцветный": "Multicolor",
};

/**
 * Слова, которые в названии товара чаще значат не цвет: «natural leather»,
 * «mint condition», «military jacket», «denim jacket», «coral beads».
 * В тегах, опции и описании BG это цвет, а из названия их не берём.
 */
const AMBIGUOUS_IN_TITLE = new Set([
  "natural", "stone", "sand", "smoke", "ash", "milk", "butter", "forest", "bottle",
  "military", "army", "jet", "chalk", "tobacco", "rust", "petrol", "moss", "fern",
  "grape", "orchid", "peony", "lemon", "mint", "jade", "amber", "coral", "ruby",
  "sapphire", "onyx", "cherry", "wine", "royal", "sky", "metallic", "chrome", "denim",
  "snow", "biscuit", "vanilla", "oatmeal", "ebony", "champagne", "caramel", "coffee",
]);

/** Фразы из нескольких слов — проверяем первыми, по убыванию длины. */
const PHRASES = Object.keys(SHADES)
  .filter((k) => /[\s-]/.test(k))
  .sort((a, b) => b.length - a.length);

const PHRASE_RES = PHRASES.map((phrase) => ({
  phrase,
  // «off white», «off-white» и «offwhite» — одно и то же.
  re: new RegExp(`(?<!\\p{L})${phrase.replace(/[\s-]/g, "[-\\s]?")}(?!\\p{L})`, "gu"),
}));

/**
 * Семейства цвета в строке («Emerald Green» → Green, «Black/White» → Black, White).
 * Порядок — по первому появлению; повторы схлопываются.
 * strict — режим для названия товара: двусмысленные слова пропускаются.
 */
export function colorFamiliesIn(text: string, strict = false): ColorFamily[] {
  let rest = text.toLowerCase();
  const found: { at: number; family: ColorFamily }[] = [];

  for (const { phrase, re } of PHRASE_RES) {
    rest = rest.replace(re, (m: string, offset: number) => {
      found.push({ at: offset, family: SHADES[phrase] });
      return " ".repeat(m.length);
    });
  }

  for (const m of rest.matchAll(/\p{L}+/gu)) {
    const word = m[0];
    if (strict && AMBIGUOUS_IN_TITLE.has(word)) continue;
    const family = SHADES[word];
    if (family) found.push({ at: m.index ?? 0, family });
  }

  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.family))];
}

/** Название опции похоже на цвет. */
function isColorOption(name: string): boolean {
  return /colou?r|colore|couleur|farbe|цвет/i.test(name);
}

/** Служебный тег, в котором слово-цвет — случайность: бренд, категория, склад. */
function isServiceTag(tag: string): boolean {
  return tag.includes(":") || tag.includes(" - ") || /\d/.test(tag);
}

export interface ColorSource {
  title: string;
  vendor?: string | null;
  tags: string[];
  options?: { name: string; values: string[] }[];
  /** Цвет из описания BG («… in Emerald Green is a …»), если удалось разобрать. */
  descriptionColor?: string | null;
}

/** Больше стольких семейств у одного товара — это уже «Multicolor». */
const MULTICOLOR_THRESHOLD = 3;

/**
 * Семейства цвета товара. Источники по убыванию доверия — берём первый,
 * давший результат, а не сумму: тег «Black» и случайное «Gold» в названии
 * («… with gold hardware») не должны превратить чёрную сумку в золотую.
 *
 *  1. опция варианта «Color» — у товара несколько цветов, все честные;
 *  2. теги (у BG цвет приходит отдельным тегом: «Pink», «Black»);
 *  3. цвет из описания BG;
 *  4. название товара без имени бренда (Off-White, Golden Goose — бренды, не цвета).
 */
export function colorFamilies(src: ColorSource): ColorFamily[] {
  const fromOptions = (src.options ?? [])
    .filter((o) => isColorOption(o.name))
    .flatMap((o) => o.values.flatMap((v) => colorFamiliesIn(v)));

  const vendor = src.vendor?.trim().toLowerCase();
  const fromTags = src.tags
    .filter((t) => !isServiceTag(t) && t.trim().toLowerCase() !== vendor)
    .flatMap((t) => colorFamiliesIn(t));

  const fromDescription = src.descriptionColor ? colorFamiliesIn(src.descriptionColor) : [];

  let title = src.title;
  if (src.vendor) title = title.replace(new RegExp(escapeRegExp(src.vendor), "gi"), " ");
  const fromTitle = colorFamiliesIn(title, true);

  const picked = [fromOptions, fromTags, fromDescription, fromTitle].find((list) => list.length > 0) ?? [];
  const unique = [...new Set(picked)];
  if (unique.includes("Multicolor") || unique.length > MULTICOLOR_THRESHOLD) return ["Multicolor"];
  return unique;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Пол для фильтра Gender: Women / Men (унисекс — оба), плюс Kids, если у товара
 * есть детский тег. Теги пола ставят приложение BG и бот — см. gender.ts.
 */
export function genderValues(tags: string[]): string[] {
  const values: string[] = [];
  const gender = genderFromTags(tags);
  if (gender === "women" || gender === "unisex") values.push("Women");
  if (gender === "men" || gender === "unisex") values.push("Men");
  const lower = tags.map((t) => t.trim().toLowerCase());
  if (lower.some((t) => t === "kids" || t === "category:kids" || t.endsWith(" - kids"))) {
    values.push("Kids");
  }
  return values;
}

/** Верхний уровень каталога — это раздел меню, а не подкатегория. */
const TOP_LEVEL = new Set(["clothing", "shoes", "bags", "accessories"]);

/** Как показывать сегмент тега BG покупателю, если «как есть» некрасиво. */
const SUBCATEGORY_LABELS: Record<string, string> = {
  "jeans denim": "Jeans",
  jewellery: "Jewelry",
  "matching-sets": "Matching Sets",
};

function subcategoryLabel(segment: string): string {
  const key = segment.trim().toLowerCase();
  if (SUBCATEGORY_LABELS[key]) return SUBCATEGORY_LABELS[key];
  return key
    .replace(/-/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Подкатегория — второй уровень иерархии BG, сразу под разделом меню:
 * «Platforms - Sandals - Shoes» → Sandals, «Dresses - Clothing» → Dresses.
 * Третий уровень слишком дробный для фильтра (Mid Heel, Platforms), верхний
 * совпадает с самой коллекцией. Легаси-теги бота `category:*` — как есть,
 * кроме разделов верхнего уровня.
 */
export function subcategoryValues(tags: string[]): string[] {
  const values = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.includes(" - ")) {
      const chain = tag.split(" - ");
      values.add(subcategoryLabel(chain[chain.length - 2]));
      continue;
    }
    const legacy = tag.toLowerCase().match(/^category:(.+)$/);
    if (legacy && !TOP_LEVEL.has(legacy[1])) values.add(subcategoryLabel(legacy[1]));
  }
  return [...values];
}

/**
 * Диапазоны цены для фильтра Price у покупателей в евро.
 *
 * Свой фильтр цены Shopify показывает только в основной валюте магазина (USD):
 * у посетителя из рынка International EUR его просто нет. Поэтому кладём
 * товару диапазон его евро-цены, а витрина показывает этот фильтр как Price,
 * когда штатного нет. Коды обязаны совпадать с настройкой «Диапазоны цены»
 * блока filters в теме (там же по ним строятся подписи «€500 – €1,000»).
 */
export const PRICE_BANDS = ["0-500", "500-1000", "1000-2000", "2000-5000", "5000+"] as const;

/** Страна, чьей ценой меряем диапазон: рынок International EUR. */
export const PRICE_BAND_COUNTRY = "IT";

/** Диапазон по самой низкой цене товара («от …» на карточке). null — цены нет. */
export function priceBand(prices: number[]): string | null {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) return null;
  const price = Math.min(...valid);
  for (const band of PRICE_BANDS) {
    if (band.endsWith("+")) return band;
    const [lo, hi] = band.split("-").map(Number);
    if (price >= lo && price < hi) return band;
  }
  return null;
}

/** Полосы скидки в фильтре Sale. Порядок здесь = порядок на витрине. */
export const SALE_BANDS = ["Up to 30% off", "30–50% off", "50%+ off"] as const;

export interface PricedVariant {
  price: string;
  compareAtPrice: string | null;
}

/**
 * Полоса скидки по самому выгодному варианту. null — товар не со скидкой.
 * Скидка меньше 1% (округления цен) скидкой не считается.
 */
export function saleBand(variants: PricedVariant[]): string | null {
  let best = 0;
  for (const v of variants) {
    const price = Number(v.price);
    const was = Number(v.compareAtPrice);
    if (!was || !(was > price)) continue;
    best = Math.max(best, ((was - price) / was) * 100);
  }
  if (best < 1) return null;
  if (best < 30) return SALE_BANDS[0];
  if (best < 50) return SALE_BANDS[1];
  return SALE_BANDS[2];
}
