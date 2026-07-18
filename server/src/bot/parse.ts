import type { ManagerRequest } from "../types";

/**
 * Формат сообщения менеджера (три части, разделитель «|» или перенос строки):
 *   Название товара | Наша цена | Дизайнер
 * Пример:
 *   GG Marmont small shoulder bag | 1490€ | Gucci
 */
const SEPARATOR = /\s*(?:\||\n)\s*/;

export function parsePrice(
  raw: string,
  defaultCurrency = "EUR"
): { amount: number; currency: string } | null {
  let currency = defaultCurrency;
  if (/\$|usd/i.test(raw)) currency = "USD";
  else if (/£|gbp/i.test(raw)) currency = "GBP";
  else if (/€|eur/i.test(raw)) currency = "EUR";

  let digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return null;

  if (digits.includes(",") && digits.includes(".")) {
    // 1,299.50 — запятые как разделители тысяч
    digits = digits.replace(/,/g, "");
  } else if (digits.includes(",")) {
    const frac = digits.split(",").pop()!;
    // 1290,50 — десятичная запятая; 1,290 — разделитель тысяч
    digits = frac.length <= 2 ? digits.replace(",", ".") : digits.replace(/,/g, "");
  }

  const amount = Number.parseFloat(digits);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency };
}

export function parseManagerMessage(
  text: string,
  defaultCurrency = "EUR"
): ManagerRequest | null {
  const cleaned = text.replace(/^\/check(?:@\w+)?\s*/i, "").trim();
  const parts = cleaned.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const [title, priceRaw, ...rest] = parts;
  const designer = rest.join(" ").trim();
  const price = parsePrice(priceRaw, defaultCurrency);
  if (!title || !designer || !price) return null;

  return { title, ourPrice: price.amount, currency: price.currency, designer };
}

/** Похоже ли обычное сообщение (без команды) на запрос по нашему формату. */
export function looksLikeRequest(text: string): boolean {
  return (text.match(/\|/g) ?? []).length >= 2;
}
