/**
 * Italian Edit Pricing Logic v1.0 (зафиксировано 06.10.2026, рынок США).
 *
 * Исходники: Italian_Edit_Pricing_Logic_v1.0.docx / .xlsx. Кратко:
 *  - цену задаёт рынок: база = среднее двух сопоставимых предложений
 *    (Farfetch US + Italist US), с доставкой и импортом, без sales tax;
 *  - наши затраты решают, допустима ли цена: остаток и маржа не ниже сетки;
 *  - скидка — минимально необходимая: 0% → 2,5% → 5%, первая, которая
 *    достигает ориентира MIN(Farfetch, Italist) и проходит оба минимума;
 *  - во всех остальных случаях — ручное решение, автоматической цены нет.
 *
 * Деньги — целые центы, никакого binary float. Округление half-up до цента,
 * сравнения после округления (требование I06).
 *
 * Цена при импорте — autoPrice(): рыночное решение, если оно есть, иначе
 * минимум сетки маржи по нашим затратам. Модуль в магазин не пишет; товар
 * остаётся черновиком, публикацию утверждает человек.
 */

export const POLICY_VERSION = "1.0";

export type Decision =
  | "KEEP_BASE"
  | "TEST_2_5"
  | "TEST_5"
  | "MANUAL_PRICE"
  | "MANUAL_MARGIN"
  | "MANUAL_ONE_SOURCE"
  | "MANUAL_DATA";

/** Скидки-кандидаты в промилле: 0; 2,5%; 5%. Применяются к исходной базе независимо. */
export const DISCOUNTS_PERMILLE = [0, 25, 50] as const;

export interface Band {
  /** Нижняя граница диапазона, центы, включительно. */
  fromCents: number;
  /** Минимальная маржа, базисные пункты (20% = 2000). */
  minMarginBp: number;
  /** Минимальный остаток, центы. */
  minRemainingCents: number;
}

/** Сетка v1.0: диапазон определяется по КОНЕЧНОЙ цене после скидки и округления. */
export const BANDS: Band[] = [
  { fromCents: 0, minMarginBp: 2000, minRemainingCents: 4_000 },
  { fromCents: 100_000, minMarginBp: 1800, minRemainingCents: 20_000 },
  { fromCents: 250_000, minMarginBp: 1500, minRemainingCents: 45_000 },
];

export function bandFor(priceCents: number): Band {
  let band = BANDS[0];
  for (const b of BANDS) if (priceCents >= b.fromCents) band = b;
  return band;
}

/** Целочисленное деление с округлением half-up (для неотрицательных). */
export function divHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export interface PaymentFee {
  /** Процент, базисные пункты (2,9% = 290). */
  rateBp: number;
  fixedCents: number;
}

export const DEFAULT_PAYMENT_FEE: PaymentFee = { rateBp: 290, fixedCents: 30 };

export function paymentFeeCents(priceCents: number, fee: PaymentFee): number {
  return divHalfUp(priceCents * fee.rateBp, 10_000) + fee.fixedCents;
}

export interface Economics {
  priceCents: number;
  feeCents: number;
  remainingCents: number;
  /** Маржа как доля, только для показа. Допуск считается в целых числах. */
  margin: number;
  band: Band;
  passes: boolean;
}

/**
 * Экономика цены: остаток = цена − прямые затраты − платёжная комиссия.
 * Проходит, если остаток ≥ денежного минимума И ≥ цена × минимальный процент.
 */
export function economics(
  priceCents: number,
  directCostsCents: number,
  fee: PaymentFee = DEFAULT_PAYMENT_FEE
): Economics {
  const feeCents = paymentFeeCents(priceCents, fee);
  const remainingCents = priceCents - directCostsCents - feeCents;
  const band = bandFor(priceCents);
  const passes =
    remainingCents >= band.minRemainingCents &&
    remainingCents * 10_000 >= priceCents * band.minMarginBp;
  return {
    priceCents,
    feeCents,
    remainingCents,
    margin: priceCents > 0 ? remainingCents / priceCents : NaN,
    band,
    passes,
  };
}

export interface PricingInput {
  /** Итог Farfetch US (товар + доставка + импорт, без sales tax), центы. null — нет пригодного предложения. */
  farfetchCents: number | null;
  /** Итог Italist US, центы. null — нет пригодного предложения. */
  italistCents: number | null;
  /** Все прямые затраты без платёжной комиссии, центы. null — какие-то затраты неизвестны. */
  directCostsCents: number | null;
  fee?: PaymentFee;
}

export interface PricingResult {
  decision: Decision;
  /** Скидка выбранного кандидата, промилле (для ручных решений — 0). */
  discountPermille: number;
  /** Кандидат: для ручных решений — база, не утверждённая цена. null — данных нет. */
  candidate: Economics | null;
  sourceCount: number;
  baseCents: number | null;
  referenceMinCents: number | null;
  reason: string;
}

