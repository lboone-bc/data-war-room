// Cloudflare serves the static wallboard while the existing Next.js service
// remains the secret-bearing API backend. This keeps GA service-account,
// Apify, DriveNC, monitor, and dashboard credentials out of browser assets.

function backendUrl(requestUrl, apiOrigin) {
  const source = new URL(requestUrl);
  const target = new URL(source.pathname + source.search, apiOrigin);
  return target;
}

function proxyHeaders(request, env) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  if (env.WALLBOARD_ACCESS_TOKEN) {
    headers.set("x-wallboard-token", env.WALLBOARD_ACCESS_TOKEN);
  }
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", "https");
  return headers;
}

function hasAccess(request, env) {
  if (!env.WALLBOARD_ACCESS_TOKEN) return true;
  const url = new URL(request.url);
  return (
    request.headers.get("x-wallboard-token") === env.WALLBOARD_ACCESS_TOKEN ||
    url.searchParams.get("token") === env.WALLBOARD_ACCESS_TOKEN
  );
}

async function proxyApi(request, env) {
  if (!env.WALLBOARD_API_ORIGIN) {
    return Response.json(
      { error: "WALLBOARD_API_ORIGIN is not configured on the Cloudflare Worker." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  if (!hasAccess(request, env)) {
    return Response.json(
      { error: "Wallboard access token is missing or invalid." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const upstream = await fetch(backendUrl(request.url, env.WALLBOARD_API_ORIGIN), {
    method: request.method,
    headers: proxyHeaders(request, env),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }

    if (url.pathname === "/") {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
