/** Отладка: показать участки HTML страницы вокруг заданных строк.
 *  npx tsx scripts/inspect-page.ts <url> <метка1> [метка2] …
 */
import { fetchPage } from "../src/scrape/fetchPage";

const [url, ...labels] = process.argv.slice(2);
if (!url) {
  console.error("Использование: npx tsx scripts/inspect-page.ts <url> <метка>…");
  process.exit(1);
}
const html = await fetchPage(url);
if (!html) {
  console.log("Страница не загрузилась (антибот?)");
  process.exit(1);
}
console.log("Длина HTML:", html.length);
for (const label of labels) {
  const i = html.indexOf(label);
  console.log(`\n=== «${label}»: index ${i} ===`);
  if (i >= 0) {
    console.log(html.substring(Math.max(0, i - 500), i + 1500).replace(/\s+/g, " "));
  }
}
