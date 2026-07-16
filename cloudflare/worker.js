// Cloudflare-native static wallboard + secret-bearing API.
// Provider credentials are Worker secrets and never enter public assets.

import { cachedValue } from "./cache.js";
import { getAnalytics } from "./analytics.js";
import { getConfig, hasAccess } from "./config.js";
import {
  checkDatabaseMonitors,
  checkWebsite,
  getLiveStream,
  getSocialPosts,
  getTrafficCameras,
  getWeather,
  sslState
} from "./providers.js";

function buildAlerts(payload, config) {
  const alerts = [];
  const database = payload.systems.databaseMonitors;
  if (database.status === "critical") {
    alerts.push({
      id: "database-monitors-down",
      title: "Database monitor down",
      detail: database.detail || "One or more monitored systems is down.",
      severity: "critical",
      audible: true
    });
  } else if (database.status === "watch" && config.databaseMonitorsStatusUrl) {
    alerts.push({
      id: "database-monitors-watch",
      title: "Database monitor status unavailable",
      detail: database.detail || "The monitor feed is not reporting a readable status.",
      severity: "watch",
      audible: false
    });
  }

  const website = payload.systems.website;
  if (website.status === "critical") {
    alerts.push({
      id: "website-health-critical",
      title: "Website health check failed",
      detail: website.detail || "The external website check is failing.",
      severity: "critical",
      audible: true
    });
  } else if (website.status === "watch" && config.websiteHealthcheckEnabled) {
    alerts.push({
      id: "website-health-watch",
      title: "Website health watch",
      detail: website.detail || "Website response time is elevated.",
      severity: "watch",
      audible: false
    });
  }

  // Workers validate TLS on fetch but cannot inspect the served certificate's
  // expiry date, so only raise SSL alerts when a real daysRemaining value is
  // supplied by a future provider/binding.
  const ssl = payload.systems.ssl;
  if (ssl.daysRemaining !== null && ssl.status !== "nominal") {
    alerts.push({
      id: ssl.status === "critical" ? "ssl-critical" : "ssl-watch",
      title: ssl.status === "critical" ? "SSL certificate critical" : "SSL certificate watch",
      detail: `The SSL certificate has ${ssl.daysRemaining} days remaining.`,
      severity: ssl.status,
      audible: ssl.status === "critical"
    });
  }

  const values = payload.analytics.minuteTrend || [];
  const latest = values.at(-1)?.value ?? payload.analytics.activeUsers;
  const previous = values.slice(0, -1).map((point) => point.value);
  const baseline = latest !== null && previous.length
    ? previous.reduce((sum, value) => sum + value, 0) / previous.length
    : latest;

  if (config.trafficNoUsersCritical && latest === 0) {
    alerts.push({
      id: "traffic-zero",
      title: "No realtime website users",
      detail: "GA is reporting zero active users inside the realtime window.",
      severity: "critical",
      audible: true
    });
  }
  if (latest !== null && baseline !== null && baseline > 0) {
    const percent = Math.round(((latest - baseline) / baseline) * 100);
    if (percent >= config.trafficSpikeThreshold) {
      alerts.push({
        id: "traffic-spike", title: "Website traffic spike",
        detail: `Realtime active users are ${percent}% above the rolling baseline.`,
        severity: "critical", audible: true
      });
    }
    if (percent <= -config.trafficDropThreshold) {
      alerts.push({
        id: "traffic-drop", title: "Website traffic drop",
        detail: `Realtime active users are ${Math.abs(percent)}% below the rolling baseline.`,
        severity: "critical", audible: true
      });
    }
  }
  return alerts;
}

async function buildPayload(config) {
  const [analyticsResult, website, databaseMonitors, socialPosts, liveStream, localWeather, cameras] =
    await Promise.all([
      getAnalytics(config),
      checkWebsite(config),
      checkDatabaseMonitors(config),
      getSocialPosts(config),
      getLiveStream(config),
      getWeather(),
      getTrafficCameras(config)
    ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: analyticsResult.mode,
    config: {
      databaseDashboardUrl: config.databaseDashboardUrl,
      databaseRefreshSeconds: config.databaseRefreshSeconds,
      databaseFrameViewportWidth: config.databaseFrameViewportWidth,
      databaseFrameViewportHeight: config.databaseFrameViewportHeight,
      databaseFrameCropBottom: config.databaseFrameCropBottom,
      databaseFrameDarkMode: config.databaseFrameDarkMode,
      audioEnabled: config.audioEnabled,
      audioCooldownSeconds: config.audioCooldownSeconds,
      healthcheckTarget: config.websiteHealthcheckUrl
    },
    analytics: analyticsResult.analytics,
    systems: {
      website,
      ssl: sslState(config),
      dataFreshness: {
        label: "Analytics freshness",
        status: analyticsResult.mode === "live" ? "nominal" : "watch",
        ageSeconds: analyticsResult.mode === "live" ? 0 : null
      },
      databaseMonitors
    },
    alerts: [],
    socialPosts,
    liveStream,
    localWeather,
    trafficCameras: { refreshSeconds: 90, cameras }
  };
  payload.alerts = buildAlerts(payload, config);
  return payload;
}

async function wallboardResponse(config) {
  // The browser polls every 30 seconds. This edge cache makes simultaneous
  // screens share one composition pass while the deeper provider caches keep
  // their own appropriate GA/NCDOT/NWS/YouTube/Apify refresh intervals.
  const result = await cachedValue({
    key: "wallboard-payload-v3",
    ttlMs: 25_000,
    fallback: null,
    load: () => buildPayload(config),
    logLabel: "wallboard payload"
  });
  if (!result.value) {
    return Response.json(
      { error: "Wallboard telemetry is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return Response.json(result.value, {
    headers: {
      "cache-control": "no-store",
      "x-wallboard-cache": result.stale ? "stale" : "fresh"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const config = getConfig(env);

    if (url.pathname === "/api/wallboard") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      if (!hasAccess(request, config)) {
        return Response.json(
          { error: "Wallboard access token is missing or invalid." },
          { status: 401, headers: { "cache-control": "no-store" } }
        );
      }
      const response = await wallboardResponse(config);
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "API route not found." },
        { status: 404, headers: { "cache-control": "no-store" } }
      );
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    return env.ASSETS.fetch(request);
  }
};
