import type { ManagerRequest, ProductInfo } from "../types";
import { compare } from "../compare";

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
};

export function fmtPrice(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(amount);
  return symbol ? `${formatted} ${symbol}` : `${formatted} ${currency}`;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** Карточка товара для ответа в группе (HTML parse mode Телеграма). */
export function formatCard(req: ManagerRequest, info: ProductInfo): string {
  const brand = info.brand ?? req.designer;
  const lines: string[] = [];

  lines.push(`🛍 <b>${esc(info.title)}</b>`);
  lines.push(`🎨 Дизайнер: <b>${esc(brand)}</b>`);
  lines.push("");

  const cmp = compare(req, info);

  if (info.price && info.currency) {
    lines.push(
      `🏷 Цена на сайте ${esc(brand)}: <s>${fmtPrice(info.price, info.currency)}</s>`
    );
  } else {
    lines.push(`🏷 Цена на сайте ${esc(brand)}: не найдена`);
  }

  let ourLine = `✅ Наша цена: <b>${fmtPrice(req.ourPrice, req.currency)}</b>`;
  if (cmp.savingsPercent !== undefined) {
    ourLine +=
      cmp.savingsPercent > 0
        ? ` — выгоднее на ${cmp.savingsPercent}%! 🔥`
        : " — у нас дешевле! 🔥";
  }
  lines.push(ourLine);

  if (info.availability) {
    const inStock = /instock/i.test(info.availability);
    lines.push(inStock ? "📦 На сайте бренда: в наличии" : `📦 ${esc(info.availability)}`);
  }

  if (info.description) {
    lines.push("");
    lines.push(esc(truncate(info.description, 300)));
  }

  lines.push("");
  lines.push(`🔗 <a href="${info.url}">Товар на сайте ${esc(brand)}</a>`);

  return lines.join("\n");
}

export const HELP_TEXT = [
  "Пришлите запрос в формате:",
  "",
  "<code>Название товара | Наша цена | Дизайнер</code>",
  "",
  "Пример:",
  "<code>GG Marmont small shoulder bag | 1490€ | Gucci</code>",
  "",
  "Можно и командой: <code>/check Название | Цена | Дизайнер</code>",
].join("\n");
