# Data War Room

Private cinematic war room wallboard for the database administrators office TV. The app is built as a Next.js kiosk display that can be hosted behind a private URL and opened from an Apple TV signage/browser app.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000/wallboard`. Without environment variables, panels show setup or blank states rather than fallback telemetry.

**Requires a supported Node LTS (18.18+, 20.9+, or 22.x).** On Node v24+, `npm run dev` can hang indefinitely after printing `✓ Starting...` — the server accepts connections but every request times out with zero CPU usage (confirmed not a slow first compile). If `localhost:3000` won't respond, check `node -v` before troubleshooting anything else in the app itself.

If `http://localhost:3000` stops responding (hung/crashed dev server), run:

```bash
npm run dev:restart
```

This kills whatever's on port 3000 (including a hung `next dev`), switches to the Node version pinned in `.nvmrc` via `nvm` if available, and starts `npm run dev` fresh. It's a thin wrapper around `scripts/restart-dev.sh`; Ctrl+C stops it like a normal `npm run dev`.

## Static Wallboard

The root [index.html](/Users/lboone/Documents/Data%20Monitoring%20Room/index.html) is a self-contained static wallboard that can be served by any static web server. By default it looks for `wallboard.json` in the same folder:

```text
https://static-host.example/index.html
https://static-host.example/wallboard.json
```

Use [wallboard.example.json](/Users/lboone/Documents/Data%20Monitoring%20Room/wallboard.example.json) as the schema reference, copy it to `wallboard.json`, and replace it with the public wallboard payload you want the static file to render. `wallboard.json` is ignored by git so live/generated data is not committed accidentally.

You can still override the data URL if needed:

```text
https://static-host.example/index.html?api=https://example.com/wallboard.json
```

The static HTML never contains Google Analytics credentials, Apify tokens, private keys, or provider API keys. Those must remain outside committed source. The browser only receives the wallboard JSON payload. If no JSON file is reachable, the static page shows setup/degraded states instead of embedding secrets or crashing.

Do not put provider secrets in query strings, local storage, JavaScript constants, or the committed static file.

## Configuration

Copy [.env.example](/Users/lboone/Documents/Data%20Monitoring%20Room/.env.example) to `.env.local` for local development and fill in real values. For production, set the same names/values in your hosting platform's environment variable dashboard — never commit real values.

```bash
WALLBOARD_ACCESS_TOKEN=change-me
WALLBOARD_ALLOWED_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
GA_PROPERTY_ID=123456789
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
GA_CLIENT_EMAIL=service-account@example.iam.gserviceaccount.com
GA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
DATABASE_DASHBOARD_URL=https://dashboard.example.com/embed/token
DATABASE_REFRESH_SECONDS=60
DATABASE_FRAME_VIEWPORT_WIDTH=1024
DATABASE_FRAME_VIEWPORT_HEIGHT=640
DATABASE_FRAME_CROP_BOTTOM=96
DATABASE_FRAME_DARK_MODE=true
DATABASE_MONITORS_STATUS_URL=https://status.example.com/monitors.json
WEBSITE_HEALTHCHECK_ENABLED=false
WEBSITE_HEALTHCHECK_URL=https://www.example.org
WEBSITE_HOSTNAME=www.example.org
TRAFFIC_NO_USERS_CRITICAL=false
TRAFFIC_SPIKE_THRESHOLD=350
TRAFFIC_DROP_THRESHOLD=80
ALERT_AUDIO_ENABLED=true
ALERT_AUDIO_COOLDOWN_SECONDS=180
YOUTUBE_LIVE_CHANNEL_HANDLE=@BiltmoreChurch
YOUTUBE_FALLBACK_CHANNEL_HANDLE=@livenowfox
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APIFY_INSTAGRAM_PROFILE_URL=https://www.instagram.com/biltmorechurch/
APIFY_FACEBOOK_PAGE_URL=https://www.facebook.com/mybiltmorechurch/
```

