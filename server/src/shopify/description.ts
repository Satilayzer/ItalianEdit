/**
 * Пересборка описаний товаров, залитых приложением BrandsGateway.
 *
 * BG отдаёт описание в двух видах, и оба непригодны для витрины:
 *
 *   A. «Description: / Additional Info:» — шаблонная фраза с внутренними кодами
 *      прямо в тексте для покупателя и несогласованной грамматикой
 *      («The product with MPN 5XX… and code F76693 plexiglass in green
 *      is a sandals designed by Miu Miu»), плюс список «Ключ: значение»,
 *      куда затесались MPN и «New collection: No».
 *
 *   B. Плоская строка через тире: «– Composition: 100% calf leather – Inner:
 *      Leather – Open toe – Heel 10 cm – Made in Italy – Gender: WOMEN –».
 *
 * Разбираем факты и собираем структуру: абзац, Details, Size & Fit,
 * About the Brand, Style Code. Ничего не выдумываем — в тексте оказывается
 * только то, что пришло от поставщика; чего нет, то и не выводится.
 *
 * Описания товаров бота НЕ трогаем: там настоящий текст бренда, он лучше всего,
 * что мы соберём из спецификации.
 */

import { brandBlurb } from "./brandBlurbs";

/** Метка нашей вёрстки: по ней узнаём уже обработанное описание. */
export const DESCRIPTION_MARKER_CLASS = "ie-description";

export interface SpecItem {
  /** «Heel height» из пары «Ключ: значение». Нет — значит факт без метки. */
  label?: string;
  value: string;
}

export interface BgFacts {
  /**
   * Готовый авторский абзац от поставщика (формат C). Если он есть — выводим
   * его дословно: живой текст бренда лучше любой фразы, собранной из спецификации.
   */
  prose?: string;
  brand?: string;
  kind?: string;
  color?: string;
  material?: string;
  madeIn?: string;
  mpn?: string;
  features: string[];
  details: SpecItem[];
  fit: SpecItem[];
}