function candidatePrice(sumCents: number, count: number, permille: number): number {
  // база × (1 − скидка) с одним округлением в самом конце: точность базы сохраняется.
  return divHalfUp(sumCents * (1000 - permille), count * 1000);
}

export function decidePrice(input: PricingInput): PricingResult {
  const fee = input.fee ?? DEFAULT_PAYMENT_FEE;
  const offers = [input.farfetchCents, input.italistCents].filter(
    (v): v is number => typeof v === "number" && v > 0
  );
  const sourceCount = offers.length;

  if (sourceCount === 0) {
    return {
      decision: "MANUAL_DATA",
      discountPermille: 0,
      candidate: null,
      sourceCount,
      baseCents: null,
      referenceMinCents: null,
      reason: "Нет пригодных предложений конкурентов — фиктивную цену не рассчитываем.",
    };
  }

  const sum = offers.reduce((a, b) => a + b, 0);
  const baseCents = candidatePrice(sum, sourceCount, 0);
  const referenceMinCents = Math.min(...offers);

  if (input.directCostsCents === null) {
    return {
      decision: "MANUAL_DATA",
      discountPermille: 0,
      candidate: null,
      sourceCount,
      baseCents,
      referenceMinCents,
      reason: "Неизвестны прямые затраты — null не заменяется нулём.",
    };
  }
  const costs = input.directCostsCents;
  const base = economics(baseCents, costs, fee);

  if (sourceCount === 1) {
    return {
      decision: "MANUAL_ONE_SOURCE",
      discountPermille: 0,
      candidate: base,
      sourceCount,
      baseCents,
      referenceMinCents,
      reason: "Один пригодный источник: ориентир, не среднее. Нужно ручное подтверждение.",
    };
  }

  let someReachFailEconomics = false;
  for (const permille of DISCOUNTS_PERMILLE) {
    const price = candidatePrice(sum, sourceCount, permille);
    if (price > referenceMinCents) continue;
    const econ = economics(price, costs, fee);
    if (!econ.passes) {
      someReachFailEconomics = true;
      continue;
    }
    const decision: Decision =
      permille === 0 ? "KEEP_BASE" : permille === 25 ? "TEST_2_5" : "TEST_5";
    return {
      decision,
      discountPermille: permille,
      candidate: econ,
      sourceCount,
      baseCents,
      referenceMinCents,
      reason:
        permille === 0
          ? "База не дороже ориентира и проходит оба минимума."
          : `Минимально необходимая скидка ${permille / 10}% достигает ориентира и проходит оба минимума.`,
    };
  }

  if (someReachFailEconomics) {
    return {
      decision: "MANUAL_MARGIN",
      discountPermille: 0,
      candidate: base,
      sourceCount,
      baseCents,
      referenceMinCents,
      reason: "Конкурентная цена нарушает минимум маржи или остатка — автоматически не применяем.",
    };
  }
  return {
    decision: "MANUAL_PRICE",
    discountPermille: 0,
    candidate: base,
    sourceCount,
    baseCents,
    referenceMinCents,
    reason: "Даже минус 5% дороже ориентира — скидку автоматически не даём.",
  };
}

/**
 * Минимальная цена, при которой товар проходит сетку при данных затратах:
 * остаток не ниже минимума в долларах И маржа не ниже минимума в процентах
 * диапазона, в который попадает сама цена.
 */
export function floorPriceCents(
  directCostsCents: number,
  fee: PaymentFee = DEFAULT_PAYMENT_FEE
): number {
  let best = Infinity;
  for (const band of BANDS) {
    // P·(1 − fee − m) ≥ costs + fixed  и  P·(1 − fee) − costs − fixed ≥ minRemaining
    const byMargin = Math.ceil(
      ((directCostsCents + fee.fixedCents) * 10_000) / (10_000 - fee.rateBp - band.minMarginBp)
    );
    const byAmount = Math.ceil(
      ((directCostsCents + fee.fixedCents + band.minRemainingCents) * 10_000) / (10_000 - fee.rateBp)
    );
    let p = Math.max(byMargin, byAmount, band.fromCents);
    // Округление комиссии сдвигает границу на цент-другой в обе стороны — добираем перебором.
    while (!economics(p, directCostsCents, fee).passes) p++;
    while (p - 1 >= band.fromCents && economics(p - 1, directCostsCents, fee).passes) p--;
    if (bandFor(p) === band) best = Math.min(best, p);
  }
  return best;
}

/**
 * Цена для витрины из минимума сетки: вверх до целого доллара. Округление
 * вверх только добавляет остатка, но может перевести цену в следующий
 * диапазон (999,40 → 1 000: уже 18% и $200) — поэтому перепроверяем сетку.
 */