`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, or `GA_CLIENT_EMAIL` plus `GA_PRIVATE_KEY` can be used for Google Analytics credentials. Prefer a service account with Viewer access to only the needed GA4 property.

`.env.local`, `.env`, and `.env.*` are ignored by git. Keep real secrets in those ignored files or in the deployment platform's secret store; `.env.example` at repo root holds only placeholder names/values and is safe to commit.

## Publishing on the Internet

This app is split into two independently hostable pieces on purpose, and they are meant to be deployed **separately**:

1. **The static wallboard** (`index.html`) — plain HTML/CSS/JS, no build step, no server requirement, no credentials. It can be uploaded via FTP/cPanel File Manager to almost any web host, including classic shared hosting that only serves static files.
2. **The secure API** (this Next.js app, specifically `app/api/wallboard/route.ts` and `app/api/traffic-camera/[id]/route.ts`) — holds every provider credential (GA service account, Apify token, monitor status URL, etc.) and must run on a host that can execute a persistent Node process. **Classic shared hosting cannot run this piece.**

Recommended setup:

- Deploy the Next.js app to a Node-capable platform. **Vercel** is the easiest path (first-party Next.js support, free tier, HTTPS by default, and an encrypted Environment Variables dashboard — set every value from `.env.example` there, never in code). Render, Fly.io, or a VPS running `next start` under `pm2`/`systemd` behind an nginx/Caddy reverse proxy with a Let's Encrypt certificate are equally valid alternatives if you want to avoid Vercel or need more control.
- Deploy `index.html` to your existing static/shared host, under your own domain.
- If the API host is a different domain than the static host, set `WALLBOARD_ALLOWED_ORIGIN` on the API host to the exact static-hosting origin(s) (e.g. `https://yourdomain.com`) so browsers will allow the cross-origin fetch. Without it, `/api/wallboard` only accepts same-origin requests (no CORS headers are added), which is the safe default and matches the original same-origin `/wallboard` route.
- Set `WALLBOARD_ACCESS_TOKEN` on the API host to a long random value (`openssl rand -hex 32`) **before** publishing either piece. The token is opt-in by design (unset means the API responds to anyone), so this step is not optional once the API is reachable from the public internet — an unset token on a public deployment means your telemetry endpoint is open to anyone who finds the URL.
- Visit `https://yourdomain.com/index.html?api=https://api.yourdomain.com/api/wallboard&token=<token>` once. `index.html` persists both the API URL and the token to browser local storage, so subsequent visits to the bare URL keep working without the query string.

**Never** put GA/Apify/monitor credentials into `index.html`, query strings, or any file served to browsers — they belong only in the API host's environment variables. `index.html` is only ever supposed to receive the already-sanitized JSON payload the API produces.

## Apple TV Usage

Use a signage/browser app on the Apple TV and point it to:

```text
https://your-host.example/wallboard?token=your-token
```

The token is stored in browser local storage and as a cookie so normal refreshes keep working. Use a dedicated least-privilege viewer account for authenticated dashboard embeds.

## Operational Notes

