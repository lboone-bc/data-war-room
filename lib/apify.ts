export type SocialPost = {
  id: string;
  platform: "instagram" | "facebook";
  text: string;
  url: string;
  postedAt: string | null;
};

// Neither Instagram nor Facebook expose a free, no-auth way to read a public
// profile's latest post (confirmed by direct testing 2026-07-05: Facebook
// returns a flat error page to anonymous requests, Instagram returns an
// empty JS shell with no post data). Apify runs the actual scraping on its
// own infrastructure under its own ToS relationship with the platforms, so
// this integration is a paid API call (an Apify account + token), not a
// scraper we maintain or a login we automate ourselves.
const INSTAGRAM_ACTOR = "apify~instagram-post-scraper";
const FACEBOOK_ACTOR = "apify~facebook-posts-scraper";
const RUN_SYNC_URL = (actor: string, token: string) =>
  `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

// Each call actually runs a scraping actor (real compute time + Apify
// billing), unlike the other feeds in this app — so the cache here is much
// longer than it would otherwise need to be for freshness alone. 15 minutes
// is already generous for "did a church post something new"; don't shorten
// this without accounting for cost. Same discipline otherwise as
// lib/analytics.ts: in-flight de-dup, silent fallback to the last-good
// result on failure, never throw.
const CACHE_MS = 900_000;
const FAILURE_BACKOFF_MS = 3_600_000;
const RUN_TIMEOUT_MS = 45_000;

type CacheEntry = { post: SocialPost | null; at: number; retryAfter: number };

const instagramCache: CacheEntry = { post: null, at: 0, retryAfter: 0 };
const facebookCache: CacheEntry = { post: null, at: 0, retryAfter: 0 };
let pendingInstagram: Promise<SocialPost | null> | null = null;
let pendingFacebook: Promise<SocialPost | null> | null = null;

export async function getLatestInstagramPost(
  token: string,
  profileUrl: string
): Promise<SocialPost | null> {
  const now = Date.now();
  if (now - instagramCache.at < CACHE_MS || now < instagramCache.retryAfter) {
    return instagramCache.post;
  }
  if (pendingInstagram) return pendingInstagram;

  pendingInstagram = fetchInstagramPost(token, profileUrl).finally(() => {
    pendingInstagram = null;
  });
  return pendingInstagram;
}

export async function getLatestFacebookPost(
  token: string,
  pageUrl: string
): Promise<SocialPost | null> {
  const now = Date.now();
  if (now - facebookCache.at < CACHE_MS || now < facebookCache.retryAfter) {
    return facebookCache.post;
  }
  if (pendingFacebook) return pendingFacebook;

  pendingFacebook = fetchFacebookPost(token, pageUrl).finally(() => {
    pendingFacebook = null;
  });
  return pendingFacebook;
}

async function fetchInstagramPost(token: string, profileUrl: string): Promise<SocialPost | null> {
  try {
    const response = await fetch(RUN_SYNC_URL(INSTAGRAM_ACTOR, token), {
      method: "POST",
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: [profileUrl], resultsLimit: 1 })
    });
    if (!response.ok) throw new Error(`Instagram actor returned ${response.status}`);

    const items = (await response.json()) as Array<Record<string, unknown>>;
    const item = items[0];
    if (!item) throw new Error("Instagram actor returned no dataset items");

    const post: SocialPost = {
      id: `instagram-${String(item.id ?? item.shortCode ?? item.url)}`,
      platform: "instagram",
      text: typeof item.caption === "string" && item.caption.trim() ? item.caption.trim() : "New post",
      url: typeof item.url === "string" ? item.url : profileUrl,
      postedAt: typeof item.timestamp === "string" ? item.timestamp : null
    };
    instagramCache.post = post;
    instagramCache.at = Date.now();
    instagramCache.retryAfter = 0;
    return post;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Instagram actor error";
    console.error("[wallboard] Apify Instagram fetch failed:", message);
    // Failed sync actor runs can still consume compute. Back off for an hour
    // and keep the last-good post so a provider outage cannot trigger a new
    // billed run on every 30-second wallboard poll.
    instagramCache.retryAfter = Date.now() + FAILURE_BACKOFF_MS;
    return instagramCache.post;
  }
}

async function fetchFacebookPost(token: string, pageUrl: string): Promise<SocialPost | null> {
  try {
    const response = await fetch(RUN_SYNC_URL(FACEBOOK_ACTOR, token), {
      method: "POST",
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startUrls: [{ url: pageUrl }], resultsLimit: 1 })
    });
    if (!response.ok) throw new Error(`Facebook actor returned ${response.status}`);

    const items = (await response.json()) as Array<Record<string, unknown>>;
    const item = items[0];
    if (!item) throw new Error("Facebook actor returned no dataset items");

    const post: SocialPost = {
      id: `facebook-${String(item.postId ?? item.url)}`,
      platform: "facebook",
      text: typeof item.text === "string" && item.text.trim() ? item.text.trim() : "New post",
      url: typeof item.url === "string" ? item.url : pageUrl,
      postedAt: typeof item.time === "string" ? item.time : null
    };
    facebookCache.post = post;
    facebookCache.at = Date.now();
    facebookCache.retryAfter = 0;
    return post;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Facebook actor error";
    console.error("[wallboard] Apify Facebook fetch failed:", message);
    facebookCache.retryAfter = Date.now() + FAILURE_BACKOFF_MS;
    return facebookCache.post;
  }
}
