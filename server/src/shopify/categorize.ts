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
 * в коллекцию New (по тегу tg-bot), и категорию проставит менеджер вручную.
 * Молча угадать неправильно хуже, чем не угадать.
 */

export const CATEGORY_TAG_PREFIX = "category:";

export type Category =
  | "bags"
  | "shoes"
  | "clothing"
  | "dresses"
  | "jewelry"
  | "accessories"
  | "kids";

/**
 * Ключевые слова по категориям. Порядок внутри массива роли не играет,
 * порядок проверки категорий задаётся в detectCategories.
 */
const KEYWORDS: Record<Category, string[]> = {
  dresses: ["dress", "gown", "kaftan", "caftan"],
  clothing: [
    "coat", "jacket", "blazer", "trench", "parka", "puffer", "cardigan",
    "sweater", "jumper", "knit", "hoodie", "sweatshirt", "shirt", "blouse",
    "top", "t-shirt", "tee", "trousers", "pants", "jeans", "shorts", "skirt",
    "suit", "vest", "waistcoat", "jumpsuit", "cape", "poncho",
  ],
  shoes: [
    "sneaker", "trainer", "boot", "bootie", "pump", "loafer", "sandal",
    "heel", "mule", "ballerina", "ballet flat", "espadrille", "derby",
    "oxford", "brogue", "moccasin", "slipper", "clog",
  ],
  bags: [
    "bag", "tote", "backpack", "clutch", "pouch", "satchel", "hobo",
    "crossbody", "shopper", "duffle", "duffel", "briefcase", "purse",
  ],
  jewelry: [
    "necklace", "bracelet", "earring", "ring", "pendant", "brooch",
    "choker", "cufflink", "anklet",
  ],
  accessories: [
    "belt", "scarf", "foulard", "hat", "cap", "beanie", "glove", "mitten",
    "sunglasses", "eyewear", "wallet", "cardholder", "card holder",
    "keychain", "key ring", "tie", "bow tie", "umbrella",
  ],
  kids: ["kids", "children", "childrens", "baby", "toddler", "girls", "boys"],
};

/** Куски URL-путей брендовых сайтов — сигнал сильнее, чем название. */
const URL_HINTS: Record<Category, string[]> = {
  dresses: ["/dresses", "/dress"],
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

/**
 * Возвращает категории товара — от самой узкой к широкой.
 * Пустой массив означает «не определили».
 */
export function detectCategories(title: string, url?: string): Category[] {
  const name = ` ${title.toLowerCase()} `;
  const path = (url ?? "").toLowerCase();
  const found = new Set<Category>();

  for (const category of Object.keys(KEYWORDS) as Category[]) {
    const byUrl = URL_HINTS[category].some((hint) => path.includes(hint));
    const byName = KEYWORDS[category].some((word) => hasWord(name, word));
    if (byUrl || byName) found.add(category);
  }

  // Платье — это одежда: товар должен попасть и в Dresses, и в Clothing,
  // как в меню, где Dresses вложен в Clothing.
  if (found.has("dresses")) found.add("clothing");

  // «Kids» у нас поперечная категория, а не замена предметной:
  // детское платье живёт и в Kids, и в Dresses. Отдельно её не отбрасываем.

  // Взаимоисключающие предметные категории: если сработало несколько
  // (например «sneaker bag»), доверять нечему — пусть решает менеджер.
  const exclusive: Category[] = ["bags", "shoes", "jewelry", "accessories"];
  const hits = exclusive.filter((c) => found.has(c));
  if (hits.length > 1) {
    for (const c of hits) found.delete(c);
  }

  return [...found];
}

/** Готовые теги вида `category:bags` для Shopify. */
export function categoryTags(title: string, url?: string): string[] {
  return detectCategories(title, url).map((c) => `${CATEGORY_TAG_PREFIX}${c}`);
}
