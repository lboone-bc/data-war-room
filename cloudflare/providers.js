import { cachedValue } from "./cache.js";

const CAMERA_CONFIG = [
  { id: "4208", label: "I-26 MM37 — Long Shoals Rd", priority: true },
  { id: "4839", label: "I-26 MM35", priority: false },
  { id: "6120", label: "I-26 MM36", priority: false },
  { id: "5269", label: "I-26 MM39", priority: false },
  { id: "4210", label: "I-26 MM40", priority: false },
  { id: "4868", label: "I-26 MM41", priority: false },
  { id: "4876", label: "I-26 MM44 — US-25", priority: false },
  { id: "4221", label: "US-25 — Airport Rd", priority: false }
];

const EMPTY_WEATHER = {
  status: "degraded",
  message: "Weather feed unavailable.",
  location: "Arden, NC",
  updatedAt: null,
  current: {
    temperatureF: null, condition: null, humidity: null, windMph: null,
    windDirection: null, observedAt: null, station: null
  },
  forecast: []
};

function fallbackCameras() {
  return CAMERA_CONFIG.map((camera) => ({
    ...camera,
    videoUrl: null,
    viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
    status: "Fallback"
  }));
}

export async function getTrafficCameras(config) {
  if (!config.driveNcApiKey) return fallbackCameras();
  const result = await cachedValue({
    key: "drivenc-cameras-v2",
    ttlMs: 90_000,
    fallback: fallbackCameras(),
    logLabel: "DriveNC camera metadata",
    load: async () => {
      const url = new URL("https://www.drivenc.gov/api/v2/get/cameras");
      url.searchParams.set("key", config.driveNcApiKey);
      url.searchParams.set("format", "json");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`DriveNC API returned ${response.status}`);
      const cameras = await response.json();
      const byId = new Map(cameras.map((camera) => [String(camera.Id), camera]));
      const selected = CAMERA_CONFIG.map((camera) => {
        const view = byId.get(camera.id)?.Views?.[0];
        return {
          ...camera,
          videoUrl:
            typeof view?.VideoUrl === "string" && view.VideoUrl.trim()
              ? view.VideoUrl.trim()
              : null,
          viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
          status: view?.Status || (view?.VideoUrl ? "Live" : "Fallback")
        };
      });
      if (!selected.some((camera) => camera.videoUrl)) {
        throw new Error("DriveNC API returned no live streams for configured cameras");
      }
      return selected;
    }
  });
  return result.value;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function propertyUrl(record, key) {
  return stringValue(record?.properties?.[key]);
}

async function nwsJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/geo+json, application/json",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Data War Room weather wallboard (Cloudflare Worker)"
    }
  });
  if (!response.ok) throw new Error(`NWS returned ${response.status}`);
  return response.json();
}

function parseForecast(payload) {
  const periods = Array.isArray(payload?.properties?.periods) ? payload.properties.periods : [];
  const cards = [];
  for (let index = 0; index < periods.length && cards.length < 3; index += 1) {
    const period = periods[index];
    if (period?.isDaytime !== true && cards.length > 0) continue;
    const night = period?.isDaytime === true && periods[index + 1]?.isDaytime === false
      ? periods[index + 1]
      : null;
    const temp = numberValue(period?.temperature);
    const nightTemp = numberValue(night?.temperature);
    cards.push({
      name: stringValue(period?.name) || "Forecast",
      startTime: stringValue(period?.startTime) || new Date().toISOString(),
      highF: period?.isDaytime === true ? temp : null,
      lowF: period?.isDaytime === true ? nightTemp : temp,
      summary: stringValue(period?.shortForecast) || "Forecast pending",
      nightSummary: stringValue(night?.shortForecast),
      wind: period?.windSpeed
        ? `${period.windDirection ? `${period.windDirection} ` : ""}${period.windSpeed}`
        : null
    });
  }
  return cards;
}

function stationId(payload) {
  for (const feature of payload?.features || []) {
    const id = stringValue(feature?.properties?.stationIdentifier);
    if (id) return id;
  }
  return null;
}

function direction(degrees) {
  if (degrees === null) return null;
  const values = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return values[Math.round(degrees / 45) % values.length];
}

