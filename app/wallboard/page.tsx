"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Clock3,
  Database,
  Globe2,
  Maximize2,
  Minimize2,
  Radar,
  RadioTower,
  RefreshCcw,
  ShieldCheck,
  Signal,
  Volume2,
  Wifi,
  Youtube
} from "lucide-react";
import { geoEquirectangular, geoPath } from "d3-geo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Alert, Severity, SocialPost, WallboardPayload } from "@/lib/types";
import worldAtlas from "world-atlas/countries-110m.json";

const POLL_MS = 30000;
const MAP_VIEWBOX_HEIGHT = 56;
const mapTopology = worldAtlas as unknown as {
  objects: {
    countries: unknown;
    land: unknown;
  };
};
const worldLand = feature(
  worldAtlas as never,
  mapTopology.objects.land as never
) as never;
const worldCountries = feature(
  worldAtlas as never,
  mapTopology.objects.countries as never
) as never;
const worldProjection = geoEquirectangular()
  .scale(100 / (2 * Math.PI))
  .translate([50, 28]);
const worldPath = geoPath(worldProjection)(worldLand) || "";
const countryPath = geoPath(worldProjection)(worldCountries) || "";

function severityLabel(severity: Severity) {
  if (severity === "critical") return "critical";
  if (severity === "watch") return "watch";
  return "nominal";
}

function timeLabel(value: string | null) {
  if (!value) return "pending";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function numberLabel(value: number | null) {
  return value === null ? "" : value.toLocaleString();
}

function agoSeconds(value: string) {
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
}

function useWallboardData() {
  const [payload, setPayload] = useState<WallboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token =
        params.get("token") || window.localStorage.getItem("wallboard_token");
      if (token) window.localStorage.setItem("wallboard_token", token);
      const response = await fetch(
        `/api/wallboard${token ? `?token=${encodeURIComponent(token)}` : ""}`,
        {
          cache: "no-store",
          headers: token ? { "x-wallboard-token": token } : undefined
        }
      );
      if (!response.ok) {
        throw new Error(`Wallboard API returned ${response.status}`);
      }
      const nextPayload = (await response.json()) as WallboardPayload;
      setPayload(nextPayload);
      setLastUpdated(new Date().toISOString());
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  return { payload, error, lastUpdated, reload: load };
}

type LogSeverity = Severity | "info";

type SystemLogEntry = {
  id: string;
  text: string;
  severity: LogSeverity;
  at: string;
};

const LOG_MAX_ENTRIES = 8;
const AMBIENT_MIN_MS = 120_000;
const AMBIENT_MAX_MS = 300_000;
const HEARTBEAT_LINES = [
  "telemetry nominal",
  "dashboard refreshed",
  "signal check complete",
  "listening on all channels",
  "no anomalies detected",
  "baseline steady"
];

const SOCIAL_POST_EXCERPT_MAX = 140;

function socialPostExcerpt(post: SocialPost) {
  const label = post.platform === "instagram" ? "Instagram" : "Facebook";
  const text =
    post.text.length > SOCIAL_POST_EXCERPT_MAX
      ? `${post.text.slice(0, SOCIAL_POST_EXCERPT_MAX).trimEnd()}…`
      : post.text;
  return `${label}: ${text}`;
}

function useSystemLog(payload: WallboardPayload | null) {
  const [entries, setEntries] = useState<SystemLogEntry[]>([]);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const seenSocialPostIds = useRef<Set<string>>(new Set());
  const headlineIndex = useRef(0);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    if (!payload) return;
    const fresh = payload.alerts.filter((alert) => !seenAlertIds.current.has(alert.id));
    if (!fresh.length) return;
    fresh.forEach((alert) => seenAlertIds.current.add(alert.id));
    setEntries((current) =>
      [
        ...fresh.map((alert) => ({
          id: `alert-${alert.id}-${Date.now()}`,
          text: alert.title,
          severity: alert.severity as LogSeverity,
          at: new Date().toISOString()
        })),
        ...current
      ].slice(0, LOG_MAX_ENTRIES)
    );
  }, [payload]);

  // Surfaces a new Instagram/Facebook post immediately (like a real alert)
  // instead of waiting for the 2-5 minute ambient rotation below — this is
  // the "notify when a new posting goes live" behavior. Still ticker-only:
  // it never touches payload.alerts or the audible-alert system, same as
  // the rest of this ambient log.
  useEffect(() => {
    if (!payload) return;
    const fresh = payload.socialPosts.filter((post) => !seenSocialPostIds.current.has(post.id));
    if (!fresh.length) return;
    fresh.forEach((post) => seenSocialPostIds.current.add(post.id));
    setEntries((current) =>
      [
        ...fresh.map((post) => ({
          id: `social-${post.id}`,
          text: `New post — ${socialPostExcerpt(post)}`,
          severity: "watch" as LogSeverity,
          at: post.postedAt ?? new Date().toISOString()
        })),
        ...current
      ].slice(0, LOG_MAX_ENTRIES)
    );
  }, [payload]);

  useEffect(() => {
    let timeoutId: number;

    const scheduleNext = () =>
      window.setTimeout(tick, AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS));

    function tick() {
      const posts = payloadRef.current?.socialPosts ?? [];
      const usePost = posts.length > 0 && Math.random() < 0.5;
      const text = usePost
        ? socialPostExcerpt(posts[headlineIndex.current % posts.length])
        : HEARTBEAT_LINES[Math.floor(Math.random() * HEARTBEAT_LINES.length)];
      if (usePost) headlineIndex.current += 1;

      setEntries((current) =>
        [
          {
            id: `ambient-${Date.now()}`,
            text,
            severity: "info" as LogSeverity,
            at: new Date().toISOString()
          },
          ...current
        ].slice(0, LOG_MAX_ENTRIES)
      );

      timeoutId = scheduleNext();
    }

    timeoutId = scheduleNext();
    return () => window.clearTimeout(timeoutId);
    // Deliberately empty: this timer must survive across polls (payload
    // changes identity every 30s) rather than being torn down and
    // restarted before its 2-5 minute delay ever elapses. It reads the
    // latest payload via payloadRef instead of closing over the prop.
  }, []);

  return entries;
}