- The database dashboard is loaded as an iframe and refreshed every 60 seconds by default.
- The iframe is rendered through a configurable virtual viewport, then scaled into the panel. The default `1024x640` viewport fits the current Site24x7 public dashboard well on the 16:9 wallboard. Lower values zoom in; higher values zoom out.
- `DATABASE_FRAME_DARK_MODE=true` applies a browser-level darkening filter to the cross-origin iframe. `DATABASE_FRAME_CROP_BOTTOM` hides unused lower iframe space so the panel can use the room more efficiently.
- Site24x7 public dashboard dark theme is controlled in Site24x7 when sharing the dashboard. In the Share Dashboard / Make Public form, enable the dashboard dark theme if available; this app cannot restyle the cross-origin iframe after it loads.
- Some dashboard vendors block iframe embedding with `X-Frame-Options` or `Content-Security-Policy`. If that happens, use a vendor kiosk/share URL, a screenshot/proxy approach, or rebuild that panel with an API.
- Browsers often block autoplay audio until the page receives a user gesture. Press `arm audio` once in the signage browser session; it plays a short test chirp and then changes to `test audio`.
- Google Analytics realtime powers active users, events, and the world access map. The API payload still includes minute-trend data, but the current Website Pulse panel intentionally displays only active users and events. The map uses realtime `countryId`, `country`, and `city` dimensions. City dots are used only when the city is in the app coordinate table; otherwise the dot falls back to a country-level anchor. Top Pages and Sources both use same-day standard GA reports (not Realtime) since page/source popularity doesn't need to-the-second freshness and the standard Reporting API has a far larger quota than Realtime.
- Google Analytics setup issues or failures show blank/setup states and a warning instead of fallback data. Analytics results are cached for 3 minutes to protect GA API quota, with concurrent requests sharing one in-flight fetch instead of each firing their own. If GA returns a quota exhaustion error, analytics panels stay blank and the wallboard pauses GA calls until the next clock hour (GA's Realtime token quota resets on the hour, not on a rolling timer from the failure) instead of showing raw provider errors or creating an alert pop-up.
- Website Pulse is intentionally compact: it only shows the two GA realtime values that matter for the room, `Active last 30m` and `GA events last 30m`, as square stat tiles. Traffic Detail now occupies the other half of that top-left row with Top Pages and Sources.
- Header telemetry shows live/degraded mode, API age, generated time, and a `Rock Update!` countdown ending at midnight on July 27, 2026. The old bottom footer was removed so the lower panels have more vertical room.
- Traffic Detail uses same-day standard GA reports for Top Pages and Sources, not realtime rows. It displays the GA analytics cache window and fetch timestamp; rankings can look unchanged for a while when the same pages/sources remain on top.
- `DATABASE_MONITORS_STATUS_URL` can point at JSON with `downCount`, `down_count`, `down`, or a `monitors` array with `status` values. If it is not configured, the All Monitors row stays blank/nominal. If it is configured, any down/critical/failed/offline monitor creates a critical alert.
- Website health checks are passive by default and do not send synthetic requests to the public website. Set `WEBSITE_HEALTHCHECK_ENABLED=true` only if you want the wallboard API to send a periodic `HEAD` request to `WEBSITE_HEALTHCHECK_URL`.
- Audible alerts cover critical website traffic anomalies, failed website health, critical SSL state, and database monitor down states. All of these except a database monitor outage share one alert tone, gated to the configured cooldown (180s by default). A database monitor reporting down (the Site24x7 "All Monitors" feed) is treated as the most serious case: it plays a distinctly different siren-style tone that repeats automatically every 12 seconds — no cooldown, no manual dismiss — until the monitor recovers. Both tones require the `arm audio` button to have been pressed this browser session before anything can play (browser autoplay policy).
- A full-width ticker bar below the panel grid (and above the footer) scrolls a passive, ambient operations-log feed horizontally: real alerts appear there immediately (deduplicated, so the same alert isn't repeated), plus an occasional (every 2-5 minutes, randomized) ambient line pulled from the church's latest Instagram or Facebook post, or an internal "heartbeat" status phrase. A social post only surfaces as a prominent "New post" ticker line and large on-screen overlay when its `postedAt` timestamp is within the last 5 minutes; older latest posts stay in ambient rotation without presenting as breaking news. These social notices are still non-audible and never touch the audible-alert system. Posts are fetched server-side via Apify (`lib/apify.ts`, `APIFY_TOKEN`) since neither platform exposes a free public feed (confirmed by direct testing: Facebook returns a flat error page to anonymous requests, Instagram returns an empty JS shell with no post data), and cached 15 minutes per platform — Apify runs cost real money/compute per call, so don't shorten that cache without accounting for cost. If `APIFY_TOKEN` isn't set, the ticker falls back to alerts + heartbeat only, same graceful-degradation convention as everything else. The Active Database System panel no longer shows its own "All Monitors" / "Website Check" / "SSL" summary boxes (removed to give the embedded dashboard more room).
- A "Live Stream" panel shows the Biltmore Church YouTube channel (`YOUTUBE_LIVE_CHANNEL_HANDLE`) when it's actively broadcasting: a muted, autoplaying embed of the live video with a "LIVE" badge. No YouTube Data API key is required — live/offline detection scrapes the channel's `/live` page canonical link (`lib/youtubeLive.ts`), cached 45 seconds, following the same silent-fallback discipline as the other external calls. When the primary channel isn't live, the panel falls back to a second channel (`YOUTUBE_FALLBACK_CHANNEL_HANDLE`, defaults to LiveNOW from Fox) if that one is live, clearly badged in amber so it never reads as "Biltmore is live." If neither is live, the panel shows a quiet "Not currently live" state with the channel link instead of an empty/broken embed. If `YOUTUBE_LIVE_CHANNEL_HANDLE` isn't set, the panel doesn't render at all rather than showing a setup warning.
- The right-side local-ops column shows Arden, NC weather above eight unlabeled camera stills. Weather uses the no-key National Weather Service API for the Arden point (`35.4665,-82.5165`) via `lib/weather.ts`, cached 10 minutes with in-flight de-duplication and last-good fallback. Camera stills include six DriveNC raw JPEG endpoints and two IPCamLive snapshot JPEGs, all routed through the local `/api/traffic-camera/[id]` proxy (`lib/trafficCameras.ts`), cached 60 seconds and refreshed in the browser every 60 seconds. Camera labels remain available as image alt text; if a camera request fails, the tile shows a degraded overlay instead of breaking the wallboard. `/api/wallboard`'s `trafficCameras.cameras[].url` is always an absolute proxy URL built from the request's own origin (`${request.nextUrl.origin}/api/traffic-camera/<id>`), never the raw DriveNC/IPCamLive URL — this keeps both the same-origin `/wallboard` page and a cross-origin static `index.html` deployment routing through the cached proxy instead of hitting vendor endpoints directly from the browser.
- The Active Database System panel intentionally has no refresh/last-updated toolbar; the iframe refresh still runs on `DATABASE_REFRESH_SECONDS`.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
```
