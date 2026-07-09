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
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;

