import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSnapshot } from "@/lib/analytics";
import { getServerConfig } from "@/lib/config";
import {
  buildTrafficAlerts,
  checkDatabaseMonitors,
  checkSsl,
  checkWebsite
} from "@/lib/systemStatus";
import type { WallboardPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

function hasAccess(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) return true;
  const headerToken = request.headers.get("x-wallboard-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === expectedToken || queryToken === expectedToken;
}

export async function GET(request: NextRequest) {
  const config = getServerConfig();

  if (!hasAccess(request, config.wallboardAccessToken)) {
    return NextResponse.json(
      { error: "Wallboard access token is missing or invalid." },
      { status: 401 }
    );
  }

  const generatedAt = new Date().toISOString();
  const [analyticsResult, website, ssl, databaseMonitors] = await Promise.all([
    getAnalyticsSnapshot(config),
    checkWebsite(config),
    checkSsl(config),
    checkDatabaseMonitors(config)
  ]);

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
    alerts: []
  };

  payload.alerts = buildTrafficAlerts(payload, config);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