function Panel({
  title,
  icon,
  children,
  className = ""
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <span>{icon}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function StatusPill({ severity }: { severity: Severity }) {
  return <span className={`status-pill ${severity}`}>{severityLabel(severity)}</span>;
}

function TrendGraph({ payload }: { payload: WallboardPayload }) {
  const points = payload.analytics.minuteTrend;
  if (!points.length) {
    return <div className="blank-state">No realtime trend data</div>;
  }
  const max = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="trend">
      <div className="pulse-bars" role="img" aria-label="Realtime users trend">
        {points.map((point) => (
          <span
            key={point.label}
            title={`${point.label}: ${point.value} active users`}
            style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="trend-labels">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function playTone(context: AudioContext, urgent = false) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = urgent ? "sawtooth" : "sine";
  oscillator.frequency.setValueAtTime(urgent ? 760 : 520, context.currentTime);
  oscillator.frequency.setValueAtTime(urgent ? 480 : 680, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(urgent ? 0.18 : 0.1, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.48);
}

// Distinct from playTone on purpose: a square-wave siren sweep (vs. the
// normal alert's sawtooth blip) so a database-monitor outage is unmistakably
// different from every other critical alert, even from across the room.
const SERIOUS_ALERT_ID = "database-monitors-down";
const SERIOUS_ALERT_REPEAT_MS = 12_000;

function playAlarmPulse(context: AudioContext) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(900, context.currentTime);
  oscillator.frequency.linearRampToValueAtTime(550, context.currentTime + 0.3);
  oscillator.frequency.linearRampToValueAtTime(900, context.currentTime + 0.6);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.62);
}

function AudioAlert({ alerts, enabled, cooldownSeconds }: {
  alerts: Alert[];
  enabled: boolean;
  cooldownSeconds: number;
}) {
  const audioRef = useRef<AudioContext | null>(null);
  const lastPlayedRef = useRef(0);
  const [unlocked, setUnlocked] = useState(false);
  const seriousAlert = alerts.find((alert) => alert.id === SERIOUS_ALERT_ID);
  // Every 30s poll produces a brand-new `alerts` array (and thus a new
  // `seriousAlert` object reference) even when nothing actually changed, so
  // the repeat-siren effect below must key off this stable boolean rather
  // than the object itself — otherwise it tears down and restarts its
  // setInterval every poll, breaking the documented fixed 12s cadence.
  const seriousAlertActive = Boolean(seriousAlert);
  const audibleAlert = alerts.find(
    (alert) => alert.audible && alert.severity === "critical" && alert.id !== SERIOUS_ALERT_ID
  );

  const unlock = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new window.AudioContext();
    }
    void audioRef.current.resume().then(() => {
      if (audioRef.current && enabled) playTone(audioRef.current);
    });
    setUnlocked(true);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !audibleAlert || !unlocked || !audioRef.current) return;
    const now = Date.now();
    if (now - lastPlayedRef.current < cooldownSeconds * 1000) return;
    lastPlayedRef.current = now;
    playTone(audioRef.current, true);
  }, [audibleAlert, cooldownSeconds, enabled, unlocked]);

  // No cooldown gate here on purpose: a database monitor down is serious
  // enough to keep sounding on a short fixed interval until it clears,
  // rather than waiting out the normal 180s cooldown between chirps.
  useEffect(() => {
    if (!enabled || !seriousAlertActive || !unlocked || !audioRef.current) return;
    const context = audioRef.current;
    playAlarmPulse(context);
    const interval = window.setInterval(() => playAlarmPulse(context), SERIOUS_ALERT_REPEAT_MS);
    return () => window.clearInterval(interval);
  }, [enabled, seriousAlertActive, unlocked]);

  return (
    <button className="audio-button" onClick={unlock} type="button" title="Arm and test alert audio">
      <Volume2 size={18} />
      {unlocked ? "test audio" : "arm audio"}
    </button>
  );
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const update = () => {
      const fullscreenDocument = document as FullscreenDocument;
      setIsFullscreen(
        Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement)
      );
    };

    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);

    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const fullscreenDocument = document as FullscreenDocument;
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else {
        await fullscreenDocument.webkitExitFullscreen?.();
      }
      return;
    }

    const root = document.documentElement as FullscreenElement;
    if (root.requestFullscreen) {
      await root.requestFullscreen();
    } else {
      await root.webkitRequestFullscreen?.();
    }
  }, []);

  return (
    <button
      className="icon-button"
      onClick={() => void toggleFullscreen()}
      type="button"
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  );
}

