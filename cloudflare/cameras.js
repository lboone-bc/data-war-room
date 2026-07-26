// DriveNC camera inventory and short-lived signed HLS delivery.
//
// Views[0].VideoUrl is an unsigned NCDOT HLS manifest. Loading it directly
// produces an XEngine Basic-auth challenge, so an unsigned URL must never be
// serialized to a browser. This module performs DriveNC's public grant/token
// exchange, validates and probes the signed manifest server-side, and exposes
// only the signed URL or this app's same-origin snapshot proxy.

export const CAMERA_CONFIG = [
  { id: "4208", label: "I-26 MM37 — Long Shoals Rd", priority: true },
  { id: "4839", label: "I-26 MM35", priority: false },
  { id: "6120", label: "I-26 MM36", priority: false },
  { id: "5269", label: "I-26 MM39", priority: false },
  { id: "4210", label: "I-26 MM40", priority: false },
  { id: "4868", label: "I-26 MM41", priority: false },
  { id: "4876", label: "I-26 MM44 — US-25", priority: false },
  { id: "4221", label: "US-25 — Airport Rd", priority: false }
];

const CAMERA_META_CACHE_TTL_MS = 90_000;
const SIGNED_HLS_RENEW_MS = 5 * 60_000;
const SIGNED_HLS_MAX_STALE_MS = 15 * 60_000;
const UNAVAILABLE_HLS_RETRY_MS = 10_000;
const CAMERA_INVENTORY_TIMEOUT_MS = 15_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_SIGNING_FLOWS = 3;
// Four worst-case flows, including bounded 429 retries and manifest probes,
// stay below the Workers Free external-subrequest ceiling.
const MAX_SIGNING_FLOWS_PER_REQUEST = 4;
const RATE_LIMIT_RETRY_DELAYS_MS = [250, 750];
const DRIVENC_CAMERA_API_URL =
  "https://www.drivenc.gov/api/v2/get/cameras";
const DRIVENC_VIDEO_GRANT_URL =
  "https://www.drivenc.gov/Camera/GetVideoUrl";
const NCDOT_SECURE_TOKEN_URL =
  "https://vds.nc.insight-atms.com/api/SecureTokenUri/GetSecureTokenUriBySourceId";
const NCDOT_HLS_HOST_PATTERN =
  /^[a-z0-9-]+\.services\.ncdot\.gov$/i;
const NCDOT_HLS_PATH_PATTERN =
  /^\/chan-[a-z0-9_-]+\/index\.m3u8$/i;

let cameraMetaCache = { data: null, fetchedAt: 0 };
let cameraMetaRefreshInProgress = false;
let cameraApiRequestInProgress = false;
let signingSelectionCursor = 0;
let activeSigningFlows = 0;
const signingFlowWaiters = [];
const signedMediaCache = new Map();
const signedMediaRefreshReservations = new Set();

function snapshotPath(id) {
  return `/api/traffic-camera/${encodeURIComponent(id)}`;
}

function viewerUrl(id) {
  return `https://www.drivenc.gov/map/Cctv/${encodeURIComponent(id)}`;
}

export function isTrafficCameraId(id) {
  return CAMERA_CONFIG.some((camera) => camera.id === String(id));
}

export function trafficCameraRoster() {
  return CAMERA_CONFIG.map((camera) => ({
    ...camera,
    videoUrl: null,
    imageUrl: snapshotPath(camera.id),
    fallbackUrl: snapshotPath(camera.id),
    viewerUrl: viewerUrl(camera.id),
    status: "Snapshot",
    mediaMode: "snapshot",
    hlsAvailable: false,
    retryHls: false,
    refreshAfterMs: UNAVAILABLE_HLS_RETRY_MS
  }));
}

function extractMedia(camera, configured) {
  const view = camera.Views?.[0] || {};
  return {
    ...configured,
    unsignedVideoUrl:
      typeof view.VideoUrl === "string" && view.VideoUrl.trim()
        ? view.VideoUrl.trim()
        : null,
    viewerUrl: viewerUrl(configured.id),
    status: typeof view.Status === "string" ? view.Status : "Unknown"
  };
}

