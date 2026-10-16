/**
 * Затраты на товар TheDoubleF для США — по листу «Расчет на 1 товар»
 * таблицы экономики (Артур, 06.10.2026). Все ставки — рабочие оценки:
 * доставка и брокер «заменить договорным тарифом», пошлина «временная
 * ставка до получения HTS-кода». Поэтому результат помечается как estimate
 * и сам по себе цену не утверждает.
 *
 * Пошлина с 16.10.2026 — по HS-коду поставщика: базовая ставка США (MFN) из
 * data/us-hts-rates.json (scripts/us-hts-rates.ts), для товаров из ЕС — не
 * ниже 15% (сделка США–ЕС, «15% всё включено», с 01.07.2026), для остальных —
 * не ниже прежней осторожной оценки. Кода нет в таблице — оценка по группе.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CategoryResult } from "./category";
import { DEFAULT_PAYMENT_FEE, divHalfUp, floorPriceCents, type PaymentFee } from "./pricing";

export interface CostSettings {
  /** Курс EUR→USD и дата, на которую он взят (сохраняется вместе с расчётом). */
  eurUsd: number;
  eurUsdDate: string;
  shippingCents: number;
  brokerCents: number;
  otherCents: number;
  fee: PaymentFee;
  /** НДС Италии, базисные пункты: розничная цена поставщика = price × (1 + НДС). */
  retailVatBp: number;
  /** Базовые ставки США по 6-значному HS-коду, %. null — считаем по группе. */
  usRates: Record<string, number> | null;
  /** Оценка пошлины, базисные пункты. */
  duty: {
    /** Минимум для товаров из ЕС по сделке США–ЕС («15% всё включено»). */
    euDealFloor: number;
    euAccessories: number;
    euClothing: number;
    euShoes: number;
    nonEu: number;
  };
}

export const DEFAULT_COSTS: CostSettings = {
  // Справочный курс ЕЦБ на 09.10.2026 (в таблице экономики было 1,1298 на 01.10).
  eurUsd: Number(process.env.TDF_EUR_USD) || 1.1206,
  eurUsdDate: process.env.TDF_EUR_USD_DATE || "2026-10-09",
  shippingCents: 3_500,
  brokerCents: 2_500,
  otherCents: 0,
  fee: DEFAULT_PAYMENT_FEE,
  retailVatBp: 2200,
  usRates: loadUsRates(),
  duty: { euDealFloor: 1500, euAccessories: 1500, euClothing: 2200, euShoes: 2500, nonEu: 3000 },
};

/** Страна производства из «Made in …» → ISO-код (для таможни и выбора ставки). */
const COUNTRIES: Record<string, string> = {
  italy: "IT", china: "CN", portugal: "PT", vietnam: "VN", turkey: "TR", india: "IN",
  romania: "RO", tunisia: "TN", bulgaria: "BG", "united kingdom": "GB", japan: "JP",
  spain: "ES", indonesia: "ID", "united states": "US", albania: "AL", "south korea": "KR",
  cambodia: "KH", morocco: "MA", bangladesh: "BD", philippines: "PH", moldova: "MD",
  poland: "PL", germany: "DE", france: "FR", thailand: "TH", lithuania: "LT",
  hungary: "HU", mexico: "MX", "dominican republic": "DO", madagascar: "MG",
  mauritius: "MU", egypt: "EG", canada: "CA", macao: "MO", "el salvador": "SV",
  guadalupa: "GP", switzerland: "CH", slovakia: "SK", croatia: "HR", "sri lanka": "LK",
  jordan: "JO", brazil: "BR", myanmar: "MM", belgium: "BE", ireland: "IE", latvia: "LV",
  luxembourg: "LU", serbia: "RS", "isola di man": "IM", mongolia: "MN", guatemala: "GT",
  "porto rico": "US" /* Пуэрто-Рико — территория США; кода PR в списке Shopify нет */, "bosnia and herzegovina": "BA", kenya: "KE", greece: "GR",
  austria: "AT", netherlands: "NL", denmark: "DK", sweden: "SE", czechia: "CZ",
  "czech republic": "CZ", slovenia: "SI", estonia: "EE", finland: "FI", pakistan: "PK",
  "sri-lanka": "LK", peru: "PE", colombia: "CO", ukraine: "UA", georgia: "GE",
  "north macedonia": "MK", macedonia: "MK", taiwan: "TW", "hong kong": "HK", malaysia: "MY",
};

const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function countryCode(madeIn: string): string | null {
  const name = madeIn.replace(/^made in\s+/i, "").trim().toLowerCase();
  return COUNTRIES[name] ?? null;
}

/**
 * Закупка, EUR-центы: sale_price, если больше нуля; явный 0 — price.
 * Пропуск, отрицательное или некорректное значение — null (нужна проверка),
 * а не ноль (сценарий I03).
 */
