import { XMLParser } from "fast-xml-parser";

export type NewsHeadline = {
  id: string;
  text: string;
  source?: "hn" | "fox";
};

// Ambient/decorative content only — never surfaced as an alert or error.
// Cache is deliberately long (this doesn't need to be fresh) and the fetch
// never throws, matching the discipline in lib/analytics.ts: in-flight
// de-duplication, a generous TTL, and a silent fallback to the last good
// result (or an empty list on a cold start) rather than ever failing loud.
const NEWS_CACHE_MS = 900_000;
const HEADLINE_COUNT = 8;
const FETCH_TIMEOUT_MS = 5000;
const HN_TOPSTORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

let cachedHeadlines: NewsHeadline[] = [];
let cachedAt = 0;
let pendingFetch: Promise<NewsHeadline[]> | null = null;

export async function getNewsHeadlines(): Promise<NewsHeadline[]> {
  const now = Date.now();
  if (now - cachedAt < NEWS_CACHE_MS) {
    return cachedHeadlines;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = fetchHeadlines().finally(() => {
    pendingFetch = null;
  });

  return pendingFetch;
}

async function fetchHeadlines(): Promise<NewsHeadline[]> {
  try {
    const idsResponse = await fetch(HN_TOPSTORIES_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!idsResponse.ok) return cachedHeadlines;

    const ids = ((await idsResponse.json()) as number[]).slice(0, HEADLINE_COUNT);

    const items = await Promise.all(
      ids.map((id) =>
        fetch(HN_ITEM_URL(id), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
      )
    );

    const headlines = items
      .filter((item): item is { id: number; title: string } => Boolean(item?.title))
      .map((item) => ({ id: `hn-${item.id}`, text: item.title, source: "hn" as const }));

    if (!headlines.length) return cachedHeadlines;

    cachedHeadlines = headlines;
    cachedAt = Date.now();
    return cachedHeadlines;
  } catch {
    return cachedHeadlines;
  }
}

// Fox News breaking-news headlines, pulled from their public RSS feed (no API
// key). Same discipline as the Hacker News fetch above: generous TTL cache,
// in-flight de-dup, silent fallback to the last-good/empty result — a broken
// or slow feed URL must never surface an error or block the rest of the
// wallboard payload.
// stopNodes leaves the full article body/description raw instead of
// entity-decoding it — we only need title/link, and Fox's feed embeds enough
// HTML-entity-laden article content in those fields to trip fast-xml-parser's
// entity-expansion guard (a safeguard against billion-laughs-style payloads)
// if left to fully parse.
const foxParser = new XMLParser({
  ignoreAttributes: true,
  textNodeName: "text",
  stopNodes: ["rss.channel.item.description", "rss.channel.item.content:encoded", "rss.channel.description"]
});

let cachedFoxHeadlines: NewsHeadline[] = [];
let cachedFoxAt = 0;
let pendingFoxFetch: Promise<NewsHeadline[]> | null = null;

export async function getFoxHeadlines(rssUrl: string): Promise<NewsHeadline[]> {
  const now = Date.now();
  if (now - cachedFoxAt < NEWS_CACHE_MS) {
    return cachedFoxHeadlines;
  }

  if (pendingFoxFetch) {
    return pendingFoxFetch;
  }

  pendingFoxFetch = fetchFoxHeadlines(rssUrl).finally(() => {
    pendingFoxFetch = null;
  });

  return pendingFoxFetch;
}

async function fetchFoxHeadlines(rssUrl: string): Promise<NewsHeadline[]> {
  try {
    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/rss+xml, application/xml, text/xml" }
    });
    if (!response.ok) return cachedFoxHeadlines;

    const xml = await response.text();
    const parsed = foxParser.parse(xml) as {
      rss?: { channel?: { item?: unknown } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    const headlines: NewsHeadline[] = [];
    for (const [index, item] of items.entries()) {
      const record = item as Record<string, unknown>;
      const title =
        typeof record.title === "string"
          ? record.title
          : typeof (record.title as Record<string, unknown>)?.text === "string"
            ? ((record.title as Record<string, unknown>).text as string)
            : null;
      if (!title) continue;
      const link = typeof record.link === "string" ? record.link : `fox-${index}`;
      headlines.push({ id: `fox-${link}`, text: title.trim(), source: "fox" });
      if (headlines.length >= HEADLINE_COUNT) break;
    }

    if (!headlines.length) return cachedFoxHeadlines;

    cachedFoxHeadlines = headlines;
    cachedFoxAt = Date.now();
    return cachedFoxHeadlines;
  } catch {
    return cachedFoxHeadlines;
  }
}