function parseCurrent(payload, station) {
  const p = payload?.properties || {};
  const celsius = numberValue(p.temperature?.value);
  const humidity = numberValue(p.relativeHumidity?.value);
  const windKmh = numberValue(p.windSpeed?.value);
  const windDegrees = numberValue(p.windDirection?.value);
  return {
    temperatureF: celsius === null ? null : Math.round((celsius * 9) / 5 + 32),
    condition: stringValue(p.textDescription),
    humidity: humidity === null ? null : Math.round(humidity),
    windMph: windKmh === null ? null : Math.round(windKmh * 0.621371),
    windDirection: direction(windDegrees),
    observedAt: stringValue(p.timestamp),
    station
  };
}

export async function getWeather() {
  const result = await cachedValue({
    key: "arden-weather-v1",
    ttlMs: 10 * 60_000,
    fallback: EMPTY_WEATHER,
    logLabel: "NWS weather",
    load: async () => {
      const points = await nwsJson("https://api.weather.gov/points/35.4665,-82.5165");
      const forecastUrl = propertyUrl(points, "forecast");
      const stationsUrl = propertyUrl(points, "observationStations");
      if (!forecastUrl || !stationsUrl) throw new Error("NWS point metadata incomplete");
      const [forecastPayload, stationsPayload] = await Promise.all([
        nwsJson(forecastUrl), nwsJson(stationsUrl)
      ]);
      const station = stationId(stationsPayload);
      const observation = station
        ? await nwsJson(`https://api.weather.gov/stations/${station}/observations/latest`)
        : null;
      const forecast = parseForecast(forecastPayload);
      const current = parseCurrent(observation, station);
      const live = forecast.length > 0 && (current.temperatureF !== null || current.condition);
      return {
        status: live ? "live" : "degraded",
        message: live ? null : "Weather is partially available.",
        location: "Arden, NC",
        updatedAt: new Date().toISOString(),
        current,
        forecast
      };
    }
  });
  if (!result.stale) return result.value;
  return { ...result.value, status: "degraded", message: "Weather feed unavailable; showing last-good data." };
}

async function youtubeStatus(handle) {
  const result = await cachedValue({
    key: `youtube-live-${encodeURIComponent(handle)}-v1`,
    ttlMs: 45_000,
    fallback: { live: false, videoId: null },
    logLabel: `YouTube live status ${handle}`,
    load: async () => {
      const response = await fetch(`https://www.youtube.com/${handle}/live`, {
        headers: { "accept-language": "en-US,en;q=0.9" }
      });
      if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
      const html = await response.text();
      const match = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})">/);
      return match ? { live: true, videoId: match[1] } : { live: false, videoId: null };
    }
  });
  return result.value;
}

export async function getLiveStream(config) {
  if (!config.youtubeLiveChannelHandle) {
    return { enabled: false, live: false, videoId: null, channelUrl: "", fallback: null };
  }
  const primary = await youtubeStatus(config.youtubeLiveChannelHandle);
  const fallbackStatus = !primary.live && config.youtubeFallbackChannelHandle
    ? await youtubeStatus(config.youtubeFallbackChannelHandle)
    : { live: false, videoId: null };
  return {
    enabled: true,
    live: primary.live,
    videoId: primary.videoId,
    channelUrl: `https://www.youtube.com/${config.youtubeLiveChannelHandle}`,
    fallback: fallbackStatus.live && fallbackStatus.videoId
      ? {
          videoId: fallbackStatus.videoId,
          channelUrl: `https://www.youtube.com/${config.youtubeFallbackChannelHandle}`
        }
      : null
  };
}

const APIFY_CACHE_MS = 60 * 60_000;

async function apifyPost({ token, actor, body, platform, fallbackUrl }) {
  const result = await cachedValue({
    key: `apify-${platform}-v2`,
    ttlMs: APIFY_CACHE_MS,
    fallback: null,
    logLabel: `Apify ${platform}`,
    load: async () => {
      const url = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
      url.searchParams.set("token", token);
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`Apify actor returned ${response.status}`);
      const items = await response.json();
      const item = items[0];
      if (!item) throw new Error("Apify actor returned no dataset items");
      const instagram = platform === "instagram";
      return {
        id: `${platform}-${String(instagram ? item.id ?? item.shortCode ?? item.url : item.postId ?? item.url)}`,
        platform,
        text: String((instagram ? item.caption : item.text) || "New post").trim(),
        url: typeof item.url === "string" ? item.url : fallbackUrl,
        postedAt: typeof (instagram ? item.timestamp : item.time) === "string"
          ? (instagram ? item.timestamp : item.time)
          : null
      };
    }
  });
  return result.value;
}

