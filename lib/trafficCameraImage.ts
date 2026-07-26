const SNAPSHOT_TTL_MS = 60_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type SnapshotRecord = {
  bytes: ArrayBuffer;
  contentType: string;
  fetchedAt: number;
  retryAfter: number;
};

const cache = new Map<string, SnapshotRecord>();
const pending = new Map<string, Promise<SnapshotRecord | null>>();
const failedUntil = new Map<string, number>();

export async function getTrafficCameraSnapshot(id: string): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
  stale: boolean;
} | null> {
  const now = Date.now();
  const record = cache.get(id);
  if (record && now - record.fetchedAt < SNAPSHOT_TTL_MS) {
    return { ...record, stale: false };
  }
  if (record?.retryAfter && record.retryAfter > now) {
    return { ...record, stale: true };
  }
  if (!record && (failedUntil.get(id) || 0) > now) return null;

  const existing = pending.get(id);
  if (existing) {
    const shared = await existing;
    return shared
      ? { ...shared, stale: Date.now() - shared.fetchedAt >= SNAPSHOT_TTL_MS }
      : null;
  }

  const task = (async () => {
    try {
      const upstream = new URL(`https://www.drivenc.gov/map/Cctv/${encodeURIComponent(id)}`);
      upstream.searchParams.set("wallboard", String(Math.floor(now / SNAPSHOT_TTL_MS)));
      const response = await fetch(upstream, {
        cache: "no-store",
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
      const next = { bytes, contentType, fetchedAt: Date.now(), retryAfter: 0 };
      cache.set(id, next);
      failedUntil.delete(id);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown snapshot error";
      console.error(`[wallboard] DriveNC camera ${id} snapshot failed:`, message);
      if (!record) {
        failedUntil.set(id, Date.now() + SNAPSHOT_TTL_MS);
        return null;
      }
      const stale = { ...record, retryAfter: Date.now() + SNAPSHOT_TTL_MS };
      cache.set(id, stale);
      return stale;
    }
  })().finally(() => pending.delete(id));

  pending.set(id, task);
  const loaded = await task;
  return loaded
    ? { ...loaded, stale: Date.now() - loaded.fetchedAt >= SNAPSHOT_TTL_MS }
    : null;
}
