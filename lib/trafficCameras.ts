import type { TrafficCamera } from "@/lib/types";

// DriveNC's developer API uses numeric camera IDs. The public GUID-style
// routes cannot be derived from the API, so keep this curated corridor list
// configuration-driven and explicit. All eight selected cameras have a live
// HLS feed in Views[0].VideoUrl as of the 2026-07-16 verification pass.
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

export const TRAFFIC_CAMERA_REFRESH_SECONDS = 90;

const API_URL = "https://www.drivenc.gov/api/v2/get/cameras";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = TRAFFIC_CAMERA_REFRESH_SECONDS * 1000;

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

function fallbackCameras(): TrafficCamera[] {
  return CAMERA_CONFIG.map((camera) => ({
    ...camera,
    videoUrl: null,
    viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
    status: "Fallback"
  }));
}

function mapCameras(rows: DriveNcCamera[]): TrafficCamera[] {
  const byId = new Map(rows.map((camera) => [String(camera.Id), camera]));

  return CAMERA_CONFIG.map((camera) => {
    const view = byId.get(camera.id)?.Views?.[0];
    return {
      ...camera,
      videoUrl:
        typeof view?.VideoUrl === "string" && view.VideoUrl.trim()
          ? view.VideoUrl.trim()
          : null,
      viewerUrl: `https://www.drivenc.gov/map/Cctv/${camera.id}`,
      status: view?.Status || (view?.VideoUrl ? "Live" : "Fallback")
    };
  });
}

export async function getTrafficCameras(apiKey: string | null): Promise<TrafficCamera[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) return cache.cameras;
  if (!apiKey) return cache?.cameras ?? fallbackCameras();
  if (!cache && now - lastAttemptAt < CACHE_MS) return fallbackCameras();
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
    const cameras = mapCameras(rows);
    if (!cameras.some((camera) => camera.videoUrl)) {
      throw new Error("DriveNC API returned no live streams for configured cameras");
    }

    cache = { cameras, fetchedAt: Date.now() };
    return cameras;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DriveNC error";
    console.error("[wallboard] DriveNC camera metadata fetch failed:", message);
    return lastGood;
  }
}
