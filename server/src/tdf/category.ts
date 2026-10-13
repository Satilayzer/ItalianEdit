/**
 * Категория товара TheDoubleF → категорийные теги витрины.
 *
 * Меню, умные коллекции и фильтр подкатегории держатся на тегах в формате
 * BrandsGateway: раздел (`Clothing`) плюс цепочка «частное - общее»
 * (`Pants - Clothing`, `Cardigans - Sweaters - Clothing`). Чтобы товары
 * TheDoubleF попадали в те же коллекции, отдаём ровно такие же теги —
 * а поля Category / Product type потом выводит общий category.ts.
 *
 * У поставщика категория — Google product category, и у пятой части моделей
 * она общая («Apparel & Accessories»): сумки, платья, кошельки, очки. Для них
 * и для уточнения внутри раздела (кроссовки или лоферы) смотрим на название.
 */

export interface CategoryResult {
  /** Раздел меню. */
  section: "Clothing" | "Shoes" | "Bags" | "Accessories";
  /** Теги: раздел + цепочки, от общего к частному. */
  tags: string[];
}

/** Не fashion — не импортируем на старте (правило R02). */
export const NON_FASHION =
  /\b(towels?|candles?|books?|toys?|plush|blankets?|cushions?|mugs?|notebooks?|diffusers?|perfumes?|fragrances?)\b/i;

/** Недорогие basics — не в основные коллекции (правило R16). */
export const CHEAP_BASICS_TYPES = /Underwear & Socks|Keychains/i;
export const CHEAP_BASICS_TITLE = /\b(socks?|tights|briefs|boxers?|keyrings?|key ?chains?|key ?holders?)\b/i;

function chain(...segments: string[]): string[] {
  // «Cardigans», «Sweaters», «Clothing» → «Clothing», «Sweaters - Clothing»,
  // «Cardigans - Sweaters - Clothing» — все уровни, как у товаров BG.
  const tags: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) tags.push(segments.slice(i).join(" - "));
  return tags;
}

function clothing(...sub: string[]): CategoryResult {
  return { section: "Clothing", tags: chain(...sub, "Clothing") };
}
function shoes(...sub: string[]): CategoryResult {
  return { section: "Shoes", tags: chain(...sub, "Shoes") };
}
function bags(...sub: string[]): CategoryResult {
  return { section: "Bags", tags: chain(...sub, "Bags") };
}
function accessories(...sub: string[]): CategoryResult {
  return { section: "Accessories", tags: chain(...sub, "Accessories") };
}

const has = (re: RegExp, s: string) => re.test(s);

function shoeType(t: string): CategoryResult {
  if (has(/sneakers?|trainers?|running shoes?/, t)) return shoes("Sneakers");
  if (has(/boots?|booties|chelsea|combat/, t)) return shoes("Boots");
  if (has(/slippers?/, t)) return shoes("Slippers", "Sandals");
  if (has(/sandals?|slides?|flip[- ]flops?|thongs?/, t)) return shoes("Sandals");
  if (has(/loafers?|moccasins?|drivers?|driving shoes?|slip-ons?/, t)) return shoes("Loafers");
  if (has(/pumps?|heels?|slingbacks?|stilettos?|d[eé]collet/, t)) return shoes("Pumps");
  // Мюли раньше балеток: «ballet pink mules» — это цвет, а не балетки.
  if (has(/\bmules?\b/, t)) return shoes("Mules");
  if (has(/ballet flats?|ballerinas?|\bflats?\b|espadrilles?|mary janes?/, t)) return shoes("Flats");
  if (has(/clogs?/, t)) return shoes("Clogs");
  if (has(/derby|derbies|oxfords?|brogues?|lace-ups?|monks?/, t)) return shoes("Lace-Ups");
  return shoes();
}

function bagType(t: string): CategoryResult {
  if (has(/backpacks?/, t)) return bags("Backpacks");
  if (has(/clutch|pouch|wristlet|minaudi[eè]re/, t)) return bags("Clutch Bags");
  if (has(/shoulder|crossbody|cross-body|hobo|messenger|camera bag|saddle/, t)) return bags("Shoulder Bags");
  return bags("Handbags");
}

function topType(t: string): CategoryResult {
  if (has(/cardigans?/, t)) return clothing("Cardigans", "Sweaters");
  if (has(/sweatshirts?|hoodies?|hooded/, t)) return clothing("Sweatshirts", "Sweaters");
  if (has(/sweaters?|jumpers?|pullovers?|knitwear|knitted|turtleneck sweater/, t)) {
    return clothing("Sweaters");
  }
  return clothing("Shirts");
}

