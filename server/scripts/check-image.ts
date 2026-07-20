/** Проверка доступности картинок: npx tsx scripts/check-image.ts <url> [url…] */
import { BROWSER_HEADERS } from "../src/scrape/fetchPage";

for (const url of process.argv.slice(2)) {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    const buf = res.ok ? await res.arrayBuffer() : null;
    console.log(
      `${res.status} ${res.headers.get("content-type")} ${buf ? Math.round(buf.byteLength / 1024) + "KB" : ""} — ${url.slice(0, 90)}`
    );
  } catch (err) {
    console.log(`FAIL ${String(err).slice(0, 80)} — ${url.slice(0, 90)}`);
  }
}
