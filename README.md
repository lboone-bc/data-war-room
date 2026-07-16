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

[public/index.html](/Users/lboone/Documents/Data%20Monitoring%20Room/public/index.html) is a framework-free static wallboard (plain HTML/CSS/JS; no front-end build step). It lives in Next.js's `public/` folder for local use and is the public asset served by the Cloudflare Worker configured in `wrangler.jsonc`. By default it fetches `/api/wallboard` same-origin; in production, `cloudflare/worker.js` implements that secret-bearing API directly, so no second host, Railway service, or browser CORS setup is required.

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

`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, or `GA_CLIENT_EMAIL` plus `GA_PRIVATE_KEY` can be used by the local Next.js API. Cloudflare cannot read a local credential-file path, so production must use `GOOGLE_APPLICATION_CREDENTIALS_JSON` as an encrypted secret or `GA_CLIENT_EMAIL` plus an encrypted `GA_PRIVATE_KEY`. Prefer a service account with Viewer access to only the needed GA4 property.

`.env.local`, `.env`, and `.env.*` are ignored by git. Keep real secrets in those ignored files or in the deployment platform's secret store; `.env.example` at repo root holds only placeholder names/values and is safe to commit.

## Publishing on the Internet — Free Cloudflare Setup

Production is one Git-connected Cloudflare Worker: [https://data-war-room.lboone.workers.dev/](https://data-war-room.lboone.workers.dev/). It serves the static display and performs the GA, NCDOT, NWS, YouTube, monitor, and optional Apify calls server-side. Railway is not required. Pushes to `main` in `lboone-bc/data-war-room` trigger the existing Cloudflare deployment.

Cloudflare's Workers Free plan currently allows 100,000 requests per day. A wallboard polling every 30 seconds uses about 2,880 requests per day, and the Worker's composed-response/provider caches prevent those polls from becoming equivalent upstream calls.

### Where production variables go

Open **Cloudflare → Workers & Pages → data-war-room → Settings → Variables and Secrets → Add**, enter the names below, and press **Deploy**. Use **Secret** for anything marked secret; secret values are encrypted and hidden after saving.

| Name | Type | Required | Purpose |
| --- | --- | --- | --- |
| `WALLBOARD_ACCESS_TOKEN` | Secret | Strongly recommended | Protects the public JSON endpoint and display. Generate with `openssl rand -hex 32`. |
| `GA_PROPERTY_ID` | Variable | For GA | Numeric GA4 property ID. |
| `GA_CLIENT_EMAIL` | Variable | For GA | Service-account `client_email`. |
| `GA_PRIVATE_KEY` | Secret | For GA | Full service-account private key, including BEGIN/END lines. Use this with `GA_CLIENT_EMAIL`. |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Secret | Alternative GA method | Full service-account JSON; use instead of the two GA credential fields above. |
| `DRIVENC_API_KEY` | Secret | For live NCDOT HLS | Same free DriveNC developer key used by `cctv-weather-wall`. |
| `DATABASE_DASHBOARD_URL` | Secret | For database panel | Public/kiosk/share URL; keep it secret when it contains a token. |
| `DATABASE_MONITORS_STATUS_URL` | Secret | Optional | JSON/text monitor status endpoint. |
| `YOUTUBE_LIVE_CHANNEL_HANDLE` | Variable | Optional | Primary handle such as `@BiltmoreChurch`. |
| `YOUTUBE_FALLBACK_CHANNEL_HANDLE` | Variable | Optional | Defaults to `@livenowfox`; set blank to disable. |
| `WEBSITE_HEALTHCHECK_ENABLED` | Variable | Optional | `true` enables periodic synthetic HEAD checks; default is `false`. |
| `WEBSITE_HEALTHCHECK_URL` | Variable | Optional | URL checked only when the setting above is true. |
| `WEBSITE_HOSTNAME` | Variable | Optional | Display/reference hostname. Cloudflare Workers cannot expose peer-certificate expiry, so renewal alerting should remain in Site24x7. |
| `APIFY_TOKEN` | Secret | Optional, not $0-guaranteed | Enables Instagram/Facebook. Leave unset for a truly no-cost wallboard. |
| `APIFY_INSTAGRAM_PROFILE_URL` | Variable | With Apify | Instagram profile URL. |
| `APIFY_FACEBOOK_PAGE_URL` | Variable | With Apify | Facebook page URL. |

The remaining layout, threshold, and audio variables in [.env.example](/Users/lboone/Documents/Data%20Monitoring%20Room/.env.example) are optional; defaults already match the current display. Do not add `WALLBOARD_API_ORIGIN`—the Worker is now the API.

After saving variables, open `https://data-war-room.lboone.workers.dev/?token=<WALLBOARD_ACCESS_TOKEN>` once in the signage browser. The display stores that access token locally for later refreshes. Provider keys and the GA private key never reach browser JavaScript.

