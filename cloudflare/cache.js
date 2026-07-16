// Small provider cache for the Cloudflare-native wallboard API.
//
// The module cache handles normal warm-isolate traffic and the Cache API
// preserves last-good values across isolate restarts in the same Cloudflare
// location. Cached records live longer than their freshness TTL so a provider
// outage can return stale data instead of turning the entire wallboard blank.

const memory = new Map();
const pending = new Map();
const STALE_RETENTION_SECONDS = 24 * 60 * 60;

function cacheRequest(key) {
  return new Request(`https://wallboard-cache.invalid/${encodeURIComponent(key)}`);
}

async function readRecord(key) {
  const local = memory.get(key);
  if (local) return local;

  try {
    const response = await caches.default.match(cacheRequest(key));
    if (!response) return null;
    const record = await response.json();
    memory.set(key, record);
    return record;
  } catch {
    return null;
  }
}

async function writeRecord(key, value, degraded = false) {
  const record = { value, at: Date.now(), degraded };
  memory.set(key, record);

  try {
    await caches.default.put(
      cacheRequest(key),
      Response.json(record, {
        headers: { "cache-control": `public, max-age=${STALE_RETENTION_SECONDS}` }
      })
    );
  } catch {
    // Wrangler's local runtime or a temporarily unavailable cache should not
    // prevent the provider result from reaching the wallboard.
  }
  return record;
}

/**
 * Load a value using TTL + in-flight de-duplication + stale-on-error.
 * The return metadata lets callers mark a feed degraded without exposing the
 * raw upstream error to the public payload.
 */
export async function cachedValue({ key, ttlMs, fallback, load, logLabel }) {
  const record = await readRecord(key);
  if (record && Date.now() - record.at < ttlMs) {
    return { value: record.value, stale: Boolean(record.degraded), error: null };
  }

  const existing = pending.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const value = await load(record?.value ?? fallback);
      await writeRecord(key, value);
      return { value, stale: false, error: null };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      console.error(`[wallboard] ${logLabel || key} failed:`, raw);
      const value = record?.value ?? fallback;
      // Cache the failed attempt for the provider's normal TTL. This prevents
      // a 30-second browser poll from retrying a quota-limited or billable
      // upstream service continuously during an outage.
      await writeRecord(key, value, true);
      return {
        value,
        stale: true,
        error: raw
      };
    }
  })().finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}
