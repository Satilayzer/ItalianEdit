import type { ManagerRequest } from "../types";

/**
 * Формат сообщения менеджера — 4 строки (или части через «|»):
 *   Название товара
 *   Вариация (цвет/модель)
 *   Дизайнер
 *   Наша цена
 * Без вариации допустимы 3 строки: Название / Дизайнер / Цена.
 * Цена всегда последней — по ней и различаем форматы.
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

  const price = parsePrice(parts[parts.length - 1], defaultCurrency);
  if (!price) return null;

  const title = parts[0];
  let variation: string | undefined;
  let designer: string;
  if (parts.length === 3) {
    designer = parts[1];
  } else {
    variation = parts[1];
    designer = parts.slice(2, -1).join(" ").trim();
  }
  if (!title || !designer) return null;

  return {
    title,
    variation,
    ourPrice: price.amount,
    currency: price.currency,
    designer,
  };
}

/** Похоже ли обычное сообщение (без команды) на запрос по нашему формату. */
export function looksLikeRequest(text: string): boolean {
  if ((text.match(/\|/g) ?? []).length >= 2) return true;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 3 && lines.length <= 6 && /\d/.test(lines[lines.length - 1]);
}
