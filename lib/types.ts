export type Severity = "nominal" | "watch" | "critical";

export type MinutePoint = {
  label: string;
  value: number;
};

export type RankedMetric = {
  label: string;
  value: string;
  change?: string;
};

export type GeoPoint = {
  region: string;
  countryCode?: string;
  city?: string | null;
  value: number;
  longitude: number;
  latitude: number;
  precision: "city" | "country";
};

export type Alert = {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  audible: boolean;
};

export type FeedState = "live" | "setup" | "degraded";

export type WallboardPayload = {
  generatedAt: string;
  mode: FeedState;
  config: {
    databaseDashboardUrl: string | null;
    databaseRefreshSeconds: number;
    databaseFrameViewportWidth: number;
    databaseFrameViewportHeight: number;
    databaseFrameCropBottom: number;
    databaseFrameDarkMode: boolean;
    audioEnabled: boolean;
    audioCooldownSeconds: number;
    healthcheckTarget: string | null;
  };
  analytics: {
    status: FeedState;
    message: string | null;
    activeUsers: number | null;
    eventCount: number | null;
    minuteTrend: MinutePoint[];
    topPages: RankedMetric[];
    topSources: RankedMetric[];
    geo: GeoPoint[];
  };
  systems: {
    website: {
      label: string;
      status: Severity;
      latencyMs: number | null;
      checkedAt: string;
      detail: string | null;
    };
    ssl: {
      label: string;
      status: Severity;
      daysRemaining: number | null;
      expiresAt: string | null;
    };
    dataFreshness: {
      label: string;
      status: Severity;
      ageSeconds: number | null;
    };
    databaseMonitors: {
      label: string;
      status: Severity;
      downCount: number | null;
      checkedAt: string | null;
      detail: string | null;
    };
  };
  alerts: Alert[];
};