export function purchaseEurCents(price: number | null, salePrice: number | null): number | null {
  if (salePrice !== null && salePrice > 0) return Math.round(salePrice * 100);
  if (salePrice === 0 && price !== null && price > 0) return Math.round(price * 100);
  return null;
}

export function eurToUsdCents(eurCents: number, rate: number): number {
  // курс с 4 знаками → целые: 1.1298 → 11298
  return divHalfUp(eurCents * Math.round(rate * 10_000), 10_000);
}

function loadUsRates(): Record<string, number> | null {
  try {
    const path = fileURLToPath(new URL("../../data/us-hts-rates.json", import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")).rates ?? null;
  } catch {
    return null;
  }
}

/** Базовая ставка США по HS-коду, базисные пункты. null — кода нет в таблице. */
export function usMfnBp(hsCode: string, s: CostSettings = DEFAULT_COSTS): number | null {
  const hs6 = hsCode.replace(/\D/g, "").slice(0, 6);
  const pct = hs6.length === 6 ? s.usRates?.[hs6] : undefined;
  return pct === undefined ? null : Math.round(pct * 100);
}

export function dutyRateBp(
  category: CategoryResult | null,
  country: string | null,
  s: CostSettings,
  hsCode = ""
): number {
  const eu = !!country && EU.has(country);
  const mfn = usMfnBp(hsCode, s);
  if (mfn !== null) return Math.max(mfn, eu ? s.duty.euDealFloor : s.duty.nonEu);
  if (!eu) return s.duty.nonEu;
  if (category?.section === "Shoes") return s.duty.euShoes;
  if (category?.section === "Clothing") return s.duty.euClothing;
  return s.duty.euAccessories;
}

export interface CostEstimate {
  purchaseEurCents: number;
  purchaseUsdCents: number;
  dutyBp: number;
  /** HTS — ставка по HS-коду; estimate — оценка по группе товара. */
  dutyBasis: "HTS" | "estimate";
  dutyCents: number;
  /** Все прямые затраты без платёжной комиссии. */
  directCostsCents: number;
  /** Цена безубыточности (остаток = 0). */
  breakEvenCents: number;
  /** Минимальная цена, проходящая сетку v1.0, при этих оценках. Справка, не цена продажи. */
  floorCents: number;
}

/**
 * Розничная цена модели в Италии, USD: price поставщика (без НДС) + НДС 22%,
 * по рабочему курсу, до целого доллара. Это зачёркнутая цена на витрине
 * (решение 13.10.2026, вариант B): реальная цена, по которой товар продаётся
 * в рознице, а не закупочная скидка поставщика. null — цены поставщика нет.
 */
export function retailItalyUsdCents(priceEur: number | null, s: CostSettings = DEFAULT_COSTS): number | null {
  if (priceEur === null || !(priceEur > 0)) return null;
  const withVat = divHalfUp(Math.round(priceEur * 100) * (10_000 + s.retailVatBp), 10_000);
  return divHalfUp(eurToUsdCents(withVat, s.eurUsd), 100) * 100;
}

/**
 * Зачёркнутая цена для нашей цены: розничная цена в Италии, только если она
 * выше нашей хотя бы на 1% (меньшая разница — округление, а не скидка;
 * тема такие проценты и не показывает). Иначе null — compare-at снимаем.
 */
export function compareAtCents(retailCents: number | null, priceCents: number | null): number | null {
  if (retailCents === null || !priceCents) return null;
  return retailCents * 100 > priceCents * 101 ? retailCents : null;
}

export function estimateCosts(
  price: number | null,
  salePrice: number | null,
  category: CategoryResult | null,
  madeIn: string,
  s: CostSettings = DEFAULT_COSTS,
  hsCode = ""
): CostEstimate | null {
  const eur = purchaseEurCents(price, salePrice);
  if (eur === null) return null;
  const usd = eurToUsdCents(eur, s.eurUsd);
  const dutyBp = dutyRateBp(category, countryCode(madeIn), s, hsCode);
  const dutyCents = divHalfUp(usd * dutyBp, 10_000);
  const direct = usd + dutyCents + s.shippingCents + s.brokerCents + s.otherCents;
  const breakEven = Math.ceil(((direct + s.fee.fixedCents) * 10_000) / (10_000 - s.fee.rateBp));
  return {
    purchaseEurCents: eur,
    purchaseUsdCents: usd,
    dutyBp,
    dutyBasis: usMfnBp(hsCode, s) !== null ? "HTS" : "estimate",
    dutyCents,
    directCostsCents: direct,
    breakEvenCents: breakEven,
    floorCents: floorPriceCents(direct, s.fee),
  };
}
