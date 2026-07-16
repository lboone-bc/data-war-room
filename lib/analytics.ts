import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type { RankedMetric, WallboardPayload } from "@/lib/types";
import type { ServerConfig } from "@/lib/config";

type AnalyticsSnapshot = WallboardPayload["analytics"];
type AnalyticsResult = {
  analytics: AnalyticsSnapshot;
  mode: "live" | "setup" | "degraded";
  error?: string;
};

const REALTIME_CACHE_MS = 300_000;
const RANKINGS_CACHE_MS = 900_000;
const ANALYTICS_CACHE_SECONDS = RANKINGS_CACHE_MS / 1000;
// GA's Realtime API property-token quota resets on the clock hour rather than
// on a rolling window from the failed request, so the backoff targets the
// next hour boundary (plus a small buffer for clock skew) instead of a fixed
// duration. A fixed duration can retry too early (still inside the same
// exhausted hour bucket) or wait longer than necessary past the reset.
const GA_QUOTA_BACKOFF_BUFFER_MS = 90_000;
const GA_QUOTA_MESSAGE =
  "GA quota exhausted; last-good analytics retained until the quota resets.";
const GA_UNAVAILABLE_MESSAGE =
  "Google Analytics feed unavailable; showing last-good analytics when available.";

let cachedAnalyticsResult: AnalyticsResult | null = null;
let cachedAnalyticsAt = 0;
let quotaBackoffUntil = 0;
let pendingFetch: Promise<AnalyticsResult> | null = null;
let analyticsClient: BetaAnalyticsDataClient | null = null;
let activeHistory: AnalyticsSnapshot["minuteTrend"] = [];

type RankingsCache = {
  topPages: RankedMetric[];
  topSources: RankedMetric[];
  fetchedAt: string | null;
  cachedAt: number;
};

let rankingsCache: RankingsCache = {
  topPages: [],
  topSources: [],
  fetchedAt: null,
  cachedAt: 0
};
let pendingRankings: Promise<RankingsCache> | null = null;

function nextHourBoundaryMs(): number {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

const COUNTRY_COORDINATES: Record<string, { longitude: number; latitude: number }> = {
  AR: { longitude: -63.6, latitude: -38.4 },
  AU: { longitude: 133.8, latitude: -25.3 },
  BR: { longitude: -51.9, latitude: -14.2 },
  CA: { longitude: -106.3, latitude: 56.1 },
  CN: { longitude: 104.2, latitude: 35.9 },
  DE: { longitude: 10.5, latitude: 51.2 },
  ES: { longitude: -3.7, latitude: 40.4 },
  FR: { longitude: 2.2, latitude: 46.2 },
  GB: { longitude: -3.4, latitude: 55.4 },
  IN: { longitude: 78.9, latitude: 20.6 },
  IE: { longitude: -8.2, latitude: 53.4 },
  JP: { longitude: 138.3, latitude: 36.2 },
  KR: { longitude: 127.8, latitude: 35.9 },
  MX: { longitude: -102.6, latitude: 23.6 },
  NG: { longitude: 8.7, latitude: 9.1 },
  NL: { longitude: 5.3, latitude: 52.1 },
  SE: { longitude: 18.6, latitude: 60.1 },
  US: { longitude: -96.8, latitude: 37.6 },
  ZA: { longitude: 22.9, latitude: -30.6 }
};

const CITY_COORDINATES: Record<string, { longitude: number; latitude: number }> = {
  "US:arden": { longitude: -82.52, latitude: 35.47 },
  "US:asheville": { longitude: -82.55, latitude: 35.6 },
  "US:avery creek": { longitude: -82.58, latitude: 35.46 },
  "US:burlington": { longitude: -79.44, latitude: 36.1 },
  "US:charlotte": { longitude: -80.84, latitude: 35.23 },
  "US:fletcher": { longitude: -82.5, latitude: 35.43 },
  "US:hendersonville": { longitude: -82.46, latitude: 35.32 },
  "US:indianapolis": { longitude: -86.16, latitude: 39.77 },
  "US:raleigh": { longitude: -78.64, latitude: 35.78 },
  "US:knoxville": { longitude: -83.92, latitude: 35.96 },
  "US:greenville": { longitude: -82.39, latitude: 34.85 },
  "US:atlanta": { longitude: -84.39, latitude: 33.75 },
  "US:nashville": { longitude: -86.78, latitude: 36.16 },
  "US:new york": { longitude: -74.01, latitude: 40.71 },
  "US:washington": { longitude: -77.04, latitude: 38.9 },
  "US:chicago": { longitude: -87.63, latitude: 41.88 },
  "US:dallas": { longitude: -96.8, latitude: 32.78 },
  "US:houston": { longitude: -95.37, latitude: 29.76 },
  "US:denver": { longitude: -104.99, latitude: 39.74 },
  "US:los angeles": { longitude: -118.24, latitude: 34.05 },
  "US:san francisco": { longitude: -122.42, latitude: 37.77 },
  "US:seattle": { longitude: -122.33, latitude: 47.61 },
  "US:miami": { longitude: -80.19, latitude: 25.76 }
};

function normalizedCityKey(countryCode: string, city: string) {
  return `${countryCode}:${city.trim().toLowerCase()}`;
}

function usableCity(city: string) {
  const normalized = city.trim();
  if (!normalized || normalized === "(not set)" || normalized === "Unknown") return null;
  return normalized;
}

const EMPTY_ANALYTICS: AnalyticsSnapshot = {
  status: "setup",
  message: null,
  fetchedAt: null,
  cacheSeconds: ANALYTICS_CACHE_SECONDS,
  activeUsers: null,
  eventCount: null,
  minuteTrend: [],
  topPages: [],
  topSources: [],
  geo: []
};

function getCredentialConfig() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    return { credentials };
  }

  if (process.env.GA_CLIENT_EMAIL && process.env.GA_PRIVATE_KEY) {
    return {
      credentials: {
        client_email: process.env.GA_CLIENT_EMAIL,
        private_key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, "\n")
      }
    };
  }

  return {};
}

