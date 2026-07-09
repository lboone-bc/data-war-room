import type { TrafficCamera } from "@/lib/types";

export const TRAFFIC_CAMERA_REFRESH_SECONDS = 60;

export const TRAFFIC_CAMERAS: TrafficCamera[] = [
  {
    id: "4210",
    label: "DriveNC CCTV 4210",
    url: "https://www.drivenc.gov/map/Cctv/4210"
  },
  {
    id: "5269",
    label: "DriveNC CCTV 5269",
    url: "https://www.drivenc.gov/map/Cctv/5269"
  },
  {
    id: "4208",
    label: "DriveNC CCTV 4208",
    url: "https://www.drivenc.gov/map/Cctv/4208"
  },
  {
    id: "4839",
    label: "DriveNC CCTV 4839",
    url: "https://www.drivenc.gov/map/Cctv/4839"
  },
  {
    id: "4224",
    label: "DriveNC CCTV 4224",
    url: "https://www.drivenc.gov/map/Cctv/4224"
  },
  {
    id: "4221",
    label: "DriveNC CCTV 4221",
    url: "https://www.drivenc.gov/map/Cctv/4221"
  },
  {
    id: "ipcamlive-3bwa7esgv64g9mu5x",
    label: "Location Camera 1",
    url: "https://s59.ipcamlive.com/streams/3bwa7esgv64g9mu5x/snapshot.jpg"
  },
  {
    id: "ipcamlive-1cvoiombj6sxjywzv",
    label: "Location Camera 2",
    url: "https://s28.ipcamlive.com/streams/1cvoiombj6sxjywzv/snapshot.jpg"
  }
];

type CameraImage = {
  bytes: Uint8Array;
  contentType: string;
  fetchedAt: number;
};

const FETCH_TIMEOUT_MS = 8000;
const MIN_FORCE_REFRESH_MS = 55_000;
const cameraCache = new Map<string, CameraImage>();
const pendingFetches = new Map<string, Promise<CameraImage | null>>();

export function getTrafficCamera(id: string) {
  return TRAFFIC_CAMERAS.find((camera) => camera.id === id) ?? null;
}

export async function getTrafficCameraImage(
  id: string,
  options: { forceRefresh?: boolean } = {}
): Promise<CameraImage | null> {
  const camera = getTrafficCamera(id);
  if (!camera) return null;

  const cached = cameraCache.get(id);
  const now = Date.now();
  const cacheAge = cached ? now - cached.fetchedAt : Infinity;
  const cacheIsFresh = cacheAge < TRAFFIC_CAMERA_REFRESH_SECONDS * 1000;
  const forceRefreshAllowed = options.forceRefresh && cacheAge >= MIN_FORCE_REFRESH_MS;

  if (cached && cacheIsFresh && !forceRefreshAllowed) {
    return cached;
  }

  const pending = pendingFetches.get(id);
  if (pending) return pending;

  const fetchPromise = fetchTrafficCameraImage(camera).finally(() => {
    pendingFetches.delete(id);
  });
  pendingFetches.set(id, fetchPromise);

  return fetchPromise;
}

async function fetchTrafficCameraImage(camera: TrafficCamera): Promise<CameraImage | null> {
  const lastGood = cameraCache.get(camera.id) ?? null;

  try {
    const response = await fetch(camera.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!response.ok || !contentType.startsWith("image/")) return lastGood;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return lastGood;

    const image = {
      bytes,
      contentType,
      fetchedAt: Date.now()
    };
    cameraCache.set(camera.id, image);
    return image;
  } catch {
    return lastGood;
  }
}
