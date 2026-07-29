/**
 * Соответствие «тег категории → стандартная категория Shopify».
 *
 * Категорийные теги в магазине приходят из двух источников с РАЗНЫМИ словарями:
 *   - приложение BrandsGateway — иерархия сверху вниз через « - », самое частное слева:
 *     `Shoes`, `Sandals - Shoes`, `Platforms - Sandals - Shoes`;
 *   - Телеграм-бот — легаси-формат `category:bags` (см. categorize.ts).
 *
 * Витрине хватает тегов, но поля Shopify **Category** (стандартная таксономия)
 * и **Product type** остаются пустыми — а их читают фиды Google/Meta, расчёт
 * налогов и маркетплейсы. Здесь мы сводим оба словаря к узлам таксономии.
 *
 * ID узлов (`aa-8-6` и т.п.) — стабильные строки из таксономии Shopify,
 * сверены с живым API: `taxonomy { categories(childrenOf: ...) }`.
 */

export interface CategoryAssignment {
  /** ID узла стандартной таксономии Shopify — поле Category. */
  taxonomyId: string;
  /** Имя того же узла — кладём в Product type, чтобы поле не пустовало. */
  productType: string;
}

function node(id: string, productType: string): CategoryAssignment {
  return { taxonomyId: `gid://shopify/TaxonomyCategory/${id}`, productType };
}

/** Узлы таксономии, которые реально нужны каталогу люкс-одежды. */
const T = {
  clothing: node("aa-1", "Clothing"),
  dresses: node("aa-1-4", "Dresses"),
  lingerie: node("aa-1-6", "Lingerie"),
  coatsJackets: node("aa-1-10-2", "Coats & Jackets"),
  outfitSets: node("aa-1-11", "Outfit Sets"),
  pants: node("aa-1-12", "Pants"),
  jeans: node("aa-1-12-4", "Jeans"),
  tops: node("aa-1-13", "Clothing Tops"),
  cardigans: node("aa-1-13-3", "Cardigans"),
  shirts: node("aa-1-13-7", "Shirts"),
  sweaters: node("aa-1-13-12", "Sweaters"),
  sweatshirts: node("aa-1-13-14", "Sweatshirts"),
  shorts: node("aa-1-14", "Shorts"),
  skirts: node("aa-1-15", "Skirts"),
  sleepwear: node("aa-1-17", "Sleepwear & Loungewear"),
  swimwear: node("aa-1-20", "Swimwear"),
  kidsClothing: node("aa-1-25", "Baby & Children's Clothing"),

  clothingAccessories: node("aa-2", "Clothing Accessories"),
  belts: node("aa-2-6", "Belts"),
  gloves: node("aa-2-13", "Gloves & Mittens"),
  scarves: node("aa-2-26", "Scarves & Shawls"),

  handbags: node("aa-5-4", "Handbags"),
  clutchBags: node("aa-5-4-5", "Clutch Bags"),
  shoulderBags: node("aa-5-4-19", "Shoulder Bags"),
  wallets: node("aa-5-5", "Wallets & Money Clips"),

  jewelry: node("aa-6", "Jewelry"),
  necklaces: node("aa-6-8", "Necklaces"),

  shoes: node("aa-8", "Shoes"),
  boots: node("aa-8-3", "Boots"),
  sandals: node("aa-8-6", "Sandals"),
  slippers: node("aa-8-7", "Slippers"),
  sneakers: node("aa-8-8", "Sneakers"),
  flats: node("aa-8-9", "Flats"),
  heels: node("aa-8-10", "Heels"),
} as const;

/**
 * Тег (в нижнем регистре) → узел таксономии.
 *
 * Третий уровень BG перечислен только там, где он МЕНЯЕТ узел: «Mid Heel - Pumps
 * - Shoes» и «Pumps - Shoes» дают один и тот же aa-8-10, отдельная строка не нужна.
 * Неизвестный третий уровень просто откатится на свой второй — за это отвечает
 * выбор по глубине в resolveCategory.
 */
