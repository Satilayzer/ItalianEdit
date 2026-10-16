/**
 * Таблица базовых ставок пошлины США (MFN, «General») по 6-значным HS-кодам
 * каталога TheDoubleF — из официального тарифа USITC (hts.usitc.gov).
 *
 *   npx tsx scripts/us-hts-rates.ts [--feed <url|путь>]   → server/data/us-hts-rates.json
 *
 * Код поставщика — 8 знаков ТН ВЭД ЕС; с тарифом США совпадают только первые
 * 6. Внутри позиции ставки различаются (пол, состав), а их по коду ЕС не
 * восстановить, поэтому берём НАИБОЛЬШУЮ ставку позиции — осторожная оценка.
 * Составная ставка («25.4¢/kg + 7.7%») — процентная часть + 2 п.п. запаса.
 * Пересобирать при изменении тарифа США или появлении новых кодов в фиде.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFeed, groupProducts, fetchFeed, DEFAULT_FEED_URL } from "../src/tdf/feed";

const args = process.argv.slice(2);
const feedArg = args[args.indexOf("--feed") + 1];
const feedSrc = args.includes("--feed") ? feedArg : process.env.TDF_FEED_URL ?? DEFAULT_FEED_URL;

/** «16.6%» → 16.6; «25.4¢/kg + 7.7%» → 9.7; «Free» → 0; только специфическая — null. */
export function adValoremPercent(general: string | null): number | null {
  if (!general) return null;
  const g = general.trim();
  if (/^free$/i.test(g)) return 0;
  const percents = [...g.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  if (percents.length === 0) return null;
  const specific = /¢|\$|\/kg|\/pr|\/doz|\/article|\/no\./i.test(g.replace(/\d+(?:\.\d+)?%/g, ""));
  return percents.reduce((a, b) => a + b, 0) + (specific ? 2 : 0);
}

/**
 * Коды старой редакции (HS 2017), которыми поставщик ещё пишет пальто и
 * куртки: в HS 2022 позиции 6201/6202 переразбиты по материалу. 6505.90 в
 * тарифе США — одна позиция 6505.00.
 */
const ALIASES: Record<string, string> = {
  "620111": "620120", "620191": "620120", "620112": "620130", "620192": "620130",
  "620113": "620140", "620193": "620140", "620119": "620190", "620199": "620190",
  "620211": "620220", "620291": "620220", "620212": "620230", "620292": "620230",
  "620213": "620240", "620293": "620240", "620219": "620290", "620299": "620290",
  "650590": "650500",
};

/** Строки, которые к нашему товару заведомо не относятся. */
const IRRELEVANT = /hand-loomed|folklore|babies|hair-nets|waterfowl plumage|of abaca/i;

async function main() {
  const products = existsSync(feedSrc) ? groupProducts(parseFeed(readFileSync(feedSrc, "utf8"))) : await fetchFeed(feedSrc);
  const hs6 = [...new Set(products.map((p) => p.hsCode.replace(/\D/g, "").slice(0, 6)).filter((c) => c.length === 6))].sort();
  console.log(`HS-позиций в фиде: ${hs6.length}`);

  const table: Record<string, { rate: number; lines: string[] }> = {};
  const unresolved: string[] = [];
  for (const code of hs6) {
    const us = ALIASES[code] ?? code;
    const keyword = us.endsWith("00") ? `${us.slice(0, 4)}.00` : `${us.slice(0, 4)}.${us.slice(4)}`;
    const res = await fetch(`https://hts.usitc.gov/reststop/search?keyword=${keyword}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const rows = (await res.json()) as { htsno: string; description: string; general: string | null }[];
    let candidates = rows.filter(
      (r) => r.htsno?.replace(/\D/g, "").startsWith(us) && r.general && !IRRELEVANT.test(r.description ?? "")
    );
    // Обувь: ставка зависит от стоимости пары. Наш товар — люкс, так что если у
    // позиции есть строки «Valued over $12/pair», берём только их: строки для
    // пар дешевле $3–12 (до 48%) к нам не относятся.
    const premium = candidates.filter((r) => /valued over \$12/i.test(r.description) && !/not over/i.test(r.description));
    if (code.startsWith("64") && premium.length > 0) candidates = premium;
    let best: number | null = null;
    const lines: string[] = [];
    for (const r of candidates) {
      const pct = adValoremPercent(r.general);
      if (pct === null) continue;
      lines.push(`${r.htsno} ${r.general}`);
      best = best === null ? pct : Math.max(best, pct);
    }
    if (best === null) unresolved.push(code);
    else table[code] = { rate: Math.round(best * 10) / 10, lines };
    await new Promise((r) => setTimeout(r, 300)); // бережно к USITC
  }

  const out = fileURLToPath(new URL("../data/us-hts-rates.json", import.meta.url));
  writeFileSync(
    out,
    JSON.stringify(
      {
        source: "USITC HTS (hts.usitc.gov), column General (MFN); max ad valorem per HS6, compound + 2 p.p.",
        fetchedAt: new Date().toISOString().slice(0, 10),
        rates: Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.rate])),
        lines: Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.lines])),
        unresolved,
      },
      null,
      1
    ) + "\n",
    "utf8"
  );
  console.log(`Ставок: ${Object.keys(table).length}, без ставки: ${unresolved.length} ${unresolved.join(" ")}\nФайл: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
