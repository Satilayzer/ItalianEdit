/**
 * Определение категории товара для автоколлекций магазина.
 *
 * Менеджер категорию не присылает (формат сообщения — название/вариация/дизайнер/цена),
 * поэтому выводим её из названия товара и URL страницы бренда.
 *
 * Осознанно НЕ смотрим в описание: там слишком много ложных срабатываний
 * («faceted chain strap» у сумки → jewelry, «leather trim» → accessories).
 *
 * Если уверенности нет — тегов не ставим вовсе. Товар всё равно попадёт
 * в коллекцию New (по тегу new), и категорию проставит менеджер вручную.
 * Молча угадать неправильно хуже, чем не угадать.
 */

export const CATEGORY_TAG_PREFIX = "category:";

/** Подкатегории одежды — вложены в Clothing в меню магазина. */
export type ClothingSubcategory =
  | "dresses"
  | "tops"
  | "swimwear"
  | "jeans"
  | "sweaters"
  | "jackets"
  | "pants"
  | "skirts"
  | "shorts"
  | "matching-sets"
  | "pajamas"
  | "lingerie";

/** Предметные категории верхнего уровня, кроме одежды. */
export type GoodsCategory = "bags" | "shoes" | "jewelry" | "accessories";

export type Category = ClothingSubcategory | GoodsCategory | "clothing" | "kids";

/**
 * Подкатегории одежды в порядке приоритета: побеждает первая совпавшая.
 * Порядок разрешает пересечения по словам, а не отбрасывает товар:
 *   «shirt dress»  → dresses, а не tops
 *   «slip dress»   → dresses, а не lingerie
 *   «denim jacket» → jackets (поэтому в jeans только «jean», без «denim»)
 */
const CLOTHING_KEYWORDS: [ClothingSubcategory, string[]][] = [
  ["matching-sets", ["matching set", "co-ord", "coord set", "twin set", "two-piece set"]],
  ["swimwear", ["swimsuit", "swimwear", "bikini", "one-piece swim", "cover-up", "sarong"]],
  ["dresses", ["dress", "gown", "kaftan", "caftan"]],
  ["pajamas", ["pajama", "pyjama", "nightgown", "nightdress", "robe", "sleepwear"]],
  ["lingerie", ["lingerie", "bra", "bralette", "thong", "shapewear", "corset", "bustier", "slip", "brief"]],
  ["jeans", ["jean"]],
  ["skirts", ["skirt"]],
  ["shorts", ["short", "bermuda"]],
  ["sweaters", ["sweater", "jumper", "pullover", "cardigan", "knit", "turtleneck"]],
  ["jackets", ["jacket", "blazer", "coat", "trench", "parka", "puffer", "bomber", "peacoat", "cape", "poncho"]],
  ["pants", ["pants", "trousers", "chinos", "leggings", "jumpsuit", "culottes"]],
  ["tops", ["top", "blouse", "shirt", "t-shirt", "tee", "tank", "camisole", "bodysuit", "vest", "waistcoat", "hoodie", "sweatshirt"]],
];

/** Предметные категории — взаимоисключающие между собой. */
const GOODS_KEYWORDS: [GoodsCategory, string[]][] = [
  ["bags", ["bag", "tote", "backpack", "clutch", "pouch", "satchel", "hobo", "crossbody", "shopper", "duffle", "duffel", "briefcase", "purse"]],
  ["shoes", ["sneaker", "trainer", "boot", "bootie", "pump", "loafer", "sandal", "heel", "mule", "ballerina", "ballet flat", "espadrille", "derby", "oxford", "brogue", "moccasin", "slipper", "clog"]],
  ["jewelry", ["necklace", "bracelet", "earring", "ring", "pendant", "brooch", "choker", "cufflink", "anklet"]],
  ["accessories", ["belt", "scarf", "foulard", "hat", "cap", "beanie", "glove", "mitten", "sunglasses", "eyewear", "wallet", "cardholder", "card holder", "keychain", "key ring", "tie", "bow tie", "umbrella"]],
];

const KIDS_KEYWORDS = ["kids", "children", "childrens", "baby", "toddler", "girls", "boys"];

/** Куски URL-путей брендовых сайтов — сигнал сильнее, чем название. */
const URL_HINTS: Partial<Record<Category, string[]>> = {
  dresses: ["/dresses", "/dress"],
  tops: ["/tops", "/shirts", "/blouses"],
  swimwear: ["/swimwear", "/swim", "/beachwear"],
  jeans: ["/jeans", "/denim"],
  sweaters: ["/sweaters", "/knitwear"],
  jackets: ["/jackets", "/coats", "/outerwear", "/blazers"],
  pants: ["/pants", "/trousers"],
  skirts: ["/skirts"],
  shorts: ["/shorts"],
  pajamas: ["/pajamas", "/sleepwear", "/nightwear"],
  lingerie: ["/lingerie", "/underwear"],
  clothing: ["/clothing", "/apparel", "/ready-to-wear", "/rtw"],
  shoes: ["/shoes", "/footwear", "/sneakers"],
  bags: ["/bags", "/handbags", "/leather-goods"],
  jewelry: ["/jewelry", "/jewellery", "/fine-jewelry"],
  accessories: ["/accessories", "/eyewear", "/sunglasses"],
  kids: ["/kids", "/children", "/junior"],
};

/** Проверяет вхождение слова с границами — чтобы «top» не ловился в «laptop». */
function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(s|es)?([^a-z]|$)`, "i").test(haystack);
}

function matches(
  category: Category,
  keywords: string[],
  name: string,
  path: string
): boolean {
  if ((URL_HINTS[category] ?? []).some((hint) => path.includes(hint))) return true;
  return keywords.some((word) => hasWord(name, word));
}

/**
 * Возвращает категории товара — подкатегория одежды идёт вместе с `clothing`,
 * чтобы товар попал и в свой раздел, и в «All Clothing».
 * Пустой массив означает «не определили».
 */
export function detectCategories(title: string, url?: string): Category[] {
  const name = ` ${title.toLowerCase()} `;
  const path = (url ?? "").toLowerCase();
  const result: Category[] = [];

  // Одежда: побеждает одна подкатегория — первая по приоритету.
  const clothingHit = CLOTHING_KEYWORDS.find(([cat, words]) =>
    matches(cat, words, name, path)
  );
  if (clothingHit) {
    result.push(clothingHit[0], "clothing");
  } else if (matches("clothing", [], name, path)) {
    // URL говорит «одежда», но что именно — непонятно: только All Clothing.
    result.push("clothing");
  }

  // Предметные категории: несколько совпадений — доверять нечему.
  // Но если товар уже опознан как одежда, они игнорируются: в «bootcut jeans»
  // слово boot к обуви отношения не имеет.
  if (result.length === 0) {
    const goodsHits = GOODS_KEYWORDS.filter(([cat, words]) =>
      matches(cat, words, name, path)
    );
    if (goodsHits.length === 1) result.push(goodsHits[0][0]);
  }

  // Детское — поперечная категория: детское платье живёт и в Kids, и в Dresses.
  if (matches("kids", KIDS_KEYWORDS, name, path)) result.push("kids");

  return result;
}

/** Готовые теги вида `category:bags` для Shopify. */
export function categoryTags(title: string, url?: string): string[] {
  return detectCategories(title, url).map((c) => `${CATEGORY_TAG_PREFIX}${c}`);
}