export function parseExpectedHlsUrl(value, { requireToken = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const params = [...url.searchParams.entries()];
  const validQuery = requireToken
    ? params.length === 1 &&
      params[0][0] === "token" &&
      /^[a-f0-9]{64}$/i.test(params[0][1])
    : params.length === 0;

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port !== "8887" ||
    !NCDOT_HLS_HOST_PATTERN.test(url.hostname) ||
    !NCDOT_HLS_PATH_PATTERN.test(url.pathname) ||
    url.hash ||
    !validQuery
  ) {
    return null;
  }

  return url;
}

function validOpaqueValue(value, maxLength = 512) {
  return (
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= maxLength) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateGrant(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.token === "string" &&
      /^[a-f0-9-]{36}$/i.test(value.token) &&
      validOpaqueValue(value.sourceId) &&
      validOpaqueValue(value.systemSourceId)
  );
}

export function buildSignedHlsUrl(unsignedValue, suffix) {
  const unsignedUrl = parseExpectedHlsUrl(unsignedValue);
  if (
    !unsignedUrl ||
    typeof suffix !== "string" ||
    suffix.length < 8 ||
    suffix.length > 8192 ||
    !suffix.startsWith("?") ||
    suffix.includes("#")
  ) {
    return null;
  }

  const signedUrl = new URL(unsignedUrl);
  signedUrl.search = suffix.slice(1);
  const verified = parseExpectedHlsUrl(signedUrl.href, {
    requireToken: true
  });
  if (
    !verified ||
    verified.origin !== unsignedUrl.origin ||
    verified.pathname !== unsignedUrl.pathname
  ) {
    return null;
  }
  return verified;
}

function parsePreviouslySignedHlsUrl(value, unsignedValue) {
  const unsignedUrl = parseExpectedHlsUrl(unsignedValue);
  const signedUrl = parseExpectedHlsUrl(value, { requireToken: true });
  if (
    !unsignedUrl ||
    !signedUrl ||
    signedUrl.origin !== unsignedUrl.origin ||
    signedUrl.pathname !== unsignedUrl.pathname
  ) {
    return null;
  }
  return signedUrl;
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Releasing a rejected upstream body is best-effort.
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.max(100, Math.min(1_000, retryAfter * 1_000));
  }
  return RATE_LIMIT_RETRY_DELAYS_MS[attempt];
}

async function fetchTextWith429Retry(createUrl, init, maxLength) {
  const attempts = RATE_LIMIT_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let retryDelay = null;

    try {
      const response = await fetch(createUrl(attempt), {
        ...init,
        redirect: "manual",
        signal: controller.signal
      });
      if (response.status === 429 && attempt < attempts - 1) {
        retryDelay = retryDelayMs(response, attempt);
        await cancelResponseBody(response);
      } else {
        if (!response.ok) {
          await cancelResponseBody(response);
          return { body: null, status: response.status };
        }
        const body = await response.text();
        return {
          body: body.length <= maxLength ? body : null,
          status: response.status
        };
      }
    } catch {
      return { body: null, status: null };
    } finally {
      clearTimeout(timeout);
    }

    await wait(retryDelay);
  }

  return { body: null, status: 429 };
}

async function withSigningFlowSlot(task) {
  if (activeSigningFlows >= MAX_CONCURRENT_SIGNING_FLOWS) {
    await new Promise((resolve) => signingFlowWaiters.push(resolve));
  } else {
    activeSigningFlows += 1;
  }

  try {
    return await task();
  } finally {
    const next = signingFlowWaiters.shift();
    if (next) {
      next();
    } else {
      activeSigningFlows -= 1;
    }
  }
}

