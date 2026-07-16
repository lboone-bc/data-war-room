# Reference Index

## Product

- Name: Data War Room
- Purpose: Private emergency-monitoring-room style wallboard for the database administrators office TV.
- Primary route: `/wallboard`
- Static artifact: `public/index.html` is the Cloudflare-hosted wallboard. `wrangler.jsonc` serves `./public` through `cloudflare/worker.js`, which proxies `/api/*` to the secret-bearing Next.js service configured by `WALLBOARD_API_ORIGIN`.
- Production display URL: `https://data-war-room.lboone.workers.dev/`. Git auto-deploy from `lboone-bc/data-war-room` was successfully restored and validated 2026-07-16. The static wallboard is operational; live telemetry remains pending until `WALLBOARD_API_ORIGIN` is configured with the Node backend's HTTPS origin.
- Display target: single 16:9 landscape screen through Apple TV signage/browser software.
- Brand posture: no visible organization branding.
- Header: visible title is "War Room"; `.header-stats` carries the old footer telemetry; `Rock Update!` countdown ends at `2026-07-27T00:00:00-04:00`.
- Static security model: `public/index.html` contains no provider credentials. It fetches `/api/wallboard` same-origin; the Cloudflare Worker validates `WALLBOARD_ACCESS_TOKEN`, proxies to the backend, and can inject the same token upstream. `?api=...` and `WALLBOARD_ALLOWED_ORIGIN` remain available for direct cross-origin testing, while `wallboard.example.json` remains the sanitized schema reference. Embedding raw provider credentials in browser code remains explicitly prohibited.

## External Systems

- Google Analytics Realtime Data API
  - Config: `GA_PROPERTY_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GA_CLIENT_EMAIL`, or `GA_PRIVATE_KEY`
  - Used for active users, event count, and world-map geo activity via `countryId` and `country`; the API payload still includes minute-trend data, but Website Pulse currently displays only active users and events.
  - Realtime also supports `city`; the wallboard uses city-level dots only for cities present in the coordinate table and otherwise falls back to a country-level anchor.
  - Top Pages and Sources both use today's standard GA report (not Realtime) — page/source popularity doesn't need to-the-second freshness, and it keeps load off the much smaller Realtime quota.
  - Implementation: `lib/analytics.ts`. Summary + geo are the only Realtime reports and share a 5-minute cache/in-flight promise; the old `minutesAgo` report was replaced by an in-process history of cached summary samples. Top Pages/Sources are standard reports on a separate 15-minute cache, and `analytics.fetchedAt`/`cacheSeconds` describe that rankings cache. The GA client is reused. Failures retain last-good data; quota backoff targets the next clock-hour boundary. This lowers steady-state volume from 100 report calls/hour (five every three minutes) to at most 32/hour (24 Realtime + 8 standard).