function hasCredentialSource() {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GA_CLIENT_EMAIL && process.env.GA_PRIVATE_KEY)
  );
}

function metricValue(row: unknown, index = 0) {
  const candidate = row as { metricValues?: Array<{ value?: string }> };
  return Number(candidate.metricValues?.[index]?.value ?? 0);
}

function dimensionValue(row: unknown, index = 0) {
  const candidate = row as { dimensionValues?: Array<{ value?: string }> };
  return candidate.dimensionValues?.[index]?.value || "Unknown";
}

function isQuotaError(message: string) {
  return /RESOURCE_EXHAUSTED|quota|property tokens/i.test(message);
}

function degradedAnalytics(message: string): AnalyticsResult {
  const lastGood = cachedAnalyticsResult?.analytics ?? EMPTY_ANALYTICS;
  return {
    analytics: {
      ...lastGood,
      status: "degraded",
      message
    },
    mode: "degraded",
    error: message
  };
}

function cacheResult(result: AnalyticsResult) {
  cachedAnalyticsResult = result;
  cachedAnalyticsAt = Date.now();
  return result;
}

async function runRealtimeReport(
  client: BetaAnalyticsDataClient,
  propertyId: string,
  request: Record<string, unknown>
) {
  const [response] = await client.runRealtimeReport({
    property: `properties/${propertyId}`,
    ...request
  });
  return response.rows ?? [];
}

async function runStandardReport(
  client: BetaAnalyticsDataClient,
  propertyId: string,
  request: Record<string, unknown>
) {
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    ...request
  });
  return response.rows ?? [];
}

function getAnalyticsClient() {
  analyticsClient ??= new BetaAnalyticsDataClient(getCredentialConfig());
  return analyticsClient;
}

async function getRankings(
  client: BetaAnalyticsDataClient,
  propertyId: string
): Promise<RankingsCache> {
  const now = Date.now();
  if (now - rankingsCache.cachedAt < RANKINGS_CACHE_MS) return rankingsCache;
  if (pendingRankings) return pendingRankings;

  pendingRankings = fetchRankings(client, propertyId).finally(() => {
    pendingRankings = null;
  });
  return pendingRankings;
}