export async function getSocialPosts(config) {
  if (!config.apifyToken) return [];
  const [instagram, facebook] = await Promise.all([
    apifyPost({
      token: config.apifyToken,
      actor: "apify~instagram-post-scraper",
      body: { username: [config.instagramProfileUrl], resultsLimit: 1 },
      platform: "instagram",
      fallbackUrl: config.instagramProfileUrl
    }),
    apifyPost({
      token: config.apifyToken,
      actor: "apify~facebook-posts-scraper",
      body: { startUrls: [{ url: config.facebookPageUrl }], resultsLimit: 1 },
      platform: "facebook",
      fallbackUrl: config.facebookPageUrl
    })
  ]);
  return [instagram, facebook].filter(Boolean);
}

function statusFromLatency(latency) {
  if (latency > 2000) return "critical";
  if (latency > 900) return "watch";
  return "nominal";
}

export async function checkWebsite(config) {
  const checkedAt = new Date().toISOString();
  if (!config.websiteHealthcheckEnabled || !config.websiteHealthcheckUrl) {
    return {
      label: "External website", status: "nominal", latencyMs: null, checkedAt,
      detail: config.websiteHealthcheckEnabled ? null : "Passive; no synthetic website request sent."
    };
  }
  const result = await cachedValue({
    key: "website-health-v1",
    ttlMs: 60_000,
    fallback: null,
    logLabel: "website health check",
    load: async () => {
      const started = Date.now();
      const response = await fetch(config.websiteHealthcheckUrl, { method: "HEAD" });
      const latencyMs = Date.now() - started;
      return {
        label: "External website",
        status: response.ok ? statusFromLatency(latencyMs) : "critical",
        latencyMs,
        checkedAt: new Date().toISOString(),
        detail: response.ok
          ? `Synthetic HEAD check completed in ${latencyMs}ms.`
          : `Synthetic HEAD check returned ${response.status}.`
      };
    }
  });
  return result.value || {
    label: "External website", status: "critical", latencyMs: null, checkedAt,
    detail: "Synthetic HEAD check failed."
  };
}

function downCount(payload) {
  if (!payload || typeof payload !== "object") return null;
  const direct = payload.downCount ?? payload.down_count ?? payload.down;
  if (direct !== undefined && Number.isFinite(Number(direct))) return Number(direct);
  if (!Array.isArray(payload.monitors)) return null;
  return payload.monitors.filter((monitor) =>
    ["down", "critical", "failed", "offline"].includes(String(monitor?.status || "").toLowerCase())
  ).length;
}

export async function checkDatabaseMonitors(config) {
  if (!config.databaseMonitorsStatusUrl) {
    return {
      label: "All Monitors", status: "nominal", downCount: null,
      checkedAt: null, detail: null
    };
  }
  const result = await cachedValue({
    key: "database-monitors-v1",
    ttlMs: 60_000,
    fallback: null,
    logLabel: "database monitor status",
    load: async () => {
      const response = await fetch(config.databaseMonitorsStatusUrl);
      if (!response.ok) throw new Error(`monitor endpoint returned ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      const count = typeof body === "string"
        ? (/\b(down|critical|failed|offline)\b/i.test(body) ? 1 : 0)
        : downCount(body);
      return {
        label: "All Monitors",
        status: count > 0 ? "critical" : "nominal",
        downCount: count,
        checkedAt: new Date().toISOString(),
        detail: count === null
          ? "Monitor endpoint did not expose a readable down count."
          : count > 0
            ? `${count} monitored system${count === 1 ? "" : "s"} down.`
            : "All monitored systems reporting up."
      };
    }
  });
  return result.value || {
    label: "All Monitors", status: "watch", downCount: null,
    checkedAt: new Date().toISOString(), detail: "Monitor endpoint did not respond."
  };
}

export function sslState(config) {
  // Workers fetch validates TLS, but does not expose the peer certificate's
  // expiry date. Avoid a misleading third-party certificate lookup; keep the
  // state neutral and let the existing monitor dashboard own renewal alerts.
  return {
    label: "SSL certificate",
    status: config.websiteHostname ? "nominal" : "watch",
    daysRemaining: null,
    expiresAt: null
  };
}
