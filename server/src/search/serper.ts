import type { SearchHit } from "../types";

/** Поиск через Google (serper.dev). 2500 бесплатных запросов, дальше ~$0.3/1000. */
export async function serperSearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Serper: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
  };
  return (data.organic ?? [])
    .filter((r) => r.link)
    .map((r) => ({ title: r.title ?? "", link: r.link!, snippet: r.snippet }));
}
