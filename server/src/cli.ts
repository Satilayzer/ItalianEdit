/**
 * Проверка поиска без Телеграма:
 *   npm run lookup -- "GG Marmont small shoulder bag | 1490 | Gucci"
 */
import "dotenv/config";
import { parseManagerMessage } from "./bot/parse";
import { findProduct } from "./search/findProduct";

const input = process.argv.slice(2).join(" ").trim();
if (!input) {
  console.error('Использование: npm run lookup -- "Название | Цена | Дизайнер"');
  process.exit(1);
}

const req = parseManagerMessage(input);
if (!req) {
  console.error("Не удалось разобрать запрос. Формат: Название | Цена | Дизайнер");
  process.exit(1);
}

const config = {
  botToken: "cli",
  serperApiKey: process.env.SERPER_API_KEY || undefined,
  defaultCurrency: process.env.DEFAULT_CURRENCY || "EUR",
  port: 0,
  inventoryCap: 1,
  pushBatch: 25,
  importMode: "app" as const,
};

console.log("Запрос:", req);
const result = await findProduct(req, config);
if (result.info) {
  console.log(JSON.stringify(result.info, null, 2));
} else if (result.failure === "unknown-designer") {
  console.log("Официальный сайт дизайнера не определён.");
} else {
  console.log(`Товар не найден на официальном сайте ${result.domain}.`);
}