/** Слова из названия, по которым узнаём модель с общей категорией. */
function fromTitle(t: string): CategoryResult | null {
  if (has(/\bwallets?\b|card ?holders?|card ?cases?|coin purses?|\bpurses?\b|document holders?/, t)) {
    return accessories("Wallets");
  }
  if (has(/\b(bags?|totes?|clutch|backpacks?|crossbody|pouch|bucket|handbags?|shopper|satchel|hobo|baguette|wristlet)\b/, t)) {
    return bagType(t);
  }
  if (has(/\b(sunglasses|glasses|eyewear|lunettes)\b/, t)) return accessories("Sunglasses");
  if (has(/\b(sneakers?|trainers?|boots?|sandals?|loafers?|moccasins?|pumps?|ballet flats|ballerinas?|mules?|clogs?|slingbacks?|espadrilles?|slides?|slip-ons?|mary janes?|shoes)\b|d[eé]collet[eé]/, t)) {
    return shoeType(t);
  }
  if (has(/\bjumpsuits?\b|\bplaysuits?\b|\boveralls?\b/, t)) return clothing("Jumpsuits");
  if (has(/\bdress(es)?\b/, t) && !has(/\bdress (shirt|shoes?|pants|trousers)\b/, t)) {
    return clothing("Dresses");
  }
  if (has(/\b(bikini|swimsuit|swim|trunks|swimwear|one-piece)\b/, t)) return clothing("Swimwear");
  if (has(/\b(scarf|scarves|stole|shawl|foulard|bandana)\b/, t)) return accessories("Scarves");
  if (has(/\b(belts?)\b/, t)) return accessories("Belts");
  if (has(/\b(gloves?|mittens?)\b/, t)) return accessories("Gloves");
  if (has(/\b(hats?|caps?|beanies?|berets?|bucket hats?|balaclavas?|headbands?)\b/, t)) {
    return accessories("Hats");
  }
  if (has(/\b(earrings?|necklaces?|bracelets?|rings?|brooch|pendants?|chokers?|cuffs?)\b/, t)) {
    return accessories("Jewellery");
  }
  if (has(/\b(suits?|tuxedo)\b/, t)) return clothing("Suits");
  // «side tie», «tie-dye» — не галстук: берём только шёлковые/жаккардовые и бабочки.
  if (has(/\b(ties?|bow ties?|pocket squares?)\b/, t) && has(/\b(silk|jacquard|bow|pocket)\b/, t)) {
    return accessories("Ties");
  }
  if (has(/\bcharms?\b/, t)) return accessories("Bag Charms");
  if (has(/\b(jackets?|coats?|blazers?|parkas?|trench|bombers?|gilets?|vests?|down jacket|puffers?|capes?|blousons?|windbreakers?|anoraks?|caban|ponchos?|peacoats?)\b/, t)) {
    return clothing("Jackets");
  }
  if (has(/\bskirts?\b|\bkilts?\b|\bgonna\b/, t)) return clothing("Skirts");
  if (has(/\bshorts\b|\bbermudas?\b/, t)) return clothing("Shorts");
  if (has(/\bjeans\b/, t)) return clothing("Jeans Denim");
  if (has(/\b(trousers|pants|joggers|leggings|chinos|culottes|pantaloni)\b/, t)) return clothing("Pants");
  // Итальянское «felpa» — толстовка (часть названий поставщик не перевёл).
  if (has(/\bfelpa\b/, t)) return clothing("Sweatshirts", "Sweaters");
  if (has(/\b(knit set|co-ord|two-piece set)\b/, t)) return clothing("Matching Sets");
  if (has(/\b(shirts?|t-shirts?|tops?|blouses?|polos?|tank|camisoles?|bodysuits?|corsets?|bustiers?|sweaters?|cardigans?|sweatshirts?|hoodies?)\b/, t)) {
    return topType(t);
  }
  return null;
}

/** Слова обуви и сумок, которые в названии одежды — фасон, а не товар: «Boot Cut jeans». */
const NON_CLOTHING_WORDS =
  /\b(sneakers?|trainers?|boot ?cut|boots?|sandals?|loafers?|moccasins?|pumps?|mules?|clogs?|derby|oxfords?|bags?|totes?|clutch|backpacks?|pouch)\b/g;

/** Подкатегория одежды по названию; обувные и сумочные слова не сбивают. */
function clothingFromTitle(t: string): CategoryResult | null {
  const hint = fromTitle(t.replace(NON_CLOTHING_WORDS, " "));
  return hint?.section === "Clothing" ? hint : null;
}

/** Одежда, у которой название ничего не подсказало, — по товарной позиции. */
function clothingByHeading(h4: string, t: string): CategoryResult {
  if (["6101", "6102", "6201", "6202"].includes(h4)) return clothing("Jackets");
  if (["6105", "6106", "6109", "6205", "6206"].includes(h4)) return clothing("Shirts");
  if (h4 === "6110") return topType(t);
  return clothing();
}

/**
 * Раздел по таможенному коду поставщика (ТН ВЭД ЕС, 8 знаков). Код точнее
 * Google-категории и названия: «Loafer bag» — сумка (4202), «Boot Cut jeans» —
 * брюки (6204). Главу 43 (мех) не используем: под ней у поставщика и шубы,
 * и меховые ботинки. null — код не помогает, решает фид.
 */
