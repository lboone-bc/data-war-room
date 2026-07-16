# Reference Index

## Product

- Name: Data War Room
- Purpose: Private emergency-monitoring-room style wallboard for the database administrators office TV.
- Primary route: `/wallboard`
- Production artifact: `public/index.html` is served from the static-assets binding in `wrangler.jsonc`; `cloudflare/worker.js` implements `/api/wallboard` in the same Worker. Provider modules are `cloudflare/analytics.js`, `cloudflare/providers.js`, `cloudflare/config.js`, and `cloudflare/cache.js`. Railway/another Node host and `WALLBOARD_API_ORIGIN` are not part of production.
- Production display URL: `https://data-war-room.lboone.workers.dev/`. Git auto-deploy from `lboone-bc/data-war-room` was restored and validated 2026-07-16. The Cloudflare Worker is designed for the free plan and degrades individual feeds when their optional variables are absent.
- Git connection was explicitly reconnected 2026-07-16 after pushes stopped triggering builds; `main` deploys with `npm run deploy:cloudflare`, and non-production builds are disabled.
- Production GA status: live-verified 2026-07-16 with `GA_PROPERTY_ID` and encrypted `GOOGLE_APPLICATION_CREDENTIALS_JSON`; the service account can read realtime summary/geo and same-day page/source reports. The downloaded JSON is a private credential and must stay outside Git.
- Display target: single 16:9 landscape screen through Apple TV signage/browser software.
- Brand posture: no visible organization branding.
- Header: visible title is "War Room"; `.header-stats` carries the old footer telemetry; `Rock Update!` countdown ends at `2026-07-27T00:00:00-04:00`.
- Static security model: `public/index.html` contains no provider credentials. It fetches `/api/wallboard` same-origin; the Cloudflare Worker validates `WALLBOARD_ACCESS_TOKEN` and calls providers with encrypted Worker secrets. `?api=...` remains available for alternate JSON testing, while `wallboard.example.json` is the sanitized schema reference. Embedding raw provider credentials in browser code remains explicitly prohibited.

## External Systems

- Google Analytics Realtime Data API
  - Production config: `GA_PROPERTY_ID` plus either the `GOOGLE_APPLICATION_CREDENTIALS_JSON` secret or `GA_CLIENT_EMAIL` + `GA_PRIVATE_KEY` secret. `GOOGLE_APPLICATION_CREDENTIALS=/path/file.json` is local Node-only and cannot work in Cloudflare.
  - Used for active users, event count, and world-map geo activity via `countryId` and `country`; the API payload still includes minute-trend data, but Website Pulse currently displays only active users and events.
  - Cloudflare map geometry: `public/world-map.svg`, an equirectangular `world-atlas` land/country asset aligned to the static page's percentage-projected GA dots.
  - Realtime also supports `city`; the wallboard uses city-level dots only for cities present in the coordinate table and otherwise falls back to a country-level anchor.
  - Top Pages and Sources both use today's standard GA report (not Realtime) — page/source popularity doesn't need to-the-second freshness, and it keeps load off the much smaller Realtime quota.
  - Implementations: `cloudflare/analytics.js` in production (GA Data REST API + service-account JWT signed with Web Crypto) and `lib/analytics.ts` locally. Summary + geo are the only Realtime reports and share a 5-minute cache; Top Pages/Sources are standard reports on a 15-minute cache. `cloudflare/cache.js` combines warm-isolate in-flight de-duplication with Cache API last-good records.
