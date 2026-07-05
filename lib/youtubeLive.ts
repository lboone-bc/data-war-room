export type YoutubeLiveStatus = {
  live: boolean;
  videoId: string | null;
};

const OFFLINE_STATUS: YoutubeLiveStatus = { live: false, videoId: null };

// No YouTube Data API key required or used. YouTube's /channel/<id>/live path
// canonicalizes to the specific https://www.youtube.com/watch?v=<id> URL only
// while the channel actually has an active broadcast; when it's offline the
// canonical link stays on the plain channel/live page. That canonical-link
// swap is a reliable, key-free live/offline signal, so we scrape just that
// one tag rather than parsing the full page or calling the quota-limited
// Data API for something as simple as "are they live right now".
const LIVE_URL = (channelId: string) => `https://www.youtube.com/channel/${channelId}/live`;
const CANONICAL_WATCH_PATTERN =
  /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})">/;

// Same discipline as lib/analytics.ts / lib/newsFeed.ts: a generous TTL
// cache, in-flight de-duplication so concurrent requests share one fetch,
// and a silent fallback to the last-good result on failure — never throw,
// never surface a raw scrape/network error to the UI. 45s is short enough
// that "went live" shows up promptly, but long enough to stay a light,
// occasional request rather than hammering youtube.com on every client poll.
const LIVE_CACHE_MS = 45_000;
const FETCH_TIMEOUT_MS = 6000;

let cachedStatus: YoutubeLiveStatus = OFFLINE_STATUS;
let cachedAt = 0;
let pendingFetch: Promise<YoutubeLiveStatus> | null = null;

export async function getYoutubeLiveStatus(channelId: string): Promise<YoutubeLiveStatus> {
  const now = Date.now();
  if (now - cachedAt < LIVE_CACHE_MS) {
    return cachedStatus;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = fetchLiveStatus(channelId).finally(() => {
    pendingFetch = null;
  });

  return pendingFetch;
}

async function fetchLiveStatus(channelId: string): Promise<YoutubeLiveStatus> {
  try {
    const response = await fetch(LIVE_URL(channelId), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "accept-language": "en-US,en;q=0.9" }
    });
    if (!response.ok) return cachedStatus;

    const html = await response.text();
    const match = html.match(CANONICAL_WATCH_PATTERN);

    cachedStatus = match ? { live: true, videoId: match[1] } : OFFLINE_STATUS;
    cachedAt = Date.now();
    return cachedStatus;
  } catch {
    return cachedStatus;
  }
}
