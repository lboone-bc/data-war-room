/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Applies to every route, including /api/wallboard and
        // /api/traffic-camera/[id]. Doesn't set frame-ancestors/X-Frame-Options
        // since /wallboard itself is meant to be opened inside Apple TV
        // signage browser shells, and this app embeds cross-origin iframes
        // (Site24x7 dashboard, YouTube) that must keep working.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // NOT "no-referrer": confirmed live on Railway 2026-07-09 that it
          // breaks the embedded YouTube live player (YouTube error 153) —
          // YouTube's iframe player validates the embedding page's referrer
          // to authorize playback and fails with no referrer at all.
          // strict-origin-when-cross-origin still avoids leaking full
          // path/query to third parties (only the origin crosses an origin
          // boundary) while keeping YouTube/Site24x7 embeds working.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;

