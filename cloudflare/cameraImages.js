import { isTrafficCameraId } from "./providers.js";

const SNAPSHOT_TTL_MS = 60_000;
const STALE_RETENTION_SECONDS = 24 * 60 * 60;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const memory = new Map();
const pending = new Map();

function cacheRequest(id) {
  return new Request(`https://wallboard-camera-cache.invalid/${encodeURIComponent(id)}`);
}

async function readRecord(id) {
  const local = memory.get(id);
  if (local) return local;

  try {
    const response = await caches.default.match(cacheRequest(id));
    if (!response) return null;
    const isImage = response.status === 200 &&
      (response.headers.get("content-type") || "").startsWith("image/");
    const record = {
      bytes: isImage ? await response.arrayBuffer() : null,
      contentType: response.headers.get("content-type") || "image/jpeg",
      fetchedAt: Number(response.headers.get("x-wallboard-camera-fetched-at")) || 0,
      retryAfter: Number(response.headers.get("x-wallboard-camera-retry-after")) || 0
    };
    memory.set(id, record);
    return record;
  } catch {
    return null;
  }
}

async function writeRecord(id, record) {
  memory.set(id, record);
  const headers = {
    "cache-control": `public, max-age=${STALE_RETENTION_SECONDS}`,
    "content-type": record.contentType || "image/jpeg",
    "x-wallboard-camera-fetched-at": String(record.fetchedAt || 0),
    "x-wallboard-camera-retry-after": String(record.retryAfter || 0)
  };

  try {
    await caches.default.put(
      cacheRequest(id),
      new Response(record.bytes ? record.bytes.slice(0) : null, {
        status: record.bytes ? 200 : 503,
        headers
      })
    );
  } catch {
    // The warm-isolate copy is still useful when the Cache API is unavailable.
  }
  return record;
}

async function loadSnapshot(id) {
  const now = Date.now();
  const record = await readRecord(id);
  if (record?.bytes && now - record.fetchedAt < SNAPSHOT_TTL_MS) return record;
  if (record?.retryAfter > now) return record;

  const existing = pending.get(id);
  if (existing) return existing;

  const task = (async () => {
    try {
      const upstream = new URL(`https://www.drivenc.gov/map/Cctv/${encodeURIComponent(id)}`);
      // DriveNC/CloudFront documents a 60-second snapshot cache. A time bucket
      // prevents an intermediate cache from pinning an older frame beyond it.
      upstream.searchParams.set("wallboard", String(Math.floor(now / SNAPSHOT_TTL_MS)));
      const response = await fetch(upstream, {
        headers: { accept: "image/jpeg,image/*;q=0.8" },
        signal: AbortSignal.timeout(10_000)
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) throw new Error(`snapshot returned ${response.status}`);
      if (!contentType.startsWith("image/")) {
        throw new Error("snapshot response was not an image");
      }
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`snapshot size ${bytes.byteLength} is invalid`);
      }
      return writeRecord(id, {
        bytes,
        contentType,
        fetchedAt: Date.now(),
        retryAfter: 0
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[wallboard] DriveNC camera ${id} snapshot failed:`, message);
      return writeRecord(id, {
        bytes: record?.bytes || null,
        contentType: record?.contentType || "image/jpeg",
        fetchedAt: record?.fetchedAt || 0,
        retryAfter: Date.now() + SNAPSHOT_TTL_MS
      });
    }
  })().finally(() => pending.delete(id));

  pending.set(id, task);
  return task;
}

export async function cameraSnapshotResponse(id) {
  if (!isTrafficCameraId(id)) {
    return new Response("Camera not found", {
      status: 404,
      headers: { "cache-control": "no-store" }
    });
  }

  const record = await loadSnapshot(String(id));
  if (!record?.bytes) {
    return new Response("Camera snapshot temporarily unavailable", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "60" }
    });
  }

  const stale = Date.now() - record.fetchedAt >= SNAPSHOT_TTL_MS;
  return new Response(record.bytes.slice(0), {
    headers: {
      "cache-control": "private, max-age=55, stale-if-error=86400",
      "content-type": record.contentType,
      "x-wallboard-camera-cache": stale ? "stale" : "fresh"
    }
  });
}