// ── Разбор HTML ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** HTML → плоский текст: переносы сохраняем, теги убираем. */
export function htmlToText(html: string): string {
  return html
    // Атрибуты у тегов встречаются («<br data-start="146">»), поэтому \b[^>]*.
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Латинские названия сырья из фида BG («Calf Leather Bos Taurus»).
 * Покупателю они ничего не говорят, а в тексте выглядят как опечатка.
 */
const LATIN_SPECIES =
  /\s*\b(bos taurus|ovis aries|sus scrofa|capra hircus|cervus elaphus)\b/gi;

export function stripLatinSpecies(text: string): string {
  return text.replace(LATIN_SPECIES, "").replace(/\s{2,}/g, " ").trim();
}

/** Служебные ключи BG: покупателю не нужны, а часть дублирует теги/поля товара. */
const NOISE_KEYS =
  /^(mpn|sku|ean|barcode|code|product id|retailer|retailer id|new collection|gender)$/i;

/**
 * Строка вида «Ключ: значение» в хвосте описания (формат C). Ключ короткий
 * и без знаков препинания — так блок характеристик не спутать с прозой,
 * где двоеточие тоже встречается.
 */
const KEY_VALUE_LINE = /^[A-Za-z][A-Za-z ]{0,20}:\s*\S/;

/**
 * Короткий факт без метки — «Made in Italy», «Logo details». В хвосте они идут
 * вперемешку с парами «ключ: значение», а от прозы отличаются длиной и тем,
 * что это не предложение (нет точки).
 */
const BARE_FACT_LINE = /^[^.!?]{1,40}$/;

/**
 * Начало хвостового блока характеристик, -1 — блока нет.
 * Блоком считаем только такой хвост, где есть хотя бы одна пара «ключ: значение»:
 * иначе последняя короткая строка прозы уехала бы в буллеты.
 */
function keyValueTailStart(lines: string[]): number {
  let i = lines.length;
  while (i > 0 && (KEY_VALUE_LINE.test(lines[i - 1]) || BARE_FACT_LINE.test(lines[i - 1]))) {
    i--;
  }
  if (i === lines.length) return -1;
  return lines.slice(i).some((l) => KEY_VALUE_LINE.test(l)) ? i : -1;
}

/**
 * Строка-заголовок вроде «MIU MIU» перед текстом: капсом и коротко.
 * Бренд и так стоит в названии товара и в блоке About the Brand.
 */
function isShoutedHeading(line: string): boolean {
  return line.length <= 30 && /[A-Z]/.test(line) && !/[a-z]/.test(line);
}

/** Ключи, которые относятся к посадке и размеру, а не к материалам. */
const FIT_KEYS =
  /^(measurements?|heel height|heel type|heel|size|sizes|length|width|height|fit)$/i;

function splitKeyValue(line: string): SpecItem {
  const m = line.match(/^([^:]{1,30}):\s*(.+)$/);
  if (!m) return { value: line };
  return { label: m[1].trim(), value: m[2].trim() };
}

function isNoise(item: SpecItem): boolean {
  if (item.label && NOISE_KEYS.test(item.label)) return true;
  // Бесхозный код артикула вроде «F76693» или «5XX5783LLU085F0613».
  if (!item.label && /^[A-Z0-9][A-Z0-9._/-]{5,}$/.test(item.value)) return true;
  return false;
}

function isFit(item: SpecItem): boolean {
  if (item.label) return FIT_KEYS.test(item.label);
  return /^heel\b.*\d/i.test(item.value);
}

/** «Made in Italy» — отдельный факт, в буллетах он смотрится сиротой. */
function extractMadeIn(items: SpecItem[]): { madeIn?: string; rest: SpecItem[] } {
  let madeIn: string | undefined;
  const rest: SpecItem[] = [];
  for (const item of items) {
    const m = item.value.match(/^made in\s+(.+)$/i);
    if (!m && item.label && /^made in$/i.test(item.label)) {
      madeIn = item.value;
      continue;
    }
    if (m) {
      madeIn = m[1].trim();
      continue;
    }
    rest.push(item);
  }
  return { madeIn, rest };
}

function toSpecItems(lines: string[]): SpecItem[] {
  return lines
    // Крайние тире остаются от формата B: строка идёт как «– a – b – c –».
    .map((l) => l.replace(/^\s*[–—]\s*/, "").replace(/\s*[–—]\s*$/, "").trim())
    .map((l) => stripLatinSpecies(l))
    .filter((l) => l.length > 0)
    .map(splitKeyValue)
    .filter((item) => !isNoise(item));
}

/**
 * Узнаёт описание BrandsGateway и вытаскивает факты.
 * null — формат чужой (например, настоящий текст бренда у товаров бота),
 * трогать такое описание нельзя.
 */
export function parseBgDescription(html: string): BgFacts | null {
  if (!html?.trim()) return null;
  // Уже размеченное описание — наша вёрстка или настоящий текст бренда
  // у товаров бота. Разбирать нечего и нельзя.
  if (/<(ul|ol|h3|h4)\b/i.test(html)) return null;

  const text = htmlToText(html);
  if (!text) return null;

  // Формат C: авторский абзац, следом хвост «Ключ: значение». Прозу оставляем
  // дословно — она написана человеком и лучше собранной из спецификации.
  if (!/^description:/im.test(text)) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    while (lines.length > 0 && isShoutedHeading(lines[0])) lines.shift();

    const tailStart = keyValueTailStart(lines);
    // Нет хвоста характеристик — структурировать нечего.
    if (tailStart < 0) return null;

    const facts: BgFacts = { features: [], details: [], fit: [] };
    // tailStart === 0 — описание вообще без прозы, только характеристики
    // (после снятия заголовка вроде «HANDBAG»). Абзац тогда соберёт шаблон.
    if (tailStart > 0) {
      facts.prose = stripLatinSpecies(lines.slice(0, tailStart).join(" "));
    }

    const items = toSpecItems(lines.slice(tailStart));
    const { madeIn, rest } = extractMadeIn(items);
    facts.madeIn = madeIn;
    for (const item of rest) {
      if (isFit(item)) facts.fit.push(item);
      else facts.details.push(item);
    }
    return facts.details.length > 0 || facts.fit.length > 0 ? facts : null;
  }

  const additionalAt = text.search(/^additional info:/im);
  const head = (additionalAt === -1 ? text : text.slice(0, additionalAt))
    .replace(/^description:/im, "")
    .trim();
  const tail =
    additionalAt === -1
      ? ""
      : text.slice(additionalAt).replace(/^additional info:/im, "").trim();

  const facts: BgFacts = { features: [], details: [], fit: [] };

  // Шаблонная фраза формата A. Коды из неё берём только для Style Code.
  const sentence = head.match(
    /with mpn\s+(\S+)\s+and code\s+(\S+)\s+(.+?)\s+in\s+(.+?)\s+is an?\s+(.+?)\s+designed by\s+(.+?)\s*\./i
  );
  if (sentence) {
    facts.mpn = sentence[1];
    facts.material = stripLatinSpecies(sentence[3]);
    facts.color = sentence[4].trim();
    facts.kind = sentence[5].trim();
    facts.brand = sentence[6].trim();
  }

  const features = head.match(/features like\s+(.+?)\s*\./i);
  if (features) {
    facts.features = features[1]
      .split(/,\s*|\s+and\s+/i)
      .map((f) => stripLatinSpecies(f))
      .filter(Boolean);
  }

  // Формат A: характеристики построчно после «Additional Info:».
  // Формат B: они же, но одной строкой через тире.
  const specLines = tail
    ? tail.split("\n")
    : head
        .split(/\s[–—]\s|\s-\s/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^the product with/i.test(s));

  // В формате B шаблонной фразы нет — значит и разбирать в head было нечего.
  if (!sentence && specLines.length < 2) return null;

  const items = toSpecItems(specLines);
  const { madeIn, rest } = extractMadeIn(items);
  facts.madeIn = madeIn;

  for (const item of rest) {
    if (isFit(item)) facts.fit.push(item);
    else facts.details.push(item);
  }

  if (!facts.mpn) {
    const mpnLine = specLines.find((l) => /^mpn:/i.test(l));
    if (mpnLine) facts.mpn = mpnLine.replace(/^mpn:\s*/i, "").trim();
  }
  if (!facts.material) {
    const comp = rest.find((i) => i.label && /^(composition|materials?)$/i.test(i.label));
    if (comp) facts.material = comp.value;
  }

  const hasAnything =
    facts.details.length > 0 || facts.fit.length > 0 || Boolean(sentence);
  return hasAnything ? facts : null;
}

