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

[public/index.html](/Users/lboone/Documents/Data%20Monitoring%20Room/public/index.html) is a framework-free static wallboard (plain HTML/CSS/JS; no front-end build step). It lives in Next.js's `public/` folder for local/API-host use and is also the public asset served by the Cloudflare Worker configured in `wrangler.jsonc`. By default it fetches `/api/wallboard` same-origin; on Cloudflare, `cloudflare/worker.js` proxies that path to the secret-bearing Next.js API host, so the display still has one public origin and needs no browser CORS setup.

It can still be pointed at a different JSON source if needed (e.g. a second static-only mirror hosted elsewhere with no backend of its own):

```text
https://your-app.example/index.html?api=https://example.com/wallboard.json
```

Use [wallboard.example.json](/Users/lboone/Documents/Data%20Monitoring%20Room/wallboard.example.json) as the schema reference for that case; a `wallboard.json` you create yourself for it is gitignored so live/generated data is never committed.

The static HTML never contains Google Analytics credentials, Apify tokens, private keys, or provider API keys. Those must remain outside committed source. The browser only receives the wallboard JSON payload. If no JSON is reachable, the static page shows setup/degraded states instead of embedding secrets or crashing.

Do not put provider secrets in query strings, local storage, JavaScript constants, or the committed static file — this was evaluated and explicitly rejected during this app's public-hosting design pass; see `AGENTS.md`.

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
DRIVENC_API_KEY=drivenc_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, or `GA_CLIENT_EMAIL` plus `GA_PRIVATE_KEY` can be used for Google Analytics credentials. Prefer a service account with Viewer access to only the needed GA4 property.

`.env.local`, `.env`, and `.env.*` are ignored by git. Keep real secrets in those ignored files or in the deployment platform's secret store; `.env.example` at repo root holds only placeholder names/values and is safe to commit.

## Publishing on the Internet

The public display now follows the same Git-connected Cloudflare Worker + static-assets model as `cctv-weather-wall`, while the existing Next.js service remains the private API backend. This split is deliberate: Cloudflare serves `public/index.html` and proxies `/api/*` same-origin; GA service-account credentials, Apify tokens, DriveNC keys, and monitor/dashboard configuration stay only on the Node backend.

