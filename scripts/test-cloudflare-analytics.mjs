import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const edgeCache = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      return edgeCache.get(request.url)?.clone() || undefined;
    },
    async put(request, response) {
      edgeCache.set(request.url, response.clone());
    }
  }
};

let requests = 0;
globalThis.fetch = async (url, options = {}) => {
  requests += 1;
  const href = String(url);
  if (href === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "test-access-token", expires_in: 3600 });
  }

  const body = JSON.parse(options.body || "{}");
  if (href.endsWith(":runRealtimeReport")) {
    if (body.dimensions?.length) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: "US" }, { value: "United States" }, { value: "Asheville" }],
          metricValues: [{ value: "7" }]
        }]
      });
    }
    return Response.json({
      rows: [{ metricValues: [{ value: "7" }, { value: "42" }] }]
    });
  }

  if (href.endsWith(":runReport")) {
    const sessions = body.metrics?.[0]?.name === "sessions";
    return Response.json({
      rows: [{
        dimensionValues: [{ value: sessions ? "Organic Search" : "Home" }],
        metricValues: [{ value: sessions ? "9" : "12" }]
      }]
    });
  }

  throw new Error(`Unexpected request: ${href}`);
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { getAnalytics } = await import("../cloudflare/analytics.js");
const config = {
  gaPropertyId: "123456789",
  gaClientEmail: "wallboard@example.iam.gserviceaccount.com",
  gaPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  googleCredentialsJson: null
};

const first = await getAnalytics(config);
assert.equal(first.mode, "live");
assert.equal(first.analytics.activeUsers, 7);
assert.equal(first.analytics.eventCount, 42);
assert.equal(first.analytics.geo[0].region, "Asheville, United States");
assert.equal(first.analytics.topPages[0].value, "12 views");
assert.equal(first.analytics.topSources[0].value, "9 sessions");
assert.equal(requests, 5);

const second = await getAnalytics(config);
assert.equal(second.mode, "live");
assert.equal(requests, 5, "fresh cache should prevent repeat GA/OAuth calls");

console.log("Cloudflare GA service-account signing, report parsing, and cache test passed.");
