function numberFromEnv(env, name, fallback) {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(env, name, fallback) {
  if (env[name] === undefined || env[name] === null || env[name] === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(env[name]).toLowerCase());
}

export function getConfig(env) {
  return {
    wallboardAccessToken: env.WALLBOARD_ACCESS_TOKEN || null,
    gaPropertyId: env.GA_PROPERTY_ID || null,
    gaClientEmail: env.GA_CLIENT_EMAIL || null,
    gaPrivateKey: env.GA_PRIVATE_KEY || null,
    googleCredentialsJson: env.GOOGLE_APPLICATION_CREDENTIALS_JSON || null,
    databaseDashboardUrl: env.DATABASE_DASHBOARD_URL || null,
    databaseRefreshSeconds: numberFromEnv(env, "DATABASE_REFRESH_SECONDS", 60),
    databaseFrameViewportWidth: numberFromEnv(env, "DATABASE_FRAME_VIEWPORT_WIDTH", 1024),
    databaseFrameViewportHeight: numberFromEnv(env, "DATABASE_FRAME_VIEWPORT_HEIGHT", 640),
    databaseFrameCropBottom: numberFromEnv(env, "DATABASE_FRAME_CROP_BOTTOM", 96),
    databaseFrameDarkMode: boolFromEnv(env, "DATABASE_FRAME_DARK_MODE", true),
    databaseMonitorsStatusUrl: env.DATABASE_MONITORS_STATUS_URL || null,
    websiteHealthcheckEnabled: boolFromEnv(env, "WEBSITE_HEALTHCHECK_ENABLED", false),
    websiteHealthcheckUrl: env.WEBSITE_HEALTHCHECK_URL || null,
    websiteHostname: env.WEBSITE_HOSTNAME || null,
    trafficNoUsersCritical: boolFromEnv(env, "TRAFFIC_NO_USERS_CRITICAL", false),
    trafficSpikeThreshold: numberFromEnv(env, "TRAFFIC_SPIKE_THRESHOLD", 350),
    trafficDropThreshold: numberFromEnv(env, "TRAFFIC_DROP_THRESHOLD", 80),
    audioEnabled: boolFromEnv(env, "ALERT_AUDIO_ENABLED", true),
    audioCooldownSeconds: numberFromEnv(env, "ALERT_AUDIO_COOLDOWN_SECONDS", 180),
    youtubeLiveChannelHandle: env.YOUTUBE_LIVE_CHANNEL_HANDLE || null,
    youtubeFallbackChannelHandle:
      env.YOUTUBE_FALLBACK_CHANNEL_HANDLE === ""
        ? null
        : env.YOUTUBE_FALLBACK_CHANNEL_HANDLE || "@livenowfox",
    driveNcApiKey: env.DRIVENC_API_KEY || null,
    apifyToken: env.APIFY_TOKEN || null,
    instagramProfileUrl:
      env.APIFY_INSTAGRAM_PROFILE_URL || "https://www.instagram.com/biltmorechurch/",
    facebookPageUrl:
      env.APIFY_FACEBOOK_PAGE_URL || "https://www.facebook.com/mybiltmorechurch/"
  };
}

export function hasAccess(request, config) {
  if (!config.wallboardAccessToken) return true;
  const url = new URL(request.url);
  return (
    request.headers.get("x-wallboard-token") === config.wallboardAccessToken ||
    url.searchParams.get("token") === config.wallboardAccessToken
  );
}

