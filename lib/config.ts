export type ServerConfig = {
  wallboardAccessToken: string | null;
  wallboardAllowedOrigins: string[];
  gaPropertyId: string | null;
  databaseDashboardUrl: string | null;
  databaseRefreshSeconds: number;
  databaseFrameViewportWidth: number;
  databaseFrameViewportHeight: number;
  databaseFrameCropBottom: number;
  databaseFrameDarkMode: boolean;
  databaseMonitorsStatusUrl: string | null;
  websiteHealthcheckEnabled: boolean;
  websiteHealthcheckUrl: string | null;
  websiteHostname: string | null;
  trafficNoUsersCritical: boolean;
  trafficSpikeThreshold: number;
  trafficDropThreshold: number;
  audioEnabled: boolean;
  audioCooldownSeconds: number;
  youtubeLiveChannelHandle: string | null;
  youtubeFallbackChannelHandle: string | null;
  driveNcApiKey: string | null;
  apifyToken: string | null;
  instagramProfileUrl: string;
  facebookPageUrl: string;
};

function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function getServerConfig(): ServerConfig {
  return {
    wallboardAccessToken: process.env.WALLBOARD_ACCESS_TOKEN || null,
    // Comma-separated origins allowed to fetch /api/wallboard cross-origin
    // (e.g. a static index.html hosted on a different domain). Empty means
    // same-origin only — no CORS headers are added, matching prior behavior.
    wallboardAllowedOrigins: (process.env.WALLBOARD_ALLOWED_ORIGIN || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    gaPropertyId: process.env.GA_PROPERTY_ID || null,
    databaseDashboardUrl: process.env.DATABASE_DASHBOARD_URL || null,
    databaseRefreshSeconds: numberFromEnv("DATABASE_REFRESH_SECONDS", 60),
    databaseFrameViewportWidth: numberFromEnv("DATABASE_FRAME_VIEWPORT_WIDTH", 1024),
    databaseFrameViewportHeight: numberFromEnv("DATABASE_FRAME_VIEWPORT_HEIGHT", 640),
    databaseFrameCropBottom: numberFromEnv("DATABASE_FRAME_CROP_BOTTOM", 96),
    databaseFrameDarkMode: boolFromEnv("DATABASE_FRAME_DARK_MODE", true),
    databaseMonitorsStatusUrl: process.env.DATABASE_MONITORS_STATUS_URL || null,
    websiteHealthcheckEnabled: boolFromEnv("WEBSITE_HEALTHCHECK_ENABLED", false),
    websiteHealthcheckUrl:
      process.env.WEBSITE_HEALTHCHECK_URL ||
      process.env.NEXT_PUBLIC_WEBSITE_URL ||
      null,
    websiteHostname: process.env.WEBSITE_HOSTNAME || null,
    trafficNoUsersCritical: boolFromEnv("TRAFFIC_NO_USERS_CRITICAL", false),
    trafficSpikeThreshold: numberFromEnv("TRAFFIC_SPIKE_THRESHOLD", 350),
    trafficDropThreshold: numberFromEnv("TRAFFIC_DROP_THRESHOLD", 80),
    audioEnabled: boolFromEnv("ALERT_AUDIO_ENABLED", true),
    audioCooldownSeconds: numberFromEnv("ALERT_AUDIO_COOLDOWN_SECONDS", 180),
    youtubeLiveChannelHandle: process.env.YOUTUBE_LIVE_CHANNEL_HANDLE || null,
    // Defaults to LiveNOW from Fox (24/7 news livestream) so the panel has a
    // sensible fallback out of the box when the primary channel isn't live;
    // set to an empty string to disable the fallback entirely.
    youtubeFallbackChannelHandle: process.env.YOUTUBE_FALLBACK_CHANNEL_HANDLE || "@livenowfox",
    driveNcApiKey: process.env.DRIVENC_API_KEY || null,
    apifyToken: process.env.APIFY_TOKEN || null,
    instagramProfileUrl: process.env.APIFY_INSTAGRAM_PROFILE_URL || "https://www.instagram.com/biltmorechurch/",
    facebookPageUrl: process.env.APIFY_FACEBOOK_PAGE_URL || "https://www.facebook.com/mybiltmorechurch/"
  };
}