async function requestSignedHlsUrl(media) {
  if (media.status !== "Enabled") return null;
  const unsignedUrl = parseExpectedHlsUrl(media.unsignedVideoUrl);
  if (!unsignedUrl) return null;

  const grantResult = await fetchTextWith429Retry(
    (attempt) => {
      const url = new URL(DRIVENC_VIDEO_GRANT_URL);
      url.searchParams.set("imageId", media.id);
      url.searchParams.set("_", String(Date.now() + attempt));
      return url.href;
    },
    { method: "GET", headers: { accept: "application/json" } },
    16_384
  );
  if (!grantResult.body) {
    console.error(
      `[wallboard] DriveNC camera ${media.id} HLS grant failed (${grantResult.status ?? "network"})`
    );
    return null;
  }

  let grant;
  try {
    grant = JSON.parse(grantResult.body);
  } catch {
    return null;
  }
  if (!validateGrant(grant)) {
    console.error(
      `[wallboard] DriveNC camera ${media.id} HLS grant was invalid`
    );
    return null;
  }

  const tokenResult = await fetchTextWith429Retry(
    () => NCDOT_SECURE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: grant.token,
        sourceId: grant.sourceId,
        systemSourceId: grant.systemSourceId
      })
    },
    16_384
  );
  if (!tokenResult.body) {
    console.error(
      `[wallboard] DriveNC camera ${media.id} HLS token exchange failed (${tokenResult.status ?? "network"})`
    );
    return null;
  }

  let suffix;
  try {
    suffix = JSON.parse(tokenResult.body);
  } catch {
    suffix = tokenResult.body.trim();
  }
  const signedUrl = buildSignedHlsUrl(unsignedUrl.href, suffix);
  if (!signedUrl) {
    console.error(
      `[wallboard] DriveNC camera ${media.id} signed HLS URL was invalid`
    );
  }
  return signedUrl;
}