export function fromHsCode(hsCode: string, title: string): CategoryResult | null {
  const d = hsCode.replace(/\D/g, "");
  if (d.length < 4) return null;
  const t = title.toLowerCase();
  const h4 = d.slice(0, 4);
  const h6 = d.slice(0, 6);
  const wallet = has(/\bwallets?\b|card ?holders?|card ?cases?|coin purses?/, t);
  const bagWords = has(/\b(bags?|totes?|clutch|pouch|backpacks?|handbags?|pochette|tasche)\b/, t);
  // Обувной код у картхолдера — ошибка поставщика, а не обувь.
  if (d.startsWith("64")) return wallet || bagWords ? null : shoeType(t);
  if (h4 === "4202") {
    // «Bag charm» — брелок; «Charm bag», «Charms Basket Bag» — модели сумок.
    if (has(/\bbag charms?\b|\bcharms?\b(?!.*\bbags?\b)/, t)) return accessories("Bag Charms");
    if (wallet) return accessories("Wallets");
    // 4202 31–39 — вещи, которые носят в кармане или сумке. Но «clutch bag»
    // или «pouch» с таким кодом — всё же сумка.
    if (/^42023/.test(h6) && !bagWords) return accessories("Wallets");
    return bagType(t);
  }
  // 6217 — «прочие принадлежности одежды»: ремни, воротники. Решает название.
  if (h4 === "6217") {
    const hint = fromTitle(t);
    return hint?.section === "Accessories" ? hint : null;
  }
  if (h6 === "420330") return accessories("Belts");
  if (/^42032/.test(h6) || h4 === "6116" || h4 === "6216") return accessories("Gloves");
  if (h4 === "6214" || h4 === "6117") {
    const hint = fromTitle(t);
    return hint?.section === "Accessories" ? hint : accessories("Scarves");
  }
  if (h4 === "6215") return accessories("Ties");
  if (["6504", "6505", "6506"].includes(h4)) return accessories("Hats");
  if (["7113", "7116", "7117"].includes(h4)) return accessories("Jewellery");
  if (h4 === "9004") return accessories("Sunglasses");
  if (/^6[12]/.test(d) || h6 === "420310") return clothingFromTitle(t) ?? clothingByHeading(h4, t);
  return null;
}

/**
 * Категория модели. null — не опознали: товар импортируется черновиком
 * с пометкой `review:category` (правило R15), категорию ставит менеджер.
 *
 * Если раздел по HS-коду другой, чем по категории поставщика и названию,
 * прав код: поставщик путает Google-категории («Derby jacket» в Shoes).
 */
export function classify(productType: string, title: string, hsCode = ""): CategoryResult | null {
  const base = classifyByFeed(productType, title);
  const byHs = hsCode ? fromHsCode(hsCode, title) : null;
  if (byHs && byHs.section !== base?.section) return byHs;
  return base;
}

/** Категория только по данным фида: Google-категория поставщика и название. */
export function classifyByFeed(productType: string, title: string): CategoryResult | null {
  const t = title.toLowerCase();
  const type = productType.replace(/^Apparel & Accessories\s*>?\s*/i, "");

  if (/^Shoes/i.test(type)) return shoeType(t);
  if (/Clothing > Shirts & Tops/i.test(type)) {
    // Название уточняет только внутри одежды: «T-shirt with pendant» — футболка, не украшение.
    const hint = fromTitle(t);
    return hint?.section === "Clothing" ? hint : topType(t);
  }
  // Сумка с ремнём («Belted Tote Bag») у поставщика бывает в категории Belts.
  const bag = fromTitle(t);
  if (bag?.section === "Bags" && /Clothing Accessories/i.test(type)) return bag;
  if (/Clothing > Pants/i.test(type)) {
    return has(/\bjeans\b|denim/, t) ? clothing("Jeans Denim") : clothing("Pants");
  }
  if (/Outerwear/i.test(type)) return clothing("Jackets");
  if (/Clothing > Skirts/i.test(type)) return clothing("Skirts");
  if (/Clothing > Shorts/i.test(type)) return clothing("Shorts");
  if (/Jumpsuits & Rompers/i.test(type)) return clothing("Jumpsuits");
  // Leotards & Unitards у поставщика — это боди: на витрине это топы.
  if (/Leotards & Unitards/i.test(type)) return clothing("Shirts");
  if (/Clothing > Dresses/i.test(type)) return clothing("Dresses");
  if (/Hats/i.test(type)) return accessories("Hats");
  if (/Scarves & Shawls/i.test(type)) return accessories("Scarves");
  if (/Belts/i.test(type)) return accessories("Belts");
  if (/Gloves & Mittens/i.test(type)) return accessories("Gloves");
  if (/^Jewelry/i.test(type)) return accessories("Jewellery");
  if (/Handbags|Handbag & Wallet/i.test(type)) return fromTitle(t) ?? bags("Handbags");

  // Общая категория поставщика — решает название.
  return fromTitle(t);
}