- Apify (Instagram + Facebook latest post)
  - Config: `APIFY_TOKEN`, `APIFY_INSTAGRAM_PROFILE_URL`, `APIFY_FACEBOOK_PAGE_URL`
  - Used only for the ambient "system log" ticker (`app/wallboard/page.tsx`'s `SystemLog`/`useSystemLog`), which spans the full width of the wallboard below the panel grid and rotates the church's latest Instagram/Facebook post alongside internal heartbeat lines every 2-5 minutes. A post only surfaces as a distinct "New post" ticker line plus `.social-post-popup` overlay when its `postedAt` timestamp is within the last 5 minutes. Purely decorative/ambient in the sense that it never generates an audible alert or blocks rendering, and silently falls back to heartbeat-only lines on failure.
  - Neither platform has a free public feed (confirmed by direct testing: Facebook returns a flat error page and Instagram an empty JS shell to anonymous requests), so this runs through Apify's `apify~instagram-post-scraper` and `apify~facebook-posts-scraper` actors via the `run-sync-get-dataset-items` API — Apify does the actual scraping on its own infrastructure/ToS relationship with those platforms, this app never scrapes them directly.
  - Implementations: `cloudflare/providers.js` in production, cached one hour per platform, and `lib/apify.ts` locally, cached 15 minutes. Failed/empty runs retain last-good content. `APIFY_TOKEN` is optional and should stay unset when the requirement is strictly $0 hosting/provider spend.
  - Production status checked 2026-07-16: the Cloudflare Worker has no `APIFY_TOKEN` or Apify profile URL bindings, so `/api/wallboard` correctly returns an empty `socialPosts` array and the ticker runs alerts/heartbeat only. Enabling social posts requires an explicit cost decision because each actor run consumes Apify resources.
- Existing active database dashboard
  - Config: `DATABASE_DASHBOARD_URL`
  - Production status: configured as an encrypted Cloudflare Worker secret and payload-verified 2026-07-16.
  - Rendered as a scaled iframe and refreshed on `DATABASE_REFRESH_SECONDS`.
  - The panel does not render refresh/last-updated toolbar text; that space belongs to the iframe.
  - Zoom/viewport config: `DATABASE_FRAME_VIEWPORT_WIDTH`, `DATABASE_FRAME_VIEWPORT_HEIGHT`; default is `1024x640`.
  - Visual controls: `DATABASE_FRAME_DARK_MODE` applies an iframe filter and `DATABASE_FRAME_CROP_BOTTOM` crops unused lower space.
  - Both `app/wallboard/page.tsx` and `public/index.html` render that fixed desktop-sized iframe and scale it into the panel. Production uses width-driven scaling plus a panel-height crop window so the dashboard is readable rather than fit-height/letterboxed. The iframe must not inherit the panel's narrow width, which triggers the embedded dashboard's mobile breakpoint.
  - Dark theme must be enabled in the Site24x7 public dashboard share settings when available.
- Database monitor status endpoint
  - Config: `DATABASE_MONITORS_STATUS_URL`
  - Used for the prominent All Monitors count and critical alert when any system is down. Missing config stays quiet instead of raising a setup alert.
- Website health and SSL checks
  - Config: `WEBSITE_HEALTHCHECK_ENABLED`, `WEBSITE_HEALTHCHECK_URL`, `WEBSITE_HOSTNAME`
  - Website health checks are passive by default; enable explicitly before sending synthetic `HEAD` requests to the public website.
- YouTube live status (Live Stream panel)
  - Config: `YOUTUBE_LIVE_CHANNEL_HANDLE`, `YOUTUBE_FALLBACK_CHANNEL_HANDLE` (defaults to `@livenowfox`)
  - Production status: both handles configured and payload-verified 2026-07-16; primary was offline and the fallback was active during the check.
  - No API key required — `lib/youtubeLive.ts` scrapes the channel's `/<handle>/live` page canonical link to detect an active broadcast, cached 45 seconds with the same silent-fallback discipline as every other external call. When the primary channel is live, shows a muted autoplaying embed with a "LIVE" badge; when it isn't, falls back to the fallback channel (clearly badged as such) if that one is live; otherwise a quiet "Not currently live" state. Missing `YOUTUBE_LIVE_CHANNEL_HANDLE` means the panel doesn't render at all rather than showing a setup warning.
- National Weather Service API (Arden Weather panel)
  - Config: none.
  - Uses the no-key NWS point endpoint for Arden, NC (`35.4665,-82.5165`) to discover the forecast and nearest observation station, then shows current conditions plus three daytime forecast cards in the right-side local-ops column.
  - Implementations: `cloudflare/providers.js` in production and `lib/weather.ts` locally, cached 10 minutes with in-flight de-duplication and silent last-good/empty fallback.
- Traffic cameras
  - Config: `DRIVENC_API_KEY`; keep the numeric camera ID/label/priority lists aligned in `cloudflare/providers.js` and `lib/trafficCameras.ts`.
  - IDs: `4208`, `4839`, `6120`, `5269`, `4210`, `4868`, `4876`, `4221` (I-26/US-25 corridor). DriveNC metadata is cached 90 seconds with in-flight de-duplication, a failed-attempt cache, and last-good fallback.
  - `Views[0].VideoUrl` supplies public HLS streams. The browser plays native HLS on Safari and `hls.js` elsewhere; playback must reach `playing` within 18 seconds or that tile falls back to a scaled `https://www.drivenc.gov/map/Cctv/<id>` viewer iframe. The old JPEG proxy route and IPCamLive feeds are gone.
  - Layout remains an unlabeled `2 x 4` grid in `.ops-column`; labels are accessibility text, status dots show live/fallback state, and camera `4208` receives the amber priority frame.

## Security And Access

- Private display access is controlled by `WALLBOARD_ACCESS_TOKEN`. It is opt-in by design (unset means no auth gate) — publishing this app on the public internet requires setting it deliberately; there is no code-level enforcement.
- Production `/api/wallboard` is same-origin in the Cloudflare Worker and does not need CORS or `WALLBOARD_ALLOWED_ORIGIN`.
- Open Apple TV signage to the Cloudflare display root `/?token=...`; `/wallboard?token=...` remains the React/backend surface for local or diagnostic use.
- The production static header has a fullscreen toggle and `F` shortcut using standard + WebKit fullscreen APIs. This control must remain aligned with the React `FullscreenButton`; TV signage apps without browser fullscreen support require their own kiosk setting.
- Use dedicated least-privilege viewer credentials for any authenticated embed.
- `.env.example` documents local/full configuration; `.dev.vars.example` documents the Cloudflare-local subset. Real values go in ignored `.env.local` / `.dev.vars` files or Cloudflare **Workers & Pages → data-war-room → Settings → Variables and Secrets**.
- Public hosting target: one Git-connected Cloudflare Worker with static assets and a native API. Sensitive production values must use the Secret type. Verify them after Git deploys because Cloudflare's dashboard integration previously wiped a secret in the companion project.
- Cloudflare production deploy command: `npm run deploy:cloudflare` so the repository-pinned Wrangler consumes `wrangler.jsonc`. The bare `npx wrangler deploy` command was removed from dashboard build settings after Cloudflare's latest auto-config tried `opennextjs-cloudflare` and rejected the unrelated Next.js 14 local surface. Non-production version uploads use `npm exec -- wrangler versions upload`. `wrangler.jsonc` must retain `keep_vars: true`; a deploy without it directly reproduced deletion of the dashboard-managed GA variable and credential secret.

## Alerting

- Audible alerts cover critical website traffic anomalies, failed website health, critical SSL state, and database monitor down states.
- Thresholds:
  - `TRAFFIC_NO_USERS_CRITICAL`
  - `TRAFFIC_SPIKE_THRESHOLD`
  - `TRAFFIC_DROP_THRESHOLD`
  - `ALERT_AUDIO_COOLDOWN_SECONDS`
- Browser audio requires the `arm audio` button to be pressed once per signage session. The button plays a short test chirp when armed so signage audio can be verified.
- The ambient "system log" (full-width ticker bar below the panel grid) is a separate, non-audible, non-alerting display of the same `alerts` array plus decorative content — it does not affect audible-alert logic or cooldowns.

## Future Work

- Plan a coordinated Node 22 + Next.js 16/React migration. It is required to clear the remaining Next.js 14/PostCSS production audit advisories and to move beyond the Node-20-compatible Wrangler `~4.63.0` pin; treat it as a dedicated regression-tested upgrade, not an automatic `npm audit fix --force`.
- If Cloudflare Git deployment ever wipes secrets, replace it with a GitHub Actions workflow using `cloudflare/wrangler-action` and a scoped Cloudflare API token.
- If strict SSL-expiry monitoring is needed outside Site24x7, add a trusted certificate-monitor binding/provider; Workers `fetch` validates TLS but does not expose peer-certificate expiry, so the production Worker intentionally does not invent a date from certificate-transparency data.
- After extended TV testing, decide whether eight simultaneous HLS feeds are acceptable on the Apple TV/signage browser; if not, cycle four feeds at a time or cap HLS resolution.
- Add deploy/change feed from the preferred release system.
- Add vendor-specific fallback for dashboards that block iframe embedding.
- Add admin settings for thresholds and panel visibility.
- Add a second layout for true multi-screen command walls.
