import assert from "node:assert/strict";
import {
  buildSignedHlsUrl,
  handleTrafficCameraMetadataRequest,
  parseExpectedHlsUrl,
  trafficCameraRoster
} from "../cloudflare/cameras.js";

const unsigned =
  "https://cfase02.services.ncdot.gov:8887/chan-5378_l/index.m3u8";
const token = "a".repeat(64);

assert(parseExpectedHlsUrl(unsigned));
assert.equal(parseExpectedHlsUrl(`${unsigned}?token=${token}`), null);
assert(parseExpectedHlsUrl(`${unsigned}?token=${token}`, {
  requireToken: true
}));

[
  "http://cfase02.services.ncdot.gov:8887/chan-5378_l/index.m3u8",
  "https://user:pass@cfase02.services.ncdot.gov:8887/chan-5378_l/index.m3u8",
  "https://example.com:8887/chan-5378_l/index.m3u8",
  "https://cfase02.services.ncdot.gov/chan-5378_l/index.m3u8",
  "https://cfase02.services.ncdot.gov:8887/not-a-channel/index.m3u8",
  `${unsigned}#fragment`,
  `${unsigned}?unexpected=1`
].forEach((value) => assert.equal(parseExpectedHlsUrl(value), null));

const signed = buildSignedHlsUrl(unsigned, `?token=${token}`);
assert(signed);
assert.equal(signed.origin, new URL(unsigned).origin);
assert.equal(signed.pathname, new URL(unsigned).pathname);
assert.equal(signed.searchParams.get("token"), token);

[
  "?token=short",
  `?token=${token}&extra=1`,
  `?token=${token}&token=${token}`,
  `?unexpected=${token}`,
  `https://example.com/?token=${token}`,
  `?token=${token}#fragment`
].forEach((suffix) =>
  assert.equal(buildSignedHlsUrl(unsigned, suffix), null)
);

const serializedRoster = JSON.stringify(trafficCameraRoster());
assert(!serializedRoster.includes("services.ncdot.gov"));
assert(!serializedRoster.includes("\"token\""));
assert(!serializedRoster.includes("VideoUrl"));

const originalFetch = globalThis.fetch;
let inventoryRequests = 0;
let signingRequests = 0;
const rows = trafficCameraRoster().map((camera, index) => ({
  Id: Number(camera.id),
  Views: [
    {
      VideoUrl:
        `https://cfase02.services.ncdot.gov:8887/chan-${5000 + index}_l/index.m3u8`,
      Status: "Enabled"
    }
  ]
}));

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? input
      : input.url
  );
  if (url.pathname === "/api/v2/get/cameras") {
    inventoryRequests += 1;
    return Response.json(rows);
  }
  if (url.pathname === "/Camera/GetVideoUrl") {
    signingRequests += 1;
    const id = Number(url.searchParams.get("imageId"));
    return Response.json({
      token: "11111111-1111-1111-1111-111111111111",
      sourceId: id,
      systemSourceId: 1
    });
  }
  if (url.pathname.endsWith("/GetSecureTokenUriBySourceId")) {
    signingRequests += 1;
    const body = JSON.parse(String(init.body));
    const signedToken = Number(body.sourceId).toString(16).padStart(64, "0");
    return Response.json(`?token=${signedToken}`);
  }
  if (url.hostname.endsWith(".services.ncdot.gov")) {
    signingRequests += 1;
    assert(parseExpectedHlsUrl(url.href, { requireToken: true }));
    return new Response("#EXTM3U\n#EXT-X-VERSION:3\n");
  }
  throw new Error(`unexpected mock request: ${url.origin}${url.pathname}`);
};

try {
  const firstResponse = await handleTrafficCameraMetadataRequest(
    { driveNcApiKey: "test-only" },
    new URL("https://wallboard.test/api/cameras")
  );
  assert.equal(firstResponse.status, 200);
  const firstPayload = await firstResponse.json();
  assert.equal(firstPayload.length, 8);
  assert.equal(
    firstPayload.filter((camera) => camera.hlsAvailable).length,
    4
  );
  assert.equal(
    firstPayload.filter((camera) => camera.retryHls).length,
    4
  );

  const secondResponse = await handleTrafficCameraMetadataRequest(
    { driveNcApiKey: "test-only" },
    new URL("https://wallboard.test/api/cameras")
  );
  assert.equal(secondResponse.status, 200);
  const secondPayload = await secondResponse.json();
  assert.equal(
    secondPayload.filter((camera) => camera.hlsAvailable).length,
    8
  );
  secondPayload.forEach((camera) => {
    assert(
      parseExpectedHlsUrl(camera.videoUrl, { requireToken: true })
    );
  });
  assert.equal(inventoryRequests, 1);
  assert.equal(signingRequests, 8 * 3);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("camera signing validation tests passed");
