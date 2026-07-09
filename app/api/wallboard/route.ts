import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSnapshot } from "@/lib/analytics";
import { getLatestFacebookPost, getLatestInstagramPost } from "@/lib/apify";
import { getServerConfig } from "@/lib/config";
import {
  buildTrafficAlerts,
  checkDatabaseMonitors,
  checkSsl,
  checkWebsite
} from "@/lib/systemStatus";
import { TRAFFIC_CAMERA_REFRESH_SECONDS, TRAFFIC_CAMERAS } from "@/lib/trafficCameras";
import type { SocialPost, WallboardPayload } from "@/lib/types";
import { getArdenWeather } from "@/lib/weather";
import { getYoutubeLiveStatus } from "@/lib/youtubeLive";

export const dynamic = "force-dynamic";

function hasAccess(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) return true;
  const headerToken = request.headers.get("x-wallboard-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === expectedToken || queryToken === expectedToken;
}

// request.nextUrl.origin reflects the app's own internal bind address
// (e.g. http://0.0.0.0:8080) when running behind a reverse proxy like
// Railway's edge, not the public hostname — confirmed 2026-07-09 against a
// live Railway deployment, where it broke every traffic-camera proxy URL.
// Standard reverse-proxy convention (Railway, most PaaS/CDN edges) is to set
// x-forwarded-host/x-forwarded-proto to the original public request; prefer
// those when present and fall back to nextUrl.origin for local dev/anything
// not behind a proxy.
function publicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return request.nextUrl.origin;
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  return `${forwardedProto}://${forwardedHost}`;
}

// Only echoes Access-Control-Allow-Origin back for an explicitly allowed
// origin (never "*", since the token can travel as a header) — lets a
// cross-origin static index.html deployment call this route from the
// browser. Same-origin callers (e.g. /wallboard) are unaffected either way.
function corsHeaders(
  request: NextRequest,
  config: ReturnType<typeof getServerConfig>
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !config.wallboardAllowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "x-wallboard-token, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };
}

export async function OPTIONS(request: NextRequest) {
  const config = getServerConfig();
  return new NextResponse(null, { status: 204, headers: corsHeaders(request, config) });
}

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  const cors = corsHeaders(request, config);

  if (!hasAccess(request, config.wallboardAccessToken)) {
    return NextResponse.json(
      { error: "Wallboard access token is missing or invalid." },
      { status: 401, headers: cors }
    );
  }

  const generatedAt = new Date().toISOString();
  const [analyticsResult, website, ssl, databaseMonitors, instagramPost, facebookPost, youtubeLive, localWeather] =
    await Promise.all([
      getAnalyticsSnapshot(config),
      checkWebsite(config),
      checkSsl(config),
      checkDatabaseMonitors(config),
      // Missing APIFY_TOKEN stays quiet (no network call, no setup alert) —
      // same convention as DATABASE_MONITORS_STATUS_URL below.
      config.apifyToken
        ? getLatestInstagramPost(config.apifyToken, config.instagramProfileUrl)
        : Promise.resolve(null),
      config.apifyToken
        ? getLatestFacebookPost(config.apifyToken, config.facebookPageUrl)
        : Promise.resolve(null),
      config.youtubeLiveChannelHandle
        ? getYoutubeLiveStatus(config.youtubeLiveChannelHandle)
        : Promise.resolve({ live: false, videoId: null }),
      getArdenWeather()
    ]);

  // Only spend a second request on the fallback channel when the primary
  // one isn't live — most of the time this isn't needed at all, and it's
  // sequenced after the Promise.all above since it depends on that result.
  const youtubeFallback =
    !youtubeLive.live && config.youtubeFallbackChannelHandle
      ? await getYoutubeLiveStatus(config.youtubeFallbackChannelHandle)
      : { live: false, videoId: null };

  const socialPosts: SocialPost[] = [instagramPost, facebookPost].filter(
    (post): post is SocialPost => Boolean(post)
  );

  const payload: WallboardPayload = {
    generatedAt,
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
      ssl,
      dataFreshness: {
        label: "Analytics freshness",
        status: analyticsResult.mode === "live" ? "nominal" : "watch",
        ageSeconds: analyticsResult.mode === "live" ? 0 : null
      },
      databaseMonitors
    },
    alerts: [],
    socialPosts,
    liveStream: {
      enabled: Boolean(config.youtubeLiveChannelHandle),
      live: youtubeLive.live,
      videoId: youtubeLive.videoId,
      channelUrl: `https://www.youtube.com/${config.youtubeLiveChannelHandle ?? ""}`,
      fallback:
        youtubeFallback.live && youtubeFallback.videoId
          ? {
              videoId: youtubeFallback.videoId,
              channelUrl: `https://www.youtube.com/${config.youtubeFallbackChannelHandle}`
            }
          : null
    },
    localWeather,
    trafficCameras: {
      refreshSeconds: TRAFFIC_CAMERA_REFRESH_SECONDS,
      // Absolute proxy URL (not the raw upstream vendor URL) built from this
      // request's own origin, so it resolves correctly whether the caller is
      // the same-origin /wallboard page or a static index.html hosted on a
      // different domain. Never expose the real DriveNC/IPCamLive URLs here.
      cameras: TRAFFIC_CAMERAS.map((camera) => ({
        id: camera.id,
        label: camera.label,
        url: `${publicOrigin(request)}/api/traffic-camera/${camera.id}`
      }))
    }
  };

  payload.alerts = buildTrafficAlerts(payload, config);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      ...cors
    }
  });
}
