import tls from "node:tls";
import type { ServerConfig } from "@/lib/config";
import type { Alert, Severity, WallboardPayload } from "@/lib/types";

function statusFromLatency(latency: number | null): Severity {
  if (latency === null) return "watch";
  if (latency > 2000) return "critical";
  if (latency > 900) return "watch";
  return "nominal";
}

export async function checkWebsite(config: ServerConfig) {
  const checkedAt = new Date().toISOString();

  if (!config.websiteHealthcheckEnabled) {
    return {
      label: "External website",
      status: "nominal" as const,
      latencyMs: null,
      checkedAt,
      detail: "Passive; no synthetic website request sent."
    };
  }

  if (!config.websiteHealthcheckUrl) {
    return {
      label: "External website",
      status: "nominal" as const,
      latencyMs: null,
      checkedAt,
      detail: null
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(config.websiteHealthcheckUrl, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    const latencyMs = Date.now() - startedAt;
    return {
      label: "External website",
      status: response.ok ? statusFromLatency(latencyMs) : ("critical" as const),
      latencyMs,
      checkedAt,
      detail: response.ok
        ? `Synthetic HEAD check completed in ${latencyMs}ms.`
        : `Synthetic HEAD check returned ${response.status}.`
    };
  } catch {
    return {
      label: "External website",
      status: "critical" as const,
      latencyMs: null,
      checkedAt,
      detail: "Synthetic HEAD check failed or timed out."
    };
  }
}

export async function checkSsl(config: ServerConfig) {
  const hostname = config.websiteHostname;

  if (!hostname) {
    return {
      label: "SSL certificate",
      status: "watch" as const,
      daysRemaining: null,
      expiresAt: null
    };
  }

  return new Promise<WallboardPayload["systems"]["ssl"]>((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        timeout: 5000
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert.valid_to) {
          resolve({
            label: "SSL certificate",
            status: "watch",
            daysRemaining: null,
            expiresAt: null
          });
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        const daysRemaining = Math.ceil(
          (expiresAt.getTime() - Date.now()) / 86400000
        );
        resolve({
          label: "SSL certificate",
          status:
            daysRemaining < 14
              ? "critical"
              : daysRemaining < 30
                ? "watch"
                : "nominal",
          daysRemaining,
          expiresAt: expiresAt.toISOString()
        });
      }
    );

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        label: "SSL certificate",
        status: "watch",
        daysRemaining: null,
        expiresAt: null
      });
    });
    socket.on("error", () => {
      resolve({
        label: "SSL certificate",
        status: "critical",
        daysRemaining: null,
        expiresAt: null
      });
    });
  });
}

function severityFromDownCount(downCount: number | null): Severity {
  if (downCount === null) return "nominal";
  if (downCount > 0) return "critical";
  return "nominal";
}

function downCountFromMonitorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const direct = record.downCount ?? record.down_count ?? record.down;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const parsed = Number(direct);
    if (Number.isFinite(parsed)) return parsed;
  }

  const monitors = record.monitors;
  if (!Array.isArray(monitors)) return null;

  return monitors.filter((monitor) => {
    if (!monitor || typeof monitor !== "object") return false;
    const status = String((monitor as Record<string, unknown>).status || "").toLowerCase();
    return ["down", "critical", "failed", "offline"].includes(status);
  }).length;
}

export async function checkDatabaseMonitors(config: ServerConfig) {
  const checkedAt = new Date().toISOString();

  if (!config.databaseMonitorsStatusUrl) {
    return {
      label: "All Monitors",
      status: "nominal" as const,
      downCount: null,
      checkedAt: null,
      detail: null
    };
  }

  try {
    const response = await fetch(config.databaseMonitorsStatusUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        label: "All Monitors",
        status: "watch" as const,
        downCount: null,
        checkedAt,
        detail: `Monitor endpoint returned ${response.status}.`
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const downCount =
      typeof body === "string"
        ? (/\b(down|critical|failed|offline)\b/i.test(body) ? 1 : 0)
        : downCountFromMonitorPayload(body);

    return {
      label: "All Monitors",
      status: severityFromDownCount(downCount),
      downCount,
      checkedAt,
      detail:
        downCount === null
          ? "Monitor endpoint did not expose a readable down count."
          : downCount > 0
            ? `${downCount} monitored system${downCount === 1 ? "" : "s"} down.`
            : "All monitored systems reporting up."
    };
  } catch {
    return {
      label: "All Monitors",
      status: "watch" as const,
      downCount: null,
      checkedAt,
      detail: "Monitor endpoint did not respond."
    };
  }
}

export function buildTrafficAlerts(
  payload: Pick<WallboardPayload, "analytics" | "systems">,
  config: ServerConfig
): Alert[] {
  const values = payload.analytics.minuteTrend.map((point) => point.value);
  const latest = values.at(-1) ?? payload.analytics.activeUsers;
  const previous = values.slice(0, -1);
  const baseline =
    latest !== null && previous.length > 0
      ? previous.reduce((total, value) => total + value, 0) / previous.length
      : latest;
  const alerts: Alert[] = [];

  if (payload.systems.databaseMonitors.status === "critical") {
    alerts.push({
      id: "database-monitors-down",
      title: "Database monitor down",
      detail:
        payload.systems.databaseMonitors.detail ||
        "One or more monitored database systems is reporting down.",
      severity: "critical",
      audible: true
    });
  } else if (
    payload.systems.databaseMonitors.status === "watch" &&
    config.databaseMonitorsStatusUrl
  ) {
    alerts.push({
      id: "database-monitors-watch",
      title: "Database monitor status unavailable",
      detail:
        payload.systems.databaseMonitors.detail ||
        "The All Monitors feed is not currently reporting a readable up/down count.",
      severity: "watch",
      audible: false
    });
  }

  if (payload.systems.website.status === "critical") {
    alerts.push({
      id: "website-health-critical",
      title: "Website health check failed",
      detail:
        payload.systems.website.detail ||
        "The external website health check is failing or timing out.",
      severity: "critical",
      audible: true
    });
  } else if (payload.systems.website.status === "watch" && config.websiteHealthcheckEnabled) {
    alerts.push({
      id: "website-health-watch",
      title: "Website health watch",
      detail:
        payload.systems.website.detail ||
        (payload.systems.website.latencyMs === null
          ? "The website health check did not return latency."
          : `Website health responded in ${payload.systems.website.latencyMs}ms, above the watch threshold.`),
      severity: "watch",
      audible: false
    });
  }

  if (payload.systems.ssl.status === "critical") {
    alerts.push({
      id: "ssl-critical",
      title: "SSL certificate critical",
      detail: "The configured website SSL certificate is expired or inside the critical renewal window.",
      severity: "critical",
      audible: true
    });
  } else if (payload.systems.ssl.status === "watch") {
    alerts.push({
      id: "ssl-watch",
      title: "SSL certificate watch",
      detail:
        payload.systems.ssl.daysRemaining === null
          ? "The SSL certificate check is not configured or did not return an expiry date."
          : `The SSL certificate has ${payload.systems.ssl.daysRemaining} days remaining.`,
      severity: "watch",
      audible: false
    });
  }

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
        id: "traffic-spike",
        title: "Website traffic spike",
        detail: `Realtime active users are ${percent}% above the rolling baseline.`,
        severity: "critical",
        audible: true
      });
    }
    if (percent <= -config.trafficDropThreshold) {
      alerts.push({
        id: "traffic-drop",
        title: "Website traffic drop",
        detail: `Realtime active users are ${Math.abs(percent)}% below the rolling baseline.`,
        severity: "critical",
        audible: true
      });
    }
  }

  return alerts;
}
