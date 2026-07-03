export type NewsHeadline = {
  id: string;
  text: string;
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
      .map((item) => ({ id: `hn-${item.id}`, text: item.title }));

    if (!headlines.length) return cachedHeadlines;

    cachedHeadlines = headlines;
    cachedAt = Date.now();
    return cachedHeadlines;
  } catch {
    return cachedHeadlines;
  }
}