async function probeHlsManifest(signedUrl, cameraId) {
  const parsedUrl = parseExpectedHlsUrl(signedUrl, { requireToken: true });
  if (!parsedUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept:
          "application/vnd.apple.mpegurl, application/x-mpegURL, */*;q=0.1"
      }
    });
    if (!response.ok) {
      const status = response.status;
      await cancelResponseBody(response);
      console.error(
        `[wallboard] DriveNC camera ${cameraId} signed manifest failed (${status})`
      );
      return false;
    }
    const manifest = await response.text();
    const valid = manifest.trimStart().startsWith("#EXTM3U");
    if (!valid) {
      console.error(
        `[wallboard] DriveNC camera ${cameraId} signed manifest was not HLS`
      );
    }
    return valid;
  } catch {
    console.error(
      `[wallboard] DriveNC camera ${cameraId} signed manifest request failed`
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackMedia(media) {
  return {
    id: media.id,
    label: media.label,
    priority: media.priority,
    videoUrl: null,
    imageUrl: snapshotPath(media.id),
    fallbackUrl: snapshotPath(media.id),
    viewerUrl: media.viewerUrl,
    status: media.status,
    mediaMode: "snapshot",
    hlsAvailable: false,
    retryHls:
      media.status === "Enabled" && Boolean(media.unsignedVideoUrl)
  };
}

async function verifySignedHls(media) {
  const signedUrl = await requestSignedHlsUrl(media);
  if (!signedUrl || !(await probeHlsManifest(signedUrl, media.id))) {
    return fallbackMedia(media);
  }
  return {
    id: media.id,
    label: media.label,
    priority: media.priority,
    videoUrl: signedUrl.href,
    imageUrl: snapshotPath(media.id),
    fallbackUrl: snapshotPath(media.id),
    viewerUrl: media.viewerUrl,
    status: media.status,
    mediaMode: "hls",
    hlsAvailable: true,
    retryHls: false
  };
}

function cacheMatchesMedia(entry, media) {
  return (
    entry &&
    entry.unsignedVideoUrl === media.unsignedVideoUrl &&
    entry.status === media.status
  );
}

function signedMediaIsWithinMaxAge(entry, now) {
  return (
    !entry.data.hlsAvailable ||
    (Number.isFinite(entry.signedAt) &&
      now - entry.signedAt < SIGNED_HLS_MAX_STALE_MS)
  );
}

function cachedMediaForResponse(entry, now) {
  let refreshAt =
    entry.renewalRetryAt ||
    entry.checkedAt +
      (entry.data.hlsAvailable
        ? SIGNED_HLS_RENEW_MS
        : UNAVAILABLE_HLS_RETRY_MS);
  if (entry.data.hlsAvailable) {
    refreshAt = Math.min(
      refreshAt,
      entry.signedAt + SIGNED_HLS_MAX_STALE_MS
    );
  }
  return {
    ...entry.data,
    refreshAfterMs: Math.max(1_000, refreshAt - now)
  };
}

function freshCachedEntry(media, now, { force = false } = {}) {
  const cached = signedMediaCache.get(media.id);
  if (
    !cacheMatchesMedia(cached, media) ||
    !signedMediaIsWithinMaxAge(cached, now)
  ) {
    return null;
  }

  const lastAttemptAt = cached.lastAttemptAt ?? cached.checkedAt;
  if (force) {
    return now - lastAttemptAt < UNAVAILABLE_HLS_RETRY_MS ? cached : null;
  }
  if (cached.renewalRetryAt) {
    return now < cached.renewalRetryAt ? cached : null;
  }
  const ttl = cached.data.hlsAvailable
    ? SIGNED_HLS_RENEW_MS
    : UNAVAILABLE_HLS_RETRY_MS;
  return now - cached.checkedAt < ttl ? cached : null;
}

function deferredMediaForResponse(media, now) {
  const cached = signedMediaCache.get(media.id);
  const data =
    cacheMatchesMedia(cached, media) &&
    signedMediaIsWithinMaxAge(cached, now)
      ? cached.data
      : fallbackMedia(media);
  return {
    ...data,
    refreshAfterMs: UNAVAILABLE_HLS_RETRY_MS
  };
}

async function refreshSignedMedia(media) {
  const previous = signedMediaCache.get(media.id);
  const samePreviousSource = cacheMatchesMedia(previous, media);
  const verified = await verifySignedHls(media);

  if (
    !verified.hlsAvailable &&
    samePreviousSource &&
    previous.data.hlsAvailable &&
    signedMediaIsWithinMaxAge(previous, Date.now())
  ) {
    const previousSignedUrl = parsePreviouslySignedHlsUrl(
      previous.data.videoUrl,
      media.unsignedVideoUrl
    );
    if (
      previousSignedUrl &&
      (await probeHlsManifest(previousSignedUrl, media.id))
    ) {
      const retained = {
        ...previous,
        lastAttemptAt: Date.now(),
        renewalRetryAt: Date.now() + UNAVAILABLE_HLS_RETRY_MS
      };
      signedMediaCache.set(media.id, retained);
      return retained;
    }
  }

  const checkedAt = Date.now();
  const entry = {
    data: verified,
    unsignedVideoUrl: media.unsignedVideoUrl,
    status: media.status,
    checkedAt,
    signedAt: verified.hlsAvailable ? checkedAt : 0,
    lastAttemptAt: checkedAt,
    renewalRetryAt: null
  };
  signedMediaCache.set(media.id, entry);
  return entry;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return results;
}

async function getCameraMetadata(config, now) {
  if (!config.driveNcApiKey) return [];
  if (
    cameraMetaCache.data &&
    now - cameraMetaCache.fetchedAt < CAMERA_META_CACHE_TTL_MS
  ) {
    return cameraMetaCache.data;
  }
  if (cameraMetaRefreshInProgress) {
    if (cameraMetaCache.data) return cameraMetaCache.data;
    throw new Error("camera-metadata-refresh-in-progress");
  }

  cameraMetaRefreshInProgress = true;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CAMERA_INVENTORY_TIMEOUT_MS
  );
  try {
    const url = new URL(DRIVENC_CAMERA_API_URL);
    url.searchParams.set("key", config.driveNcApiKey);
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal
    });
    if (!response.ok) {
      const status = response.status;
      await cancelResponseBody(response);
      throw new Error(`inventory returned ${status}`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("inventory payload invalid");
    const byId = new Map(rows.map((camera) => [String(camera.Id), camera]));
    const selected = CAMERA_CONFIG.map((configured) => {
      const row = byId.get(configured.id);
      if (!row || String(row.Id) !== configured.id) {
        throw new Error(`inventory omitted camera ${configured.id}`);
      }
      return extractMedia(row, configured);
    });
    cameraMetaCache = { data: selected, fetchedAt: now };
    return selected;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[wallboard] DriveNC camera inventory failed:", message);
    if (cameraMetaCache.data) return cameraMetaCache.data;
    throw new Error("camera-metadata-unavailable");
  } finally {
    clearTimeout(timeout);
    cameraMetaRefreshInProgress = false;
  }
}

async function resolveMediaWithinSigningBudget(metadata, now, forceCameraId) {
  const dueIndexes = new Set(
    metadata
      .map((media, index) => ({ media, index }))
      .filter(
        ({ media }) =>
          !freshCachedEntry(media, now, {
            force: media.id === forceCameraId
          }) &&
          !signedMediaRefreshReservations.has(media.id)
      )
      .map(({ index }) => index)
  );

  const selectedIndexes = [];
  let remainingBudget = MAX_SIGNING_FLOWS_PER_REQUEST;
  const forcedIndex = metadata.findIndex(
    (media, index) =>
      media.id === forceCameraId && dueIndexes.has(index)
  );
  if (forcedIndex >= 0) {
    selectedIndexes.push(forcedIndex);
    remainingBudget -= 1;
  }

  let lastRoundRobinIndex = null;
  for (
    let offset = 0;
    offset < metadata.length && remainingBudget > 0;
    offset += 1
  ) {
    const index = (signingSelectionCursor + offset) % metadata.length;
    if (!dueIndexes.has(index) || selectedIndexes.includes(index)) continue;
    selectedIndexes.push(index);
    remainingBudget -= 1;
    lastRoundRobinIndex = index;
  }
  if (lastRoundRobinIndex !== null) {
    signingSelectionCursor =
      (lastRoundRobinIndex + 1) % metadata.length;
  }

  const selectedIds = new Set(
    selectedIndexes.map((index) => metadata[index].id)
  );
  selectedIds.forEach((id) => signedMediaRefreshReservations.add(id));
  try {
    const refreshed = await mapWithConcurrency(
      selectedIndexes.map((index) => metadata[index]),
      MAX_CONCURRENT_SIGNING_FLOWS,
      (media) => withSigningFlowSlot(() => refreshSignedMedia(media))
    );
    const refreshedById = new Map(
      refreshed.map((entry, index) => [
        metadata[selectedIndexes[index]].id,
        entry
      ])
    );
    return metadata.map((media) => {
      const refreshedEntry = refreshedById.get(media.id);
      if (refreshedEntry) {
        return cachedMediaForResponse(refreshedEntry, Date.now());
      }
      const cached = freshCachedEntry(media, now, {
        force: media.id === forceCameraId
      });
      return cached
        ? cachedMediaForResponse(cached, now)
        : deferredMediaForResponse(media, now);
    });
  } finally {
    selectedIds.forEach((id) => signedMediaRefreshReservations.delete(id));
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

async function cameraMetadataResponse(config, forceCameraId) {
  try {
    const now = Date.now();
    const metadata = await getCameraMetadata(config, now);
    if (!metadata.length) return jsonResponse([]);
    return jsonResponse(
      await resolveMediaWithinSigningBudget(
        metadata,
        now,
        forceCameraId
      )
    );
  } catch {
    return jsonResponse([], 502, {
      "x-camera-proxy-error": "upstream-unavailable"
    });
  }
}

export async function handleTrafficCameraMetadataRequest(config, url) {
  if (cameraApiRequestInProgress) {
    return jsonResponse([], 503, {
      "retry-after": "1",
      "x-camera-proxy-error": "refresh-in-progress"
    });
  }

  cameraApiRequestInProgress = true;
  const requestedCameraId = url.searchParams.get("cameraId");
  const forceCameraId =
    url.searchParams.get("refresh") === "1" &&
    isTrafficCameraId(requestedCameraId)
      ? requestedCameraId
      : null;
  try {
    return await cameraMetadataResponse(config, forceCameraId);
  } finally {
    cameraApiRequestInProgress = false;
  }
}
