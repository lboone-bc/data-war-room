import { cachedValue } from "./cache.js";

const REALTIME_CACHE_MS = 5 * 60_000;
const RANKINGS_CACHE_MS = 15 * 60_000;

const COUNTRY_COORDINATES = {
  AR: { longitude: -63.6, latitude: -38.4 }, AU: { longitude: 133.8, latitude: -25.3 },
  BR: { longitude: -51.9, latitude: -14.2 }, CA: { longitude: -106.3, latitude: 56.1 },
  CN: { longitude: 104.2, latitude: 35.9 }, DE: { longitude: 10.5, latitude: 51.2 },
  ES: { longitude: -3.7, latitude: 40.4 }, FR: { longitude: 2.2, latitude: 46.2 },
  GB: { longitude: -3.4, latitude: 55.4 }, IN: { longitude: 78.9, latitude: 20.6 },
  IE: { longitude: -8.2, latitude: 53.4 }, JP: { longitude: 138.3, latitude: 36.2 },
  KR: { longitude: 127.8, latitude: 35.9 }, MX: { longitude: -102.6, latitude: 23.6 },
  NG: { longitude: 8.7, latitude: 9.1 }, NL: { longitude: 5.3, latitude: 52.1 },
  SE: { longitude: 18.6, latitude: 60.1 }, US: { longitude: -96.8, latitude: 37.6 },
  ZA: { longitude: 22.9, latitude: -30.6 }
};

const CITY_COORDINATES = {
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

const EMPTY_REALTIME = {
  activeUsers: null,
  eventCount: null,
  minuteTrend: [],
  geo: []
};

const EMPTY_RANKINGS = { topPages: [], topSources: [], fetchedAt: null };
let oauthToken = null;
let oauthExpiresAt = 0;
let pendingOauthToken = null;

function credentialPair(config) {
  if (config.googleCredentialsJson) {
    const parsed = JSON.parse(config.googleCredentialsJson);
    return { email: parsed.client_email, privateKey: parsed.private_key };
  }
  return { email: config.gaClientEmail, privateKey: config.gaPrivateKey };
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlText(value) {
  return base64Url(new TextEncoder().encode(value));
}

function pemBytes(pem) {
  const normalized = String(pem).replace(/\\n/g, "\n");
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getAccessToken(config) {
  if (oauthToken && Date.now() < oauthExpiresAt - 60_000) return oauthToken;
  if (pendingOauthToken) return pendingOauthToken;

  pendingOauthToken = createAccessToken(config).finally(() => {
    pendingOauthToken = null;
  });
  return pendingOauthToken;
}

async function createAccessToken(config) {

  const credentials = credentialPair(config);
  if (!credentials.email || !credentials.privateKey) {
    throw new Error("Google Analytics service-account credentials are missing");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlText(JSON.stringify({
    iss: credentials.email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(credentials.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error(`Google OAuth returned ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Google OAuth response had no access token");
  oauthToken = payload.access_token;
  oauthExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  return oauthToken;
}

async function gaReport(config, method, body) {
  const token = await getAccessToken(config);
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(config.gaPropertyId)}:${method}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GA ${method} returned ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response.json();
}

function metric(row, index = 0) {
  return Number(row?.metricValues?.[index]?.value || 0);
}

function dimension(row, index = 0) {
  return row?.dimensionValues?.[index]?.value || "Unknown";
}

function usableCity(value) {
  const city = String(value || "").trim();
  return !city || city === "(not set)" || city === "Unknown" ? null : city;
}

async function realtime(config, previous) {
  const [summary, geoReport] = await Promise.all([
    gaReport(config, "runRealtimeReport", {
      metrics: [{ name: "activeUsers" }, { name: "eventCount" }]
    }),
    gaReport(config, "runRealtimeReport", {
      dimensions: [{ name: "countryId" }, { name: "country" }, { name: "city" }],
      metrics: [{ name: "activeUsers" }],
      limit: 12
    })
  ]);

  const activeUsers = metric(summary.rows?.[0], 0);
  const eventCount = metric(summary.rows?.[0], 1);
  const minuteTrend = [
    ...(previous?.minuteTrend || []),
    { label: new Date().toISOString(), value: activeUsers }
  ].slice(-12);
  const geo = (geoReport.rows || []).map((row) => {
    const countryCode = dimension(row, 0);
    const country = dimension(row, 1);
    const city = usableCity(dimension(row, 2));
    const cityCoordinates = city
      ? CITY_COORDINATES[`${countryCode}:${city.toLowerCase()}`]
      : null;
    const coordinates = cityCoordinates || COUNTRY_COORDINATES[countryCode];
    if (!coordinates) return null;
    return {
      region: city ? `${city}, ${country}` : country,
      countryCode,
      city,
      value: metric(row),
      longitude: coordinates.longitude,
      latitude: coordinates.latitude,
      precision: cityCoordinates ? "city" : "country"
    };
  }).filter(Boolean);

  return { activeUsers, eventCount, minuteTrend, geo };
}

async function rankings(config) {
  const [pages, sources] = await Promise.all([
    gaReport(config, "runReport", {
      dateRanges: [{ startDate: "today", endDate: "today" }],
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5
    }),
    gaReport(config, "runReport", {
      dateRanges: [{ startDate: "today", endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5
    })
  ]);
  return {
    topPages: (pages.rows || []).map((row) => ({
      label: dimension(row), value: `${metric(row)} views`
    })),
    topSources: (sources.rows || []).map((row) => ({
      label: dimension(row), value: `${metric(row)} sessions`
    })),
    fetchedAt: new Date().toISOString()
  };
}

export async function getAnalytics(config) {
  if (!config.gaPropertyId) {
    return {
      mode: "setup",
      analytics: {
        status: "setup", message: "GA_PROPERTY_ID is not configured.",
        fetchedAt: null, cacheSeconds: RANKINGS_CACHE_MS / 1000,
        ...EMPTY_REALTIME, ...EMPTY_RANKINGS
      }
    };
  }

  const credentials = credentialPair(config);
  if (!credentials.email || !credentials.privateKey) {
    return {
      mode: "setup",
      analytics: {
        status: "setup", message: "Google Analytics credentials are missing.",
        fetchedAt: null, cacheSeconds: RANKINGS_CACHE_MS / 1000,
        ...EMPTY_REALTIME, ...EMPTY_RANKINGS
      }
    };
  }

  const propertyKey = encodeURIComponent(config.gaPropertyId);
  const [realtimeResult, rankingsResult] = await Promise.all([
    cachedValue({
      key: `ga-realtime-${propertyKey}-v1`, ttlMs: REALTIME_CACHE_MS,
      fallback: EMPTY_REALTIME, load: (previous) => realtime(config, previous),
      logLabel: "GA realtime fetch"
    }),
    cachedValue({
      key: `ga-rankings-${propertyKey}-v1`, ttlMs: RANKINGS_CACHE_MS,
      fallback: EMPTY_RANKINGS, load: () => rankings(config),
      logLabel: "GA rankings fetch"
    })
  ]);
  const degraded = realtimeResult.stale || rankingsResult.stale;
  return {
    mode: degraded ? "degraded" : "live",
    analytics: {
      status: degraded ? "degraded" : "live",
      message: degraded
        ? "Google Analytics feed unavailable; showing last-good data when available."
        : null,
      fetchedAt: rankingsResult.value.fetchedAt,
      cacheSeconds: RANKINGS_CACHE_MS / 1000,
      ...realtimeResult.value,
      topPages: rankingsResult.value.topPages,
      topSources: rankingsResult.value.topSources
    }
  };
}
