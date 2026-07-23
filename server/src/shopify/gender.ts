/**
 * Пол товара — на нём держится переключатель Women / Men / Unisex на витрине.
 *
 * Источники разные: у BrandsGateway пол приходит полем `gender` в товаре,
 * а у товаров из ТГ-группы его нет вовсе — там выводим из URL страницы бренда
 * и названия, как и категорию.
 */

export const GENDER_TAG_PREFIX = "gender:";

export type Gender = "women" | "men" | "unisex";

/**
 * Теги для Shopify.
 *
 * Отдельного тега `gender:unisex` нет — на витрине только Women и Men.
 * Унисекс-товар получает оба тега (women + men), поэтому виден в обоих
 * фильтрах: встроенный маршрут Shopify /collections/<handle>/<tag> отбирает
 * по одному тегу без ИЛИ, а унисекс должен показываться и там, и там.
 */
export function genderTags(gender: Gender | null | undefined): string[] {
  if (!gender) return [];
  if (gender === "unisex") {
    return [`${GENDER_TAG_PREFIX}women`, `${GENDER_TAG_PREFIX}men`];
  }
  return [`${GENDER_TAG_PREFIX}${gender}`];
}

/** Достаёт пол из тегов товара. Оба тега (women+men) — значит унисекс. */
export function genderFromTags(tags: string[]): Gender | null {
  const values = new Set(
    tags
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.startsWith(GENDER_TAG_PREFIX))
      .map((t) => t.slice(GENDER_TAG_PREFIX.length))
  );
  if (values.has("women") && values.has("men")) return "unisex";
  if (values.has("women")) return "women";
  if (values.has("men")) return "men";
  return null;
}

/**
 * Нормализует значение пола из BrandsGateway («Woman», «Men», «Unisex»…).
 *
 * Порядок проверок важен: «woman» содержит «man», а «women» содержит «men».
 * Если сначала искать мужское, вся женская одежда уедет в мужскую.
 */
export function normalizeGender(raw?: string | null): Gender | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;

  if (v.includes("unisex")) return "unisex";
  if (v.includes("women") || v.includes("woman") || v.includes("female")) return "women";
  if (v.includes("girl") || v.includes("donna") || v.includes("ladies")) return "women";
  if (v.includes("men") || v.includes("man") || v.includes("male")) return "men";
  if (v.includes("boy") || v.includes("uomo")) return "men";
  return null;
}

/** Куски URL брендовых сайтов, по которым виден раздел. */
const URL_HINTS: [Gender, string[]][] = [
  ["unisex", ["/unisex"]],
  ["women", ["/women", "/woman", "/donna", "/femme", "/damen", "/mujer", "/girls"]],
  ["men", ["/men", "/man", "/uomo", "/homme", "/herren", "/hombre", "/boys"]],
];

/**
 * Определяет пол для товаров из ТГ-группы: менеджер его не присылает.
 * Сигнал — раздел на сайте бренда; в названии пол попадается редко
 * и слишком часто ложно, поэтому смотрим только URL.
 *
 * Не определилось — тега нет, товар виден при любом выборе переключателя.
 */
export function detectGender(url?: string): Gender | null {
  const path = (url ?? "").toLowerCase();
  if (!path) return null;
  for (const [gender, hints] of URL_HINTS) {
    if (hints.some((hint) => path.includes(hint))) return gender;
  }
  return null;
}