- Apify (Instagram + Facebook latest post)
  - Config: `APIFY_TOKEN`, `APIFY_INSTAGRAM_PROFILE_URL`, `APIFY_FACEBOOK_PAGE_URL`
  - Used only for the ambient "system log" ticker (`app/wallboard/page.tsx`'s `SystemLog`/`useSystemLog`), which spans the full width of the wallboard below the panel grid and rotates the church's latest Instagram/Facebook post alongside internal heartbeat lines every 2-5 minutes. A post only surfaces as a distinct "New post" ticker line plus `.social-post-popup` overlay when its `postedAt` timestamp is within the last 5 minutes. Purely decorative/ambient in the sense that it never generates an audible alert or blocks rendering, and silently falls back to heartbeat-only lines on failure.
  - Neither platform has a free public feed (confirmed by direct testing: Facebook returns a flat error page and Instagram an empty JS shell to anonymous requests), so this runs through Apify's `apify~instagram-post-scraper` and `apify~facebook-posts-scraper` actors via the `run-sync-get-dataset-items` API — Apify does the actual scraping on its own infrastructure/ToS relationship with those platforms, this app never scrapes them directly.
  - Implementation: `lib/apify.ts`, cached 15 minutes per platform with in-flight de-duplication. Failed, empty, non-2xx, or timed-out actor runs retain last-good content and back off for one hour so every 30-second wallboard poll cannot trigger another billed run.
- Existing active database dashboard
  - Config: `DATABASE_DASHBOARD_URL`
  - Rendered as a scaled iframe and refreshed on `DATABASE_REFRESH_SECONDS`.
  - The panel does not render refresh/last-updated toolbar text; that space belongs to the iframe.
  - Zoom/viewport config: `DATABASE_FRAME_VIEWPORT_WIDTH`, `DATABASE_FRAME_VIEWPORT_HEIGHT`; default is `1024x640`.
  - Visual controls: `DATABASE_FRAME_DARK_MODE` applies an iframe filter and `DATABASE_FRAME_CROP_BOTTOM` crops unused lower space.
  - Dark theme must be enabled in the Site24x7 public dashboard share settings when available.
- Database monitor status endpoint
  - Config: `DATABASE_MONITORS_STATUS_URL`
  - Used for the prominent All Monitors count and critical alert when any system is down. Missing config stays quiet instead of raising a setup alert.
- Website health and SSL checks
  - Config: `WEBSITE_HEALTHCHECK_ENABLED`, `WEBSITE_HEALTHCHECK_URL`, `WEBSITE_HOSTNAME`
  - Website health checks are passive by default; enable explicitly before sending synthetic `HEAD` requests to the public website.
- YouTube live status (Live Stream panel)
  - Config: `YOUTUBE_LIVE_CHANNEL_HANDLE`, `YOUTUBE_FALLBACK_CHANNEL_HANDLE` (defaults to `@livenowfox`)
  - No API key required — `lib/youtubeLive.ts` scrapes the channel's `/<handle>/live` page canonical link to detect an active broadcast, cached 45 seconds with the same silent-fallback discipline as every other external call. When the primary channel is live, shows a muted autoplaying embed with a "LIVE" badge; when it isn't, falls back to the fallback channel (clearly badged as such) if that one is live; otherwise a quiet "Not currently live" state. Missing `YOUTUBE_LIVE_CHANNEL_HANDLE` means the panel doesn't render at all rather than showing a setup warning.
- National Weather Service API (Arden Weather panel)
  - Config: none.
  - Uses the no-key NWS point endpoint for Arden, NC (`35.4665,-82.5165`) to discover the forecast and nearest observation station, then shows current conditions plus three daytime forecast cards in the right-side local-ops column.
  - Implementation: `lib/weather.ts`, cached 10 minutes with in-flight-promise de-duplication and silent last-good/empty fallback. A partial or failed NWS response degrades the panel instead of raising a wallboard alert.
- Traffic cameras
  - Config: `DRIVENC_API_KEY`; numeric camera ID/label/priority list is in `lib/trafficCameras.ts`.
  - IDs: `4208`, `4839`, `6120`, `5269`, `4210`, `4868`, `4876`, `4221` (I-26/US-25 corridor). DriveNC metadata is cached 90 seconds with in-flight de-duplication, a failed-attempt cache, and last-good fallback.
  - `Views[0].VideoUrl` supplies public HLS streams. The browser plays native HLS on Safari and `hls.js` elsewhere; playback must reach `playing` within 18 seconds or that tile falls back to a scaled `https://www.drivenc.gov/map/Cctv/<id>` viewer iframe. The old JPEG proxy route and IPCamLive feeds are gone.
  - Layout remains an unlabeled `2 x 4` grid in `.ops-column`; labels are accessibility text, status dots show live/fallback state, and camera `4208` receives the amber priority frame.

## Security And Access

- Private display access is controlled by `WALLBOARD_ACCESS_TOKEN`. It is opt-in by design (unset means no auth gate) — publishing this app on the public internet requires setting it deliberately; there is no code-level enforcement.
- Cross-origin access to `/api/wallboard` is still controlled by `WALLBOARD_ALLOWED_ORIGIN`, but the normal Cloudflare Worker proxy is same-origin and does not need it.
- Open Apple TV signage to the Cloudflare display root `/?token=...`; `/wallboard?token=...` remains the React/backend surface for local or diagnostic use.
- Use dedicated least-privilege viewer credentials for any authenticated embed.
- `.env.example` at repo root documents every config var with placeholder values only — copy it to `.env.local` for local dev, or mirror the names into the hosting platform's environment variable dashboard for production. Real secrets never belong in a committed file.
- Public hosting target: Cloudflare Worker with static assets, connected to the GitHub repo. `WALLBOARD_API_ORIGIN` points at the Next.js/Railway API service. `WALLBOARD_ACCESS_TOKEN` must exist as the same secret on both layers; all provider secrets stay on the backend. Verify the Worker secret after Git deployments because Cloudflare's dashboard integration has wiped secrets in the companion project.

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
- After extended TV testing, decide whether eight simultaneous HLS feeds are acceptable on the Apple TV/signage browser; if not, cycle four feeds at a time or cap HLS resolution.
- Add deploy/change feed from the preferred release system.
- Add vendor-specific fallback for dashboards that block iframe embedding.
- Add admin settings for thresholds and panel visibility.
- Add a second layout for true multi-screen command walls.