async function fetchRankings(
  client: BetaAnalyticsDataClient,
  propertyId: string
): Promise<RankingsCache> {
  try {
    const [pageRows, sourceRows] = await Promise.all([
      runStandardReport(client, propertyId, {
        dateRanges: [{ startDate: "today", endDate: "today" }],
        dimensions: [{ name: "unifiedScreenName" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 5
      }),
      runStandardReport(client, propertyId, {
        dateRanges: [{ startDate: "today", endDate: "today" }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 5
      })
    ]);

    rankingsCache = {
      topPages: pageRows.map((row) => ({
        label: dimensionValue(row),
        value: `${metricValue(row)} views`
      })),
      topSources: sourceRows.map((row) => ({
        label: dimensionValue(row),
        value: `${metricValue(row)} sessions`
      })),
      fetchedAt: new Date().toISOString(),
      cachedAt: Date.now()
    };
    return rankingsCache;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GA rankings error";
    console.error("[wallboard] GA rankings fetch failed:", message);
    // Mark the failed attempt as cached so a temporary failure cannot turn
    // every 30-second wallboard poll into another GA request storm.
    rankingsCache = { ...rankingsCache, cachedAt: Date.now() };
    return rankingsCache;
  }
}

export async function getAnalyticsSnapshot(
  config: ServerConfig
): Promise<AnalyticsResult> {
  if (!config.gaPropertyId) {
    return {
      analytics: {
        ...EMPTY_ANALYTICS,
        message: "GA_PROPERTY_ID is not configured."
      },
      mode: "setup",
      error: "GA_PROPERTY_ID is not configured."
    };
  }

  if (!hasCredentialSource()) {
    return {
      analytics: {
        ...EMPTY_ANALYTICS,
        message: "Google Analytics credentials are missing."
      },
      mode: "setup",
      error: "GA_PROPERTY_ID is configured, but Google Analytics credentials are missing."
    };
  }

  const now = Date.now();
  if (now < quotaBackoffUntil) {
    return cacheResult(degradedAnalytics(GA_QUOTA_MESSAGE));
  }

  if (cachedAnalyticsResult && now - cachedAnalyticsAt < REALTIME_CACHE_MS) {
    return cachedAnalyticsResult;
  }

  // Multiple wallboard requests can land inside the same cache-miss window
  // (concurrent tabs, dev-mode double effects, overlapping polls). Without
  // this, each one would independently fire its own batch of GA calls;
  // sharing the one in-flight fetch caps it at a single batch per refresh.
  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = fetchAnalyticsFromGa(config).finally(() => {
    pendingFetch = null;
  });

  return pendingFetch;
}

async function fetchAnalyticsFromGa(config: ServerConfig): Promise<AnalyticsResult> {
  try {
    const client = getAnalyticsClient();
    const propertyId = config.gaPropertyId as string;

    // Two realtime reports every five minutes: one summary and one geo map.
    // The former 30-row minutesAgo report was only used for anomaly history;
    // maintaining that history from these cached summary samples removes a
    // full Realtime request from every refresh batch. Same-day rankings use
    // their own 15-minute standard-report cache below.
    const [summaryRows, geoRows, rankings] = await Promise.all([
        runRealtimeReport(client, propertyId, {
          metrics: [{ name: "activeUsers" }, { name: "eventCount" }],
          dimensions: []
        }),
        runRealtimeReport(client, propertyId, {
          dimensions: [{ name: "countryId" }, { name: "country" }, { name: "city" }],
          metrics: [{ name: "activeUsers" }],
          limit: 12
        }),
        getRankings(client, propertyId)
      ]);

    const activeUsers = metricValue(summaryRows[0], 0);
    const eventCount = metricValue(summaryRows[0], 1);
    activeHistory = [
      ...activeHistory,
      { label: new Date().toISOString(), value: activeUsers }
    ].slice(-12);

    const geo = geoRows.map((row) => {
      const countryCode = dimensionValue(row, 0);
      const country = dimensionValue(row, 1);
      const city = usableCity(dimensionValue(row, 2));
      const cityCoordinates = city
        ? CITY_COORDINATES[normalizedCityKey(countryCode, city)]
        : undefined;
      const coordinates = cityCoordinates ?? COUNTRY_COORDINATES[countryCode];
      if (!coordinates) return null;

      return {
        region: city ? `${city}, ${country}` : country,
        countryCode,
        city,
        value: metricValue(row),
        longitude: coordinates.longitude,
        latitude: coordinates.latitude,
        precision: cityCoordinates ? "city" as const : "country" as const
      };
    }).filter((point): point is NonNullable<typeof point> => Boolean(point));

    return cacheResult({
      mode: "live",
      analytics: {
        status: "live",
        message: null,
        fetchedAt: rankings.fetchedAt,
        cacheSeconds: ANALYTICS_CACHE_SECONDS,
        activeUsers,
        eventCount,
        minuteTrend: activeHistory,
        topPages: rankings.topPages,
        topSources: rankings.topSources,
        geo
      }
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown GA error";
    // Never sent to the client (the public payload only ever gets
    // safeMessage below) — this is a server-side-only log line so the real
    // cause (bad key, wrong property ID, missing Viewer permission, etc.) is
    // actually visible somewhere, e.g. in Railway's log viewer, instead of
    // being silently swallowed.
    console.error("[wallboard] GA analytics fetch failed:", rawMessage);
    const safeMessage = isQuotaError(rawMessage)
      ? GA_QUOTA_MESSAGE
      : GA_UNAVAILABLE_MESSAGE;
    if (isQuotaError(rawMessage)) {
      quotaBackoffUntil = nextHourBoundaryMs() + GA_QUOTA_BACKOFF_BUFFER_MS;
    }
    return cacheResult(degradedAnalytics(safeMessage));
  }
}