function DatabaseFrame({ payload }: { payload: WallboardPayload }) {
  const [frameKey, setFrameKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString());
  const [frameScale, setFrameScale] = useState(1);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const url = payload.config.databaseDashboardUrl;
  const frameViewport = useMemo(
    () => ({
      width: payload.config.databaseFrameViewportWidth,
      height: payload.config.databaseFrameViewportHeight,
      cropBottom: payload.config.databaseFrameCropBottom
    }),
    [
      payload.config.databaseFrameViewportHeight,
      payload.config.databaseFrameViewportWidth,
      payload.config.databaseFrameCropBottom
    ]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setFrameKey((current) => current + 1);
      setLastRefresh(new Date().toISOString());
    }, payload.config.databaseRefreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [payload.config.databaseRefreshSeconds]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateScale = () => {
      const rect = shell.getBoundingClientRect();
      const shellStyle = window.getComputedStyle(shell);
      const shellPadding = parseFloat(shellStyle.paddingTop) + parseFloat(shellStyle.paddingBottom);
      const availableHeight = Math.max(0, rect.height - shellPadding);

      const nextScale = Math.min(
        1,
        rect.width / frameViewport.width,
        availableHeight / (frameViewport.height - frameViewport.cropBottom)
      );
      setFrameScale(Number(nextScale.toFixed(3)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [frameViewport.cropBottom, frameViewport.height, frameViewport.width]);

  return (
    <Panel title="Active Database System" icon={<Database size={18} />} className="database-panel">
      <div className="frame-toolbar">
        <span>
          <RefreshCcw size={14} />
          refresh {payload.config.databaseRefreshSeconds}s
        </span>
        <span>last {timeLabel(lastRefresh)}</span>
      </div>
      {url ? (
        <div className="frame-shell" ref={shellRef}>
          <div
            className="frame-stage"
            style={{
              width: frameViewport.width * frameScale,
              height: (frameViewport.height - frameViewport.cropBottom) * frameScale
            }}
          >
            <iframe
              key={frameKey}
              className={`dashboard-frame ${payload.config.databaseFrameDarkMode ? "darken" : ""}`}
              src={url}
              title="Active database dashboard"
              referrerPolicy="no-referrer"
              style={{
                width: frameViewport.width,
                height: frameViewport.height,
                transform: `scale(${frameScale})`
              }}
            />
          </div>
        </div>
      ) : (
        <div className="frame-empty">
          <Database size={38} />
          <strong>Dashboard URL not configured</strong>
          <span>Set DATABASE_DASHBOARD_URL to load the live system frame.</span>
        </div>
      )}
    </Panel>
  );
}

type ProjectedGeoPoint = WallboardPayload["analytics"]["geo"][number] & { x: number; y: number };

// Multiple distinct regions can share one coordinate (e.g. several cities not
// in COUNTRY_COORDINATES all fall back to the same country-level anchor), so
// coordinates alone aren't a unique key — city/region must be included or
// those entries collide in the `Map` below and all but one silently vanish.
function mapPointKey(point: { countryCode?: string; region: string; city?: string | null; longitude: number; latitude: number }) {
  return `${point.countryCode || point.region}-${point.city ?? point.region}-${point.longitude}-${point.latitude}`;
}

const MAP_POINT_FADE_MS = 700;

type DisplayedPoint = ProjectedGeoPoint & { key: string; leaving: boolean };

// `points` is a brand-new array reference on every GeoPanel render (it's
// recomputed inline from `payload`), and this hook's own setState calls
// cause GeoPanel to re-render — so the merge below must return the *same*
// `current` reference when nothing actually changed, or React never bails
// out of the render loop this creates.
function sameDisplayedPoints(a: DisplayedPoint[], b: DisplayedPoint[]) {
  if (a.length !== b.length) return false;
  return a.every((point, index) => {
    const other = b[index];
    return point.key === other.key && point.leaving === other.leaving && point.value === other.value;
  });
}

// GA realtime naturally drops a location the moment it's no longer active
// (see AGENTS.md), so `points` can lose an entry between polls with no
// warning. Without this, a dot just vanishes on the next render. This hook
// keeps a departed point mounted for MAP_POINT_FADE_MS with a `leaving` flag
// so the render layer can fade it out instead of popping it off the map.
function useFadingMapPoints(points: ProjectedGeoPoint[]) {
  const [displayed, setDisplayed] = useState<DisplayedPoint[]>([]);
  const removalTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const incoming = new Map(points.map((point) => [mapPointKey(point), point]));

    setDisplayed((current) => {
      const next: DisplayedPoint[] = [];
      const seen = new Set<string>();

      for (const entry of current) {
        const fresh = incoming.get(entry.key);
        if (fresh) {
          const timer = removalTimers.current.get(entry.key);
          if (timer) {
            window.clearTimeout(timer);
            removalTimers.current.delete(entry.key);
          }
          next.push({ ...fresh, key: entry.key, leaving: false });
        } else if (entry.leaving) {
          next.push(entry);
        } else {
          next.push({ ...entry, leaving: true });
          const timer = window.setTimeout(() => {
            setDisplayed((latest) => latest.filter((item) => item.key !== entry.key));
            removalTimers.current.delete(entry.key);
          }, MAP_POINT_FADE_MS);
          removalTimers.current.set(entry.key, timer);
        }
        seen.add(entry.key);
      }

      for (const [key, point] of incoming) {
        if (!seen.has(key)) {
          next.push({ ...point, key, leaving: false });
        }
      }

      return sameDisplayedPoints(current, next) ? current : next;
    });
  }, [points]);

  useEffect(() => {
    const timers = removalTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return displayed;
}

function GeoPanel({ payload }: { payload: WallboardPayload }) {
  const rawPoints = payload.analytics.geo
    .map((point) => {
      const projected = worldProjection([point.longitude, point.latitude]);
      if (!projected) return null;
      return {
        ...point,
        x: projected[0],
        y: projected[1]
      };
    })
    .filter((point): point is NonNullable<typeof point> => Boolean(point));

  const points = useFadingMapPoints(rawPoints);

  return (
    <Panel title="World Access Map" icon={<Globe2 size={18} />} className="geo-panel">
      <div className="world-map">
        <svg
          viewBox="0 0 100 56"
          preserveAspectRatio="none"
          role="img"
          aria-label="World access map"
        >
          <defs>
            <linearGradient id="landGlow" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(79, 235, 255, 0.28)" />
              <stop offset="100%" stopColor="rgba(109, 255, 179, 0.12)" />
            </linearGradient>
          </defs>
          <path className="map-graticule" d="M0 9.33 H100 M0 18.67 H100 M0 28 H100 M0 37.33 H100 M0 46.67 H100 M16.67 0 V56 M33.33 0 V56 M50 0 V56 M66.67 0 V56 M83.33 0 V56" />
          <path className="map-equator" d="M0 28 H100" />
          <path className="landmass" d={worldPath} />
          <path className="country-borders" d={countryPath} />
        </svg>
        <div className="map-point-layer">
          {points.map((point) => (
            <span
              key={point.key}
              className={`map-point${point.leaving ? " leaving" : ""}`}
              style={{
                left: `${point.x}%`,
                top: `${(point.y / MAP_VIEWBOX_HEIGHT) * 100}%`
              }}
              title={`${point.region}: ${point.value} active users in the last 30 minutes (${point.precision}-level location)`}
            >
              <span>{point.value}</span>
            </span>
          ))}
        </div>
        {!points.length ? (
          <div className="map-empty">No mapped realtime countries</div>
        ) : null}
      </div>
      <div className="geo-list">
        {payload.analytics.geo.slice(0, 4).map((point, index) => (
          <div key={`${point.countryCode || point.region}-${point.region}-${index}`}>
            <span>{point.region}</span>
            <strong>{point.value}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TrafficPanel({ payload }: { payload: WallboardPayload }) {
  return (
    <Panel title="Traffic Detail" icon={<Wifi size={18} />} className="traffic-panel">
      <div className="traffic-columns">
        <section>
          <h3>Top Pages</h3>
          <div className="rank-list compact">
            {payload.analytics.topPages.length ? payload.analytics.topPages.slice(0, 6).map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            )) : <div className="blank-row">No page data</div>}
          </div>
        </section>
        <section>
          <h3>Sources</h3>
          <div className="rank-list compact">
            {payload.analytics.topSources.length ? payload.analytics.topSources.slice(0, 6).map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            )) : <div className="blank-row">No source data</div>}
          </div>
        </section>
      </div>
    </Panel>
  );
}

// Live/offline detection happens server-side (lib/youtubeLive.ts) via a
// canonical-link scrape, no YouTube Data API key needed. Missing
// YOUTUBE_LIVE_CHANNEL_HANDLE stays quiet (panel doesn't render) rather than
// showing a setup warning, matching the DATABASE_MONITORS_STATUS_URL
// convention. Video is muted by default (`mute=1`) since this is ambient
// visual-only signage — matches the room's existing "no sound unless armed"
// posture for anything that isn't an explicit alert tone.
function LiveStreamPanel({ payload }: { payload: WallboardPayload }) {
  const { liveStream } = payload;

  if (!liveStream.enabled) return null;

  if (liveStream.live && liveStream.videoId) {
    return (
      <Panel title="Live Stream" icon={<Youtube size={18} />} className="livestream-panel">
        <div className="livestream-frame">
          <iframe
            key={liveStream.videoId}
            src={`https://www.youtube.com/embed/${liveStream.videoId}?autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0`}
            title="Biltmore Church live stream"
            allow="autoplay; encrypted-media; picture-in-picture"
          />
          <span className="livestream-badge">
            <Radar size={11} /> live
          </span>
        </div>
      </Panel>
    );
  }

  // Biltmore isn't live — fall back to a 24/7 news livestream (LiveNOW from
  // Fox by default) so the panel isn't dark most of the week. Badge is
  // visually distinct (amber, explicit source name) so it never reads as
  // "Biltmore is live" — this is filler content, not the real thing.
  if (liveStream.fallback) {
    return (
      <Panel title="Live Stream" icon={<Youtube size={18} />} className="livestream-panel">
        <div className="livestream-frame">
          <iframe
            key={liveStream.fallback.videoId}
            src={`https://www.youtube.com/embed/${liveStream.fallback.videoId}?autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0`}
            title="LiveNOW from Fox"
            allow="autoplay; encrypted-media; picture-in-picture"
          />
          <span className="livestream-badge fallback">
            <Radar size={11} /> live now — fox news
          </span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Live Stream" icon={<Youtube size={18} />} className="livestream-panel">
      <div className="livestream-idle">
        <Youtube size={30} />
        <strong>Not currently live</strong>
        <span>{liveStream.channelUrl.replace("https://www.", "")}</span>
      </div>
    </Panel>
  );
}

const TICKER_PX_PER_SECOND = 60;

function SystemLog({ entries }: { entries: SystemLogEntry[] }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(30);

  const items = entries.length
    ? entries
    : [
        {
          id: "system-log-empty",
          text: "system log initializing",
          severity: "info" as LogSeverity,
          at: new Date().toISOString()
        }
      ];
  // Rendered twice back-to-back so the -50% translateX loop is seamless.
  const trackItems = [...items, ...items];

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const updateDuration = () => {
      const width = track.scrollWidth / 2;
      setDuration(Math.max(12, width / TICKER_PX_PER_SECOND));
    };

    updateDuration();
    const observer = new ResizeObserver(updateDuration);
    observer.observe(track);
    return () => observer.disconnect();
  }, [items.length]);

  return (
    <div className="system-log" role="log" aria-live="off">
      <div
        className="ticker-track"
        ref={trackRef}
        style={{ animationDuration: `${duration}s` }}
      >
        {trackItems.map((entry, index) => (
          <span key={`${entry.id}-${index}`} className={`ticker-entry ${entry.severity}`}>
            <span className="ticker-time">{timeLabel(entry.at)}</span>
            <span className="ticker-text">{entry.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function AlertOverlay({ alerts }: { alerts: Alert[] }) {
  const alert = alerts.find((item) => item.severity === "critical") || alerts[0];
  if (!alert) return null;

  return (
    <aside className={`alert-overlay ${alert.severity}`} role="status" aria-live="polite">
      <div>
        <AlertTriangle size={22} />
        <strong>{alert.title}</strong>
      </div>
      <p>{alert.detail}</p>
      {alert.audible ? <span>audible alert active</span> : <span>visual notice</span>}
    </aside>
  );
}

function IncidentBanner({
  payload,
  error
}: {
  payload: WallboardPayload;
  error: string | null;
}) {
  const critical = payload.alerts.find((alert) => alert.severity === "critical");
  const watch = payload.alerts.find((alert) => alert.severity === "watch");
  const alert = critical || watch;
  const analyticsDegraded = payload.mode !== "live";

  return (
    <div className={`incident ${critical ? "critical" : watch || error || analyticsDegraded ? "watch" : "nominal"}`}>
      <div>
        {critical ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
        <span>
          {alert?.title ||
            (error
              ? "Telemetry fetch issue"
              : analyticsDegraded
                ? "Analytics telemetry degraded"
                : "All monitored signals nominal")}
        </span>
      </div>
      <p>
        {alert?.detail ||
          error ||
          (analyticsDegraded
            ? payload.analytics.message || "Realtime analytics are currently blank."
            : "No active alerts from website, SSL, traffic, or monitor status checks.")}
      </p>
    </div>
  );
}

export default function WallboardPage() {
  const { payload, error, lastUpdated, reload } = useWallboardData();
  const logEntries = useSystemLog(payload);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const peak = useMemo(() => {
    if (!payload) return 0;
    const values = payload.analytics.minuteTrend.map((point) => point.value);
    if (payload.analytics.activeUsers !== null) values.push(payload.analytics.activeUsers);
    if (!values.length) return null;
    return Math.max(...values);
  }, [payload]);

  if (!payload) {
    return (
      <main className="wallboard loading">
        <div className="loading-core">
          <Radar size={52} />
          <h1>Acquiring telemetry</h1>
          <p>{error || "Initializing realtime wallboard feed."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wallboard">
      <div className="noise" />
      <header className="command-header">
        <div>
          <p className="eyebrow">Realtime operations wall</p>
          <h1>Monitoring Room</h1>
        </div>
        <div className="header-cluster">
          <div className="clock">
            <Clock3 size={18} />
            {clock.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit"
            })}
          </div>
          <button className="icon-button" onClick={() => void reload()} type="button" title="Refresh telemetry">
            <RefreshCcw size={18} />
          </button>
          <FullscreenButton />
          <AudioAlert
            alerts={payload.alerts}
            enabled={payload.config.audioEnabled}
            cooldownSeconds={payload.config.audioCooldownSeconds}
          />
        </div>
      </header>

      <IncidentBanner payload={payload} error={error} />
      <AlertOverlay alerts={payload.alerts} />

      <section className="wall-grid">
        <Panel title="Website Pulse" icon={<Activity size={18} />} className="hero-panel">
          <div className="metric-row">
            <div className="big-number">
              <span>{numberLabel(payload.analytics.activeUsers)}</span>
              <label>active users in last 30m</label>
            </div>
            <div className="mini-metrics">
              <div title="GA eventCount from the realtime report. This counts user interactions GA receives during the realtime window.">
                <Signal size={18} />
                <strong>{numberLabel(payload.analytics.eventCount)}</strong>
                <span>GA events last 30m</span>
              </div>
              <div title="Highest active-user value seen in the displayed realtime minute trend.">
                <RadioTower size={18} />
                <strong>{numberLabel(peak)}</strong>
                <span>peak minute last 30m</span>
              </div>
              <div title="Active alerts generated from traffic thresholds, website health, SSL, and monitor status.">
                <Bell size={18} />
                <strong>{payload.alerts.length}</strong>
                <span>active alerts</span>
              </div>
              <div title={payload.systems.databaseMonitors.detail || undefined}>
                <ShieldCheck size={18} />
                <strong>{payload.systems.databaseMonitors.downCount ?? ""}</strong>
                <span>All Monitors down</span>
              </div>
            </div>
          </div>
          <TrendGraph payload={payload} />
        </Panel>

        <div className="database-column">
          <DatabaseFrame payload={payload} />
          <LiveStreamPanel payload={payload} />
        </div>

        <GeoPanel payload={payload} />

        <TrafficPanel payload={payload} />
      </section>

      <div className="ticker-bar">
        <SystemLog entries={logEntries} />
      </div>

      <footer className="wall-footer">
        <span>{payload.mode === "live" ? "live telemetry" : `${payload.mode} telemetry`}</span>
        {payload.analytics.message ? <span>{payload.analytics.message}</span> : null}
        <span>api age {lastUpdated ? `${agoSeconds(lastUpdated)}s` : "pending"}</span>
        <span>generated {timeLabel(payload.generatedAt)}</span>
      </footer>
    </main>
  );
}