export function wholeDollarPriceCents(
  floorCents: number,
  directCostsCents: number,
  fee: PaymentFee = DEFAULT_PAYMENT_FEE
): number {
  let p = Math.ceil(floorCents / 100) * 100;
  while (!economics(p, directCostsCents, fee).passes) p += 100;
  return p;
}

/**
 * Как получена автоматическая цена:
 *  - MARKET — по рынку v1.0 (KEEP_BASE / TEST_2_5 / TEST_5), когда есть цены конкурентов;
 *  - GRID — минимум сетки маржи по нашим затратам, когда рыночного решения нет.
 */
export type PriceMethod = "MARKET" | "GRID";

export interface AutoPrice {
  priceCents: number;
  method: PriceMethod;
  /** Решение v1.0 по рынку (MANUAL_DATA, пока цен конкурентов нет). */
  decision: Decision;
  economics: Economics;
  reason: string;
}

/**
 * Предложение конкурента. Валюта и страна — обязательные поля, а не
 * подразумеваемые: Farfetch и Italist показывают цену в валюте региона
 * (Farfetch по умолчанию — фунты/евро), а «$» ещё бывает CAD/AUD/HKD.
 * Знак валюты на странице ничего не доказывает — нужен явный код.
 */
export interface MarketOffer {
  /** Итог для покупателя в США: товар + доставка + импорт, без sales tax, центы. */
  totalCents: number;
  /** ISO-код валюты цены, как её показал сайт. В расчёт идёт только USD. */
  currency: string;
  /** Страна витрины и доставки. В расчёт идёт только US (Farfetch US, Italist US). */
  country: string;
}

export interface MarketOffers {
  farfetch: MarketOffer | null;
  italist: MarketOffer | null;
}

/**
 * Пригодность предложения по валюте и рынку. Не USD или не US — предложение
 * исключается (как недоступный вариант, I01), а не пересчитывается по курсу:
 * цена в Великобритании или ЕС — другой рынок с другим НДС и пошлинами.
 */
export function offerUsdCents(offer: MarketOffer | null): { cents: number | null; problem?: string } {
  if (!offer) return { cents: null };
  const currency = offer.currency.trim().toUpperCase();
  const country = offer.country.trim().toUpperCase();
  if (currency !== "USD") return { cents: null, problem: `валюта ${currency || "не указана"}, нужна USD` };
  if (country !== "US") return { cents: null, problem: `витрина ${country || "не указана"}, нужна US` };
  if (!Number.isInteger(offer.totalCents) || offer.totalCents <= 0) return { cents: null, problem: "нет цены" };
  return { cents: offer.totalCents };
}

/**
 * Автоматическая цена товара при импорте.
 *
 * Если по v1.0 есть автоматическое рыночное решение — берём его кандидата.
 * Иначе (цен конкурентов нет, один источник, рынок не проходит сетку) —
 * минимальная цена, проходящая сетку маржи «Логика v1.0» по нашим затратам,
 * в целых долларах. Это цена-кандидат на черновике: публикует и утверждает
 * человек (R19), рыночную цену выше он может поставить вручную.
 *
 * null — затраты неизвестны: фиктивную цену не считаем (MANUAL_DATA).
 */
export function autoPrice(
  directCostsCents: number | null,
  market: MarketOffers = { farfetch: null, italist: null },
  fee: PaymentFee = DEFAULT_PAYMENT_FEE
): AutoPrice | null {
  if (directCostsCents === null) return null;
  const farfetch = offerUsdCents(market.farfetch);
  const italist = offerUsdCents(market.italist);
  const rejected = [
    farfetch.problem && `Farfetch исключён: ${farfetch.problem}.`,
    italist.problem && `Italist исключён: ${italist.problem}.`,
  ].filter(Boolean).join(" ");
  const d = decidePrice({ farfetchCents: farfetch.cents, italistCents: italist.cents, directCostsCents, fee });
  if (d.candidate && (d.decision === "KEEP_BASE" || d.decision === "TEST_2_5" || d.decision === "TEST_5")) {
    return {
      priceCents: d.candidate.priceCents,
      method: "MARKET",
      decision: d.decision,
      economics: d.candidate,
      reason: [d.reason, rejected].filter(Boolean).join(" "),
    };
  }
  const priceCents = wholeDollarPriceCents(floorPriceCents(directCostsCents, fee), directCostsCents, fee);
  const econ = economics(priceCents, directCostsCents, fee);
  return {
    priceCents,
    method: "GRID",
    decision: d.decision,
    economics: econ,
    reason:
      `Рыночного решения нет (${d.decision}) — минимум сетки: маржа ≥ ${econ.band.minMarginBp / 100}% ` +
      `и остаток ≥ $${econ.band.minRemainingCents / 100}.` +
      (rejected ? ` ${rejected}` : ""),
  };
}