const RULES: Record<string, CategoryAssignment> = {
  // ── BrandsGateway: верхний уровень (запасной вариант) ────────────────────
  bags: T.handbags,
  shoes: T.shoes,
  clothing: T.clothing,
  accessories: T.clothingAccessories,

  // ── BrandsGateway: второй уровень ────────────────────────────────────────
  "handbags - bags": T.handbags,
  "shoulder bags - bags": T.shoulderBags,
  "clutch bags - bags": T.clutchBags,

  "boots - shoes": T.boots,
  "sandals - shoes": T.sandals,
  "sneakers - shoes": T.sneakers,
  "flats - shoes": T.flats,
  // Лоферы у Shopify отдельным узлом не заведены — это плоская обувь.
  "loafers - shoes": T.flats,
  // BG зовёт лодочки Pumps, у Shopify это Heels.
  "pumps - shoes": T.heels,

  "dresses - clothing": T.dresses,
  "skirts - clothing": T.skirts,
  "pants - clothing": T.pants,
  "jeans denim - clothing": T.jeans,
  "jackets - clothing": T.coatsJackets,
  "sweaters - clothing": T.sweaters,
  "shirts - clothing": T.shirts,

  "belts - accessories": T.belts,
  "gloves - accessories": T.gloves,
  "scarves - accessories": T.scarves,
  "wallets - accessories": T.wallets,
  // BG пишет Jewellery (британское), у Shopify узел Jewelry.
  "jewellery - accessories": T.jewelry,

  // ── BrandsGateway: третий уровень, который меняет узел ───────────────────
  "slippers - sandals - shoes": T.slippers,
  "sweatshirts - sweaters - clothing": T.sweatshirts,
  "cardigans - sweaters - clothing": T.cardigans,
  "necklaces - jewellery - accessories": T.necklaces,

  // ── Телеграм-бот: легаси-формат category:* ───────────────────────────────
  "category:bags": T.handbags,
  "category:shoes": T.shoes,
  "category:jewelry": T.jewelry,
  "category:accessories": T.clothingAccessories,
  "category:clothing": T.clothing,
  "category:dresses": T.dresses,
  "category:tops": T.tops,
  "category:swimwear": T.swimwear,
  "category:jeans": T.jeans,
  "category:sweaters": T.sweaters,
  "category:jackets": T.coatsJackets,
  "category:pants": T.pants,
  "category:skirts": T.skirts,
  "category:shorts": T.shorts,
  "category:matching-sets": T.outfitSets,
  "category:pajamas": T.sleepwear,
  "category:lingerie": T.lingerie,
  "category:kids": T.kidsClothing,
};

/** Частность тега BG: «Slippers - Sandals - Shoes» → 3, «Shoes» → 1. */
function tagSpecificity(tag: string): number {
  return tag.split(" - ").length;
}

/** Глубина узла: aa-8-6 → 3. Чем глубже, тем частнее категория. */
function nodeDepth(assignment: CategoryAssignment): number {
  const id = assignment.taxonomyId.split("/").pop() ?? "";
  return id.split("-").length;
}

/**
 * Самая частная категория, которую удалось опознать по тегам товара.
 *
 * Ранжируем в два шага, и порядок здесь принципиален:
 *
 *  1. Частность тега BG. Именно она отражает намерение поставщика: у товара
 *     висит и `Shoes`, и `Sandals - Shoes`, и `Slippers - Sandals - Shoes` —
 *     верный ответ самый длинный. Заодно снимается шум BG: паре сумок
 *     проставлены разом `Accessories` и `Shoulder Bags - Bags`, и выигрывает сумка.
 *  2. Глубина узла таксономии — только при равной частности. Нужна легаси-тегам
 *     бота, у которых сегмент всегда один: `category:dresses` и `category:clothing`
 *     стоят на товаре вместе, и платье (aa-1-4) должно победить одежду (aa-1).
 *
 * Одной глубины узла не хватило бы: соседи по уровню неразличимы — у
 * `Accessories` (aa-2) и `Jewelry` (aa-6) она одинаковая.
 *
 * null — не опознали. Тогда товар не трогаем: проставить категорию наугад хуже,
 * чем оставить пустую, — неверная категория портит фиды и расчёт налога молча.
 */
export function resolveCategory(tags: string[]): CategoryAssignment | null {
  let best: CategoryAssignment | null = null;
  let bestRank: [number, number] = [0, 0];

  for (const tag of tags) {
    const key = tag.trim().toLowerCase();
    const hit = RULES[key];
    if (!hit) continue;

    const rank: [number, number] = [tagSpecificity(key), nodeDepth(hit)];
    if (rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
      best = hit;
      bestRank = rank;
    }
  }
  return best;
}

/** Товар глазами категоризатора: что уже проставлено и по каким тегам судить. */
export interface CategorizableProduct {
  tags: string[];
  /** Текущая категория (объект из GraphQL) — null, если поле пустое. */
  category?: { id: string } | null;
  productType?: string | null;
}

/** Что дописать товару. null — либо нечего, либо категория не опознана. */
export interface CategoryPatch {
  category?: string;
  productType?: string;
}

/**
 * Чего товару не хватает. Только ДОПИСЫВАЕМ: уже проставленные вручную
 * Category и Product type не трогаем — иначе задача затирала бы работу менеджера
 * на каждом проходе. Отсюда же идемпотентность.
 */
export function categoryPatch(product: CategorizableProduct): CategoryPatch | null {
  const assignment = resolveCategory(product.tags);
  if (!assignment) return null;

  const patch: CategoryPatch = {};
  if (!product.category?.id) patch.category = assignment.taxonomyId;
  if (!product.productType?.trim()) patch.productType = assignment.productType;

  return Object.keys(patch).length > 0 ? patch : null;
}
