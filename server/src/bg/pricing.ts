/** Правила наценки. Дефолт + переопределения по бренду (ключ — бренд в нижнем регистре). */
export interface PricingRules {
  defaultMultiplier: number;
  byBrand?: Record<string, number>;
}

export const DEFAULT_PRICING: PricingRules = {
  defaultMultiplier: 1.8,
};

/** Округление цены вверх до «круглого»: <100 → до 5, иначе → до 10. */
export function prettyRound(value: number): number {
  if (value <= 0) return 0;
  const step = value < 100 ? 5 : 10;
  return Math.ceil(value / step) * step;
}

/** Наценка для конкретного бренда. */
export function multiplierFor(brand: string | undefined, rules: PricingRules): number {
  if (brand && rules.byBrand) {
    const m = rules.byBrand[brand.toLowerCase()];
    if (m) return m;
  }
  return rules.defaultMultiplier;
}

/**
 * Наша розничная цена из оптовой цены BG.
 * wholesale — цена, по которой мы закупаем (см. вопрос к BG про regular/sale_price).
 */
export function computeOurPrice(
  wholesale: number,
  brand: string | undefined,
  rules: PricingRules = DEFAULT_PRICING
): number {
  const raw = wholesale * multiplierFor(brand, rules);
  return prettyRound(raw);
}
