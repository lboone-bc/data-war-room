export type YoutubeLiveStatus = {
  live: boolean;
  videoId: string | null;
};

const OFFLINE_STATUS: YoutubeLiveStatus = { live: false, videoId: null };

// No YouTube Data API key required or used. YouTube's /<handle>/live path
// canonicalizes to the specific https://www.youtube.com/watch?v=<id> URL only
// while the channel actually has an active broadcast; when it's offline the
// canonical link stays on the plain channel page. That canonical-link swap
// is a reliable, key-free live/offline signal, so we scrape just that one
// tag rather than parsing the full page or calling the quota-limited Data
// API for something as simple as "are they live right now". Use the
// @handle path, not /channel/<id>/live — confirmed via direct curl
// (2026-07-05) that the channel-ID path is unreliable for at least one real
// channel (stayed on the channel page while genuinely live) while the
// handle path correctly resolved to the live watch URL for every channel
// tested. Handles must include the leading "@" (e.g. "@BiltmoreChurch").
const LIVE_URL = (handle: string) => `https://www.youtube.com/${handle}/live`;
const CANONICAL_WATCH_PATTERN =
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})">/;

// Same discipline as lib/analytics.ts / lib/apify.ts: a generous TTL
// cache, in-flight de-duplication so concurrent requests share one fetch,
// and a silent fallback to the last-good result on failure — never throw,
// never surface a raw scrape/network error to the UI. 45s is short enough
// that "went live" shows up promptly, but long enough to stay a light,
// occasional request rather than hammering youtube.com on every client poll.
const LIVE_CACHE_MS = 45_000;
const FETCH_TIMEOUT_MS = 6000;

// Keyed per-handle so the primary channel and the fallback channel (see
// app/api/wallboard/route.ts) each get their own cache/in-flight-dedup
// instead of stomping on each other's last-good result.
const cache = new Map<string, { status: YoutubeLiveStatus; at: number }>();
const pendingFetches = new Map<string, Promise<YoutubeLiveStatus>>();

export async function getYoutubeLiveStatus(handle: string): Promise<YoutubeLiveStatus> {
  const now = Date.now();
  const cached = cache.get(handle);
  if (cached && now - cached.at < LIVE_CACHE_MS) {
    return cached.status;
  }

  const pending = pendingFetches.get(handle);
  if (pending) {
    return pending;
  }

  const fetchPromise = fetchLiveStatus(handle).finally(() => {
    pendingFetches.delete(handle);
  });
  pendingFetches.set(handle, fetchPromise);

  return fetchPromise;
}

async function fetchLiveStatus(handle: string): Promise<YoutubeLiveStatus> {
  const lastGood = cache.get(handle)?.status ?? OFFLINE_STATUS;
  try {
    const response = await fetch(LIVE_URL(handle), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "accept-language": "en-US,en;q=0.9" }
    });
    if (!response.ok) return lastGood;

    const html = await response.text();
    const match = html.match(CANONICAL_WATCH_PATTERN);

    const status = match ? { live: true, videoId: match[1] } : OFFLINE_STATUS;
    cache.set(handle, { status, at: Date.now() });
    return status;
  } catch {
    return lastGood;
  }
}
