import type { TrafficCamera } from "@/lib/types";

// DriveNC's developer API uses numeric camera IDs. The public GUID-style
// routes cannot be derived from the API, so keep this curated corridor list
// configuration-driven and explicit.
const CAMERA_CONFIG = [
  { id: "4208", label: "I-26 MM37 — Long Shoals Rd", priority: true },
  { id: "4839", label: "I-26 MM35", priority: false },
  { id: "6120", label: "I-26 MM36", priority: false },
  { id: "5269", label: "I-26 MM39", priority: false },
  { id: "4210", label: "I-26 MM40", priority: false },
  { id: "4868", label: "I-26 MM41", priority: false },
  { id: "4876", label: "I-26 MM44 — US-25", priority: false },
  { id: "4221", label: "US-25 — Airport Rd", priority: false }
] as const;

export const TRAFFIC_CAMERA_REFRESH_SECONDS = 60;

const API_URL = "https://www.drivenc.gov/api/v2/get/cameras";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 90_000;
const HLS_CHECK_CACHE_MS = 10 * 60_000;

type DriveNcCamera = {
  Id?: number;
  Views?: Array<{
    VideoUrl?: string | null;
    Status?: string | null;
  }>;
};

type CameraCache = {
  cameras: TrafficCamera[];
  fetchedAt: number;
};

let cache: CameraCache | null = null;
let pendingFetch: Promise<TrafficCamera[]> | null = null;
let lastAttemptAt = 0;
let lastAttemptFailed = false;
const hlsChecks = new Map<string, { safe: boolean; checkedAt: number }>();
const pendingHlsChecks = new Map<string, Promise<boolean>>();

export function isTrafficCameraId(id: string): boolean {
  return CAMERA_CONFIG.some((camera) => camera.id === id);
}

function fallbackCameras(): TrafficCamera[] {
  return CAMERA_CONFIG.map((camera) => ({
    ...camera,
    videoUrl: null,
    viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
    status: "Snapshot"
  }));
}

async function hasPublicHls(cameraId: string, videoUrl: string): Promise<boolean> {
  const now = Date.now();
  const checkKey = `${cameraId}:${videoUrl}`;
  const cached = hlsChecks.get(checkKey);
  if (cached && now - cached.checkedAt < HLS_CHECK_CACHE_MS) return cached.safe;
  const existing = pendingHlsChecks.get(checkKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetch(videoUrl, {
        cache: "no-store",
        headers: {
          accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain"
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`manifest returned ${response.status}`);
      const manifest = await response.text();
      if (!manifest.trimStart().startsWith("#EXTM3U")) {
        throw new Error("manifest response was not HLS");
      }
      hlsChecks.set(checkKey, { safe: true, checkedAt: Date.now() });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown HLS error";
      console.error(`[wallboard] DriveNC camera ${cameraId} HLS preflight failed:`, message);
      hlsChecks.set(checkKey, { safe: false, checkedAt: Date.now() });
      return false;
    }
  })().finally(() => pendingHlsChecks.delete(checkKey));

  pendingHlsChecks.set(checkKey, task);
  return task;
}

async function mapCameras(rows: DriveNcCamera[]): Promise<TrafficCamera[]> {
  const byId = new Map(rows.map((camera) => [String(camera.Id), camera]));

  return Promise.all(CAMERA_CONFIG.map(async (camera) => {
    const view = byId.get(camera.id)?.Views?.[0];
    const candidate =
      typeof view?.VideoUrl === "string" && view.VideoUrl.trim()
        ? view.VideoUrl.trim()
        : null;
    const videoUrl =
      candidate && await hasPublicHls(camera.id, candidate) ? candidate : null;
    return {
      ...camera,
      videoUrl,
      viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
      status: videoUrl ? (view?.Status || "Live") : "Snapshot"
    };
  }));
}

export async function getTrafficCameras(apiKey: string | null): Promise<TrafficCamera[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) return cache.cameras;
  if (!apiKey) return cache?.cameras ?? fallbackCameras();
  if (!cache && now - lastAttemptAt < CACHE_MS) return fallbackCameras();
  if (lastAttemptFailed && now - lastAttemptAt < CACHE_MS) {
    return (cache?.cameras ?? fallbackCameras()).map((camera) => ({
      ...camera,
      videoUrl: null,
      status: "Snapshot"
    }));
  }
  if (pendingFetch) return pendingFetch;

  lastAttemptAt = now;
  pendingFetch = fetchTrafficCameras(apiKey).finally(() => {
    pendingFetch = null;
  });
  return pendingFetch;
}

async function fetchTrafficCameras(apiKey: string): Promise<TrafficCamera[]> {
  const lastGood = cache?.cameras ?? fallbackCameras();

  try {
    const url = new URL(API_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`DriveNC API returned ${response.status}`);

    const rows = (await response.json()) as DriveNcCamera[];
    const cameras = await mapCameras(rows);

    cache = { cameras, fetchedAt: Date.now() };
    lastAttemptFailed = false;
    return cameras;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DriveNC error";
    console.error("[wallboard] DriveNC camera metadata fetch failed:", message);
    lastAttemptFailed = true;
    return lastGood.map((camera) => ({
      ...camera,
      videoUrl: null,
      status: "Snapshot"
    }));
  }
}
