/**
 * Затраты на товар TheDoubleF для США — по листу «Расчет на 1 товар»
 * таблицы экономики (Артур, 06.10.2026). Все ставки — рабочие оценки:
 * доставка и брокер «заменить договорным тарифом», пошлина «временная
 * ставка до получения HTS-кода». Поэтому результат помечается как estimate
 * и сам по себе цену не утверждает.
 */

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
  /** Оценка пошлины, базисные пункты. */
  duty: {
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
  duty: { euAccessories: 1500, euClothing: 2200, euShoes: 2500, nonEu: 3000 },
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

export function dutyRateBp(
  category: CategoryResult | null,
  country: string | null,
  s: CostSettings
): number {
  if (!country || !EU.has(country)) return s.duty.nonEu;
  if (category?.section === "Shoes") return s.duty.euShoes;
  if (category?.section === "Clothing") return s.duty.euClothing;
  return s.duty.euAccessories;
}

export interface CostEstimate {
  purchaseEurCents: number;
  purchaseUsdCents: number;
  dutyBp: number;
  dutyCents: number;
  /** Все прямые затраты без платёжной комиссии. */
  directCostsCents: number;
  /** Цена безубыточности (остаток = 0). */
  breakEvenCents: number;
  /** Минимальная цена, проходящая сетку v1.0, при этих оценках. Справка, не цена продажи. */
  floorCents: number;
}

export function estimateCosts(
  price: number | null,
  salePrice: number | null,
  category: CategoryResult | null,
  madeIn: string,
  s: CostSettings = DEFAULT_COSTS
): CostEstimate | null {
  const eur = purchaseEurCents(price, salePrice);
  if (eur === null) return null;
  const usd = eurToUsdCents(eur, s.eurUsd);
  const dutyBp = dutyRateBp(category, countryCode(madeIn), s);
  const dutyCents = divHalfUp(usd * dutyBp, 10_000);
  const direct = usd + dutyCents + s.shippingCents + s.brokerCents + s.otherCents;
  const breakEven = Math.ceil(((direct + s.fee.fixedCents) * 10_000) / (10_000 - s.fee.rateBp));
  return {
    purchaseEurCents: eur,
    purchaseUsdCents: usd,
    dutyBp,
    dutyCents,
    directCostsCents: direct,
    breakEvenCents: breakEven,
    floorCents: floorPriceCents(direct, s.fee),
  };
}