The production header includes a fullscreen button (`⛶`) and supports the `F` key. On a TV browser that does not expose the browser Fullscreen API, enable that signage app's own kiosk/fullscreen option; the wallboard already locks itself to the full viewport and declares standalone web-app capability.

For local Worker testing, copy [.dev.vars.example](/Users/lboone/Documents/Data%20Monitoring%20Room/.dev.vars.example) to the ignored `.dev.vars`, fill the same names, and run `npm run dev:cloudflare`. A local `GOOGLE_APPLICATION_CREDENTIALS=/path/file.json` path only works with Next.js; the Worker uses JSON or email/private-key credentials even locally. Use `npm run deploy:cloudflare` only for a manual deployment; normal production deploys come from Git.

Wrangler is pinned to the Node-20-compatible `~4.63.0` line. Newer Wrangler releases require Node 22; move that pin only during a coordinated Node 22 + Next.js/React migration.

Cloudflare's Git build configuration must use `npm run deploy:cloudflare` as its production deploy command (and `npm exec -- wrangler versions upload` for non-production branches). Do not replace it with bare `npx wrangler deploy`: the latest auto-configuring Wrangler may mistake the repo's local Next.js surface for the production target, invoke OpenNext, and reject Next.js 14 before it reaches the actual static-assets Worker configuration.

`wrangler.jsonc` intentionally sets `keep_vars: true`. Cloudflare documents that Wrangler otherwise overrides dashboard-managed variables on deployment; removing this flag can erase `GA_PROPERTY_ID` and encrypted provider secrets during the next Git build.

Cloudflare's dashboard Git integration previously wiped an encrypted secret in the companion camera project. If `/api/wallboard` suddenly returns `401` or returns setup states after a deploy, first verify **Settings → Variables and Secrets**. If it repeats, switch deployment to GitHub Actions with `cloudflare/wrangler-action`.

`?api=https://...` remains supported for alternate JSON testing, but normal Cloudflare use is same-origin and needs no CORS. Never place GA, Apify, DriveNC, monitor, or dashboard credentials in `public/index.html`, query strings, or any browser-served file.

## Apple TV Usage

Use a signage/browser app on the Apple TV and point it to:

```text
https://your-cloudflare-worker.example/?token=your-token
```

The token is stored in browser local storage and as a cookie so normal refreshes keep working. Use a dedicated least-privilege viewer account for authenticated dashboard embeds.

## Operational Notes

- The database dashboard is loaded as an iframe and refreshed every 60 seconds by default.
- The iframe is rendered through a configurable desktop virtual viewport, then scaled and cropped into the panel on both the React and Cloudflare/static wallboards. The default `1024x640` viewport prevents the vendor's responsive page from switching to its mobile layout inside the narrow panel. Production scales that desktop canvas to the panel width and uses the panel height as a crop window, avoiding a tiny fit-to-height thumbnail. `DATABASE_FRAME_CROP_BOTTOM=96` also excludes the unused lower portion; lower viewport values zoom in and higher values zoom out.
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
- A full-width ticker bar below the panel grid scrolls a passive operations feed: deduplicated real alerts, occasional Instagram/Facebook content, and heartbeat lines. Social posts use paid Apify actors only when `APIFY_TOKEN` is configured. Production caches each platform for one hour; the local Next.js API retains its 15-minute cache. Failures retain last-good content. Leave the token unset for heartbeat-only ticker content and no Apify expense.
- A "Live Stream" panel shows the Biltmore Church YouTube channel (`YOUTUBE_LIVE_CHANNEL_HANDLE`) when it's actively broadcasting: a muted, autoplaying embed of the live video with a "LIVE" badge. No YouTube Data API key is required — live/offline detection scrapes the channel's `/live` page canonical link (`lib/youtubeLive.ts`), cached 45 seconds, following the same silent-fallback discipline as the other external calls. When the primary channel isn't live, the panel falls back to a second channel (`YOUTUBE_FALLBACK_CHANNEL_HANDLE`, defaults to LiveNOW from Fox) if that one is live, clearly badged in amber so it never reads as "Biltmore is live." If neither is live, the panel shows a quiet "Not currently live" state with the channel link instead of an empty/broken embed. If `YOUTUBE_LIVE_CHANNEL_HANDLE` isn't set, the panel doesn't render at all rather than showing a setup warning.
- The right-side local-ops column shows Arden, NC weather above eight unlabeled **live NCDOT HLS streams**. `lib/trafficCameras.ts` handles the local Next route and `cloudflare/providers.js` handles production; each calls DriveNC server-side with `DRIVENC_API_KEY`, filters the curated I-26/US-25 IDs, and caches public media metadata for 90 seconds with last-good fallback. Safari uses native HLS; other browsers use `hls.js`. A tile that does not reach a real `playing` event within 18 seconds falls back to a scaled DriveNC viewer iframe. Labels stay in accessibility text only.
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
