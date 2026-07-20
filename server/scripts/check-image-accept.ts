/** Проверка: какой формат отдаёт CDN при разных Accept-заголовках. */
import { BROWSER_HEADERS } from "../src/scrape/fetchPage";

const url =
  "https://media.gucci.com/style/DarkGray_Center_0_0_2400x2400/1782829828/764960_K9GSG_8367_001_057_0000_Light-ophidia-mini-bag.jpg";

const accepts = [
  "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "image/jpeg,image/png;q=0.9,*/*;q=0.5",
  "image/jpeg",
];

for (const accept of accepts) {
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: accept },
      signal: AbortSignal.timeout(25_000),
    });
    const buf = await res.arrayBuffer();
    console.log(
      `Accept: ${accept.slice(0, 40)}… → ${res.status} ${res.headers.get("content-type")} ${Math.round(buf.byteLength / 1024)}KB`
    );
  } catch (err) {
    console.log(`Accept: ${accept.slice(0, 40)}… → FAIL ${String(err).slice(0, 60)}`);
  }
}
