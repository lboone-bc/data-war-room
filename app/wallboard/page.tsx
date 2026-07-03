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
  Wifi
} from "lucide-react";
import { geoEquirectangular, geoPath } from "d3-geo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Alert, Severity, WallboardPayload } from "@/lib/types";
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

function useSystemLog(payload: WallboardPayload | null) {
  const [entries, setEntries] = useState<SystemLogEntry[]>([]);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const headlineIndex = useRef(0);

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

  useEffect(() => {
    let timeoutId: number;

    const scheduleNext = () =>
      window.setTimeout(tick, AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS));

    function tick() {
      const headlines = payload?.newsHeadlines ?? [];
      const useHeadline = headlines.length > 0 && Math.random() < 0.5;
      const text = useHeadline
        ? headlines[headlineIndex.current % headlines.length].text
        : HEARTBEAT_LINES[Math.floor(Math.random() * HEARTBEAT_LINES.length)];
      if (useHeadline) headlineIndex.current += 1;

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
  }, [payload]);

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

function AudioAlert({ alerts, enabled, cooldownSeconds }: {
  alerts: Alert[];
  enabled: boolean;
  cooldownSeconds: number;
}) {
  const audioRef = useRef<AudioContext | null>(null);
  const lastPlayedRef = useRef(0);
  const [unlocked, setUnlocked] = useState(false);
  const audibleAlert = alerts.find(
    (alert) => alert.audible && alert.severity === "critical"
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

function DatabaseFrame({
  payload,
  logEntries
}: {
  payload: WallboardPayload;
  logEntries: SystemLogEntry[];
}) {
  const [frameKey, setFrameKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString());
  const [frameScale, setFrameScale] = useState(1);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
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

    const FRAME_SHELL_GAP = 10;

    const updateScale = () => {
      const rect = shell.getBoundingClientRect();
      const summaryHeight = summaryRef.current?.getBoundingClientRect().height ?? 0;
      const logHeight = logRef.current?.getBoundingClientRect().height ?? 0;
      const reserved =
        summaryHeight + logHeight + (summaryHeight || logHeight ? FRAME_SHELL_GAP * 2 : 0);
      const availableHeight = Math.max(0, rect.height - reserved);

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
    if (summaryRef.current) observer.observe(summaryRef.current);
    if (logRef.current) observer.observe(logRef.current);
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
          <div className="database-frame-summary" ref={summaryRef}>
            <div>
              <span>All Monitors</span>
              <strong>
                {payload.systems.databaseMonitors.downCount === null
                  ? "nominal"
                  : `${payload.systems.databaseMonitors.downCount} down`}
              </strong>
            </div>
            <div>
              <span>Website Check</span>
              <strong>
                {payload.systems.website.latencyMs
                  ? `${payload.systems.website.latencyMs}ms`
                  : "passive"}
              </strong>
            </div>
            <div>
              <span>SSL</span>
              <strong>
                {payload.systems.ssl.daysRemaining
                  ? `${payload.systems.ssl.daysRemaining}d`
                  : "pending"}
              </strong>
            </div>
          </div>
          <div ref={logRef}>
            <SystemLog entries={logEntries} />
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

function GeoPanel({ payload }: { payload: WallboardPayload }) {
  const points = payload.analytics.geo
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
              key={`${point.countryCode || point.region}-${point.longitude}-${point.latitude}`}
              className="map-point"
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
        {payload.analytics.geo.slice(0, 4).map((point) => (
          <div key={`${point.countryCode || point.region}-${point.value}`}>
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

function SystemLog({ entries }: { entries: SystemLogEntry[] }) {
  return (
    <div className="system-log" role="log" aria-live="off">
      {entries.length ? (
        entries.map((entry, index) => (
          <div
            key={entry.id}
            className={`system-log-entry ${entry.severity}${index === 0 ? " is-new" : ""}`}
          >
            <span className="system-log-time">{timeLabel(entry.at)}</span>
            <span className="system-log-text">{entry.text}</span>
          </div>
        ))
      ) : (
        <div className="system-log-entry info">
          <span className="system-log-time">{timeLabel(new Date().toISOString())}</span>
          <span className="system-log-text">system log initializing</span>
        </div>
      )}
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

        <DatabaseFrame payload={payload} logEntries={logEntries} />

        <GeoPanel payload={payload} />

        <TrafficPanel payload={payload} />
      </section>

      <footer className="wall-footer">
        <span>{payload.mode === "live" ? "live telemetry" : `${payload.mode} telemetry`}</span>
        {payload.analytics.message ? <span>{payload.analytics.message}</span> : null}
        <span>api age {lastUpdated ? `${agoSeconds(lastUpdated)}s` : "pending"}</span>
        <span>generated {timeLabel(payload.generatedAt)}</span>
      </footer>
    </main>
  );
}