// ── Сборка описания ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «a, b and c» — перечисление по-английски, как в карточках люкс-ритейла. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Вводный абзац. Собирается ТОЛЬКО из фактов поставщика — ни одного оценочного
 * слова, которое пришлось бы придумывать («изысканный», «роскошный»).
 * Материал и цвет не повторяем, если они уже стоят в названии товара.
 */
export function buildProse(facts: BgFacts, opts: BuildOptions): string {
  // Текст поставщика написан человеком — своим шаблоном его не подменяем.
  if (facts.prose?.trim()) return facts.prose.trim();

  const { title } = opts;
  const subject = facts.kind ? capitalize(facts.kind) : title;
  const lowerTitle = title.toLowerCase();

  const madeOf = [facts.color, facts.material]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => v.trim())
    .filter((v) => !lowerTitle.includes(v.toLowerCase()));

  // В формате B шаблонной фразы нет, бренд оттуда взять неоткуда — берём vendor.
  const brand = facts.brand ?? opts.vendor ?? undefined;

  let lead = subject;
  if (brand && !lowerTitle.includes(brand.toLowerCase())) lead += ` by ${brand}`;
  if (madeOf.length > 0) lead += `, crafted in ${joinList(madeOf)}`;

  const sentences = [`${lead}.`];
  if (facts.features.length > 0) {
    sentences.push(`Finished with ${joinList(facts.features)}.`);
  }
  if (facts.madeIn) sentences.push(`Made in ${facts.madeIn}.`);
  return sentences.join(" ");
}

function bullets(items: SpecItem[]): string {
  return items
    .map((i) => {
      const text = i.label ? `${i.label}: ${i.value}` : i.value;
      return `<li>${escapeHtml(text)}</li>`;
    })
    .join("");
}

export interface BuildOptions {
  title: string;
  vendor?: string | null;
}

/**
 * Итоговый HTML описания. Обёртка с классом-меткой нужна, чтобы задача узнавала
 * собственную работу и не перемалывала её повторно (см. rewriteDescriptions).
 * Блок выводится, только если для него есть данные: пустых заголовков не бывает.
 */
export function buildDescriptionHtml(facts: BgFacts, opts: BuildOptions): string {
  const parts: string[] = [];

  const prose = buildProse(facts, opts);
  if (prose.trim()) parts.push(`<p>${escapeHtml(prose)}</p>`);

  if (facts.details.length > 0) {
    parts.push(`<h4>Details</h4><ul>${bullets(facts.details)}</ul>`);
  }
  if (facts.fit.length > 0) {
    parts.push(`<h4>Size &amp; Fit</h4><ul>${bullets(facts.fit)}</ul>`);
  }

  const blurb = brandBlurb(opts.vendor);
  if (blurb) {
    parts.push(`<h4>About the Brand</h4><p>${escapeHtml(blurb)}</p>`);
  }

  if (facts.mpn) {
    parts.push(`<p class="ie-style-code">Style Code: ${escapeHtml(facts.mpn)}</p>`);
  }

  return `<div class="${DESCRIPTION_MARKER_CLASS}">${parts.join("")}</div>`;
}

/** Наша ли это вёрстка (значит, обрабатывать заново не нужно). */
export function isRewrittenDescription(html: string | null | undefined): boolean {
  return Boolean(html?.includes(`class="${DESCRIPTION_MARKER_CLASS}"`));
}