Production display: [https://data-war-room.lboone.workers.dev/](https://data-war-room.lboone.workers.dev/). The Cloudflare GitHub App is authorized for `lboone-bc/data-war-room`, and pushes to `main` trigger a verified Workers build/deploy. Until the Railway/Node backend is deployed and its URL is assigned to `WALLBOARD_API_ORIGIN`, the static shell is live but telemetry remains in its controlled setup state.

### 1. Deploy the API backend

Railway remains a good backend target because it runs the complete Next.js server:

1. Connect this GitHub repo to a Railway project. `railway.json`, `package.json`'s `engines.node`, and `.nvmrc` keep the service on Node 20 and start it with `npm run start`.
2. Add the values from [.env.example](/Users/lboone/Documents/Data%20Monitoring%20Room/.env.example) in Railway's Variables tab, including `DRIVENC_API_KEY` and a long random `WALLBOARD_ACCESS_TOKEN` (`openssl rand -hex 32`).
3. Confirm `https://<api-host>/api/wallboard?token=<token>` returns sanitized JSON. The backend URL must be HTTPS before Cloudflare proxies it.

### 2. Connect the static display to Cloudflare Git deployment

1. Push this repo to GitHub (the configured remote is `lboone-bc/data-war-room`).
2. In Cloudflare, choose **Workers & Pages → Create → Import a repository**, select this repo, and use `npx wrangler deploy` as the deploy command. `wrangler.jsonc` already points at `cloudflare/worker.js` and `./public`.
3. Add `WALLBOARD_API_ORIGIN=https://<api-host>` as a normal Worker variable. Do not add a trailing `/api/wallboard`; the Worker forwards the original `/api/*` path.
4. Add `WALLBOARD_ACCESS_TOKEN` as an encrypted Worker secret with the same value used by the backend. The Worker validates the browser's token, then sends it upstream without exposing provider credentials.
5. Open `https://<worker>.workers.dev/?token=<token>` once. The static wallboard stores the token in local storage for the signage browser.

For local split-host testing, copy [.dev.vars.example](/Users/lboone/Documents/Data%20Monitoring%20Room/.dev.vars.example) to `.dev.vars`, run the Next API with `npm run dev`, then run `npm run dev:cloudflare` in a second terminal. Use `npm run deploy:cloudflare` for a manual Wrangler deploy.

Wrangler is pinned to the Node-20-compatible `~4.63.0` line. Newer Wrangler releases require Node 22; move that pin only during a coordinated Node 22 + Next.js/React migration.

Cloudflare's dashboard Git integration has previously wiped encrypted secrets on deployment in the companion camera project. If `/api/wallboard` suddenly returns `401` after a deploy, first verify the Worker's `WALLBOARD_ACCESS_TOKEN`. If this repeats, switch deployment to GitHub Actions with `cloudflare/wrangler-action`; a direct `wrangler deploy` preserves Worker secrets more reliably.

`WALLBOARD_ALLOWED_ORIGIN` and `?api=https://...` remain supported for direct cross-origin/browser testing, but the normal Cloudflare Worker path is same-origin and does not need CORS. Never place GA, Apify, DriveNC, monitor, or dashboard credentials in `public/index.html`, query strings, or any browser-served file.

## Apple TV Usage

Use a signage/browser app on the Apple TV and point it to:

```text
https://your-cloudflare-worker.example/?token=your-token
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
- Google Analytics uses two Realtime reports (summary + geo) at most once every 5 minutes. The old third `minutesAgo` call was removed; traffic-anomaly history is built from the cached summary samples. Top Pages and Sources use two standard reports on a separate 15-minute cache. Concurrent requests share in-flight promises, the GA client is reused, and last-good data survives transient failures. Quota exhaustion pauses Realtime calls until the next clock-hour boundary because GA's property-token quota resets on the hour.
- Website Pulse is intentionally compact: it only shows the two GA realtime values that matter for the room, `Active last 30m` and `GA events last 30m`, as square stat tiles. Traffic Detail now occupies the other half of that top-left row with Top Pages and Sources.
- Header telemetry shows live/degraded mode, API age, generated time, and a `Rock Update!` countdown ending at midnight on July 27, 2026. The old bottom footer was removed so the lower panels have more vertical room.
- Traffic Detail uses same-day standard GA reports for Top Pages and Sources, not realtime rows. It displays the GA analytics cache window and fetch timestamp; rankings can look unchanged for a while when the same pages/sources remain on top.
- `DATABASE_MONITORS_STATUS_URL` can point at JSON with `downCount`, `down_count`, `down`, or a `monitors` array with `status` values. If it is not configured, the All Monitors row stays blank/nominal. If it is configured, any down/critical/failed/offline monitor creates a critical alert.
- Website health checks are passive by default and do not send synthetic requests to the public website. Set `WEBSITE_HEALTHCHECK_ENABLED=true` only if you want the wallboard API to send a periodic `HEAD` request to `WEBSITE_HEALTHCHECK_URL`.
- Audible alerts cover critical website traffic anomalies, failed website health, critical SSL state, and database monitor down states. All of these except a database monitor outage share one alert tone, gated to the configured cooldown (180s by default). A database monitor reporting down (the Site24x7 "All Monitors" feed) is treated as the most serious case: it plays a distinctly different siren-style tone that repeats automatically every 12 seconds — no cooldown, no manual dismiss — until the monitor recovers. Both tones require the `arm audio` button to have been pressed this browser session before anything can play (browser autoplay policy).
- A full-width ticker bar below the panel grid scrolls a passive operations feed: deduplicated real alerts, occasional Instagram/Facebook content, and heartbeat lines. Social posts are fetched server-side through the paid Apify actors and cached 15 minutes per platform. Any failed/empty/timeout run now backs off for one hour while retaining the last-good post, preventing the 30-second wallboard poll from repeatedly starting billed actors during an outage. A post only gets the prominent "New post" treatment when its timestamp is within the last 5 minutes; social notices remain non-audible.
- A "Live Stream" panel shows the Biltmore Church YouTube channel (`YOUTUBE_LIVE_CHANNEL_HANDLE`) when it's actively broadcasting: a muted, autoplaying embed of the live video with a "LIVE" badge. No YouTube Data API key is required — live/offline detection scrapes the channel's `/live` page canonical link (`lib/youtubeLive.ts`), cached 45 seconds, following the same silent-fallback discipline as the other external calls. When the primary channel isn't live, the panel falls back to a second channel (`YOUTUBE_FALLBACK_CHANNEL_HANDLE`, defaults to LiveNOW from Fox) if that one is live, clearly badged in amber so it never reads as "Biltmore is live." If neither is live, the panel shows a quiet "Not currently live" state with the channel link instead of an empty/broken embed. If `YOUTUBE_LIVE_CHANNEL_HANDLE` isn't set, the panel doesn't render at all rather than showing a setup warning.
- The right-side local-ops column shows Arden, NC weather above eight unlabeled **live NCDOT HLS streams**. `lib/trafficCameras.ts` calls the DriveNC Cameras API server-side with `DRIVENC_API_KEY`, filters the curated I-26/US-25 IDs, and caches public media metadata for 90 seconds with in-flight de-duplication, failed-attempt backoff, and last-good fallback. Safari uses native HLS; other browsers use `hls.js`. A tile that does not reach a real `playing` event within 18 seconds falls back to a scaled DriveNC viewer iframe, then retries after 90 seconds. The old 60-second JPEG proxy route and IPCamLive snapshots were removed. Labels stay in accessibility text only; green/red status dots and an amber priority frame provide operational state without covering the video.
- The Active Database System panel intentionally has no refresh/last-updated toolbar; the iframe refresh still runs on `DATABASE_REFRESH_SECONDS`.

## Scripts

```bash
npm run dev
npm run dev:cloudflare
npm run build
npm run typecheck
npm run lint
npm run deploy:cloudflare
```

`npm audit` still reports production advisories in Next.js 14/PostCSS that only npm's forced Next.js 16 upgrade resolves. That major framework/React migration is intentionally left as separate future work rather than being mixed into this wallboard/camera/deployment change.
