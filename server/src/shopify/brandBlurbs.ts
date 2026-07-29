/**
 * Блок «About the Brand» в описании товара.
 *
 * Тексты авторские и намеренно короткие: пересказ фактов о доме (когда основан,
 * кем, чем известен), без маркетинговых обещаний и без копирования формулировок
 * с сайтов брендов — чужой текст в карточке товара это чужие права.
 *
 * Ключ — vendor в нижнем регистре, ровно как его пишет приложение BrandsGateway.
 * Бренда нет в словаре → блок просто не выводится (см. buildDescriptionHtml).
 * Так новый бренд из каталога BG не ломает описание и не получает выдуманную
 * биографию — его добавляют сюда руками.
 */

const BLURBS: Record<string, string> = {
  "miu miu":
    "Founded by Miuccia Prada in 1993 and named after her family nickname, " +
    "Miu Miu is the more playful counterpart to the Prada house. The label is " +
    "known for subverting classic codes with unexpected proportions, decorative " +
    "detail and a distinctly youthful point of view.",

  gucci:
    "Founded in Florence in 1921 as a maker of fine leather goods, Gucci has " +
    "grown into one of the defining houses of Italian fashion. Its collections " +
    "pair recognisable house codes — the Double G, the Web stripe, equestrian " +
    "hardware — with an eclectic, maximalist sensibility.",

  prada:
    "Established in Milan in 1913 as a luggage and leather goods shop, Prada was " +
    "reshaped by Miuccia Prada into one of fashion's most intellectual houses. " +
    "The label is defined by restrained silhouettes, technical fabrics and a " +
    "deliberate tension between the austere and the ornate.",

  "the row":
    "Launched in 2006 by Mary-Kate and Ashley Olsen, The Row takes its name from " +
    "London's Savile Row and its discipline from tailoring. The label concentrates " +
    "on exceptional fabric, precise construction and quiet, enduring shapes rather " +
    "than seasonal statement.",
};

/** Текст о бренде или undefined, если бренда в словаре нет. */
export function brandBlurb(vendor: string | null | undefined): string | undefined {
  if (!vendor) return undefined;
  return BLURBS[vendor.trim().toLowerCase()];
}

/** Бренды, для которых текст уже написан — нужно тестам и диагностике. */
export function knownBrands(): string[] {
  return Object.keys(BLURBS);
}
