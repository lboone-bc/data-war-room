# Reference Index

## Product

- Name: Data War Room
- Purpose: Private emergency-monitoring-room style wallboard for the database administrators office TV.
- Primary route: `/wallboard`
- Static artifact: `public/index.html` is a self-contained static wallboard, served by Next.js at `/index.html` on whatever host runs this app (deployment target: Railway).
- Display target: single 16:9 landscape screen through Apple TV signage/browser software.
- Brand posture: no visible organization branding.
- Header: visible title is "War Room"; `.header-stats` carries the old footer telemetry; `Rock Update!` countdown ends at `2026-07-27T00:00:00-04:00`.
- Static security model: `public/index.html` contains no provider credentials. It defaults to fetching `/api/wallboard` same-origin (the standard single-Railway-deployment case) and supports `?api=...` to point at a different JSON source for less common hosting arrangements. `wallboard.json` is ignored by git; `wallboard.example.json` is the checked-in data-shape reference. For a cross-origin arrangement (a second static mirror on a different domain than the API), the API host would need `WALLBOARD_ALLOWED_ORIGIN` set to that domain or the browser blocks the fetch; unset means same-origin only (no CORS headers added). Embedding raw provider credentials in `index.html` was explicitly evaluated and rejected twice during the 2026-07-09 public-hosting design pass — see `AGENTS.md`.

## External Systems

- Google Analytics Realtime Data API
  - Config: `GA_PROPERTY_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GA_CLIENT_EMAIL`, or `GA_PRIVATE_KEY`
  - Used for active users, event count, and world-map geo activity via `countryId` and `country`; the API payload still includes minute-trend data, but Website Pulse currently displays only active users and events.
  - Realtime also supports `city`; the wallboard uses city-level dots only for cities present in the coordinate table and otherwise falls back to a country-level anchor.
  - Top Pages and Sources both use today's standard GA report (not Realtime) — page/source popularity doesn't need to-the-second freshness, and it keeps load off the much smaller Realtime quota.
  - Implementation: `lib/analytics.ts`. Responses are cached for 3 minutes with in-flight-promise de-duplication (concurrent requests share one fetch instead of each hitting GA). The payload exposes `analytics.fetchedAt` and `analytics.cacheSeconds`, which Traffic Detail displays because Top Pages/Sources can legitimately remain unchanged while the same pages/sources stay ranked highest. Quota exhaustion blanks analytics panels, shows a concise degraded banner/footer message, and does not create a visual/audible alert pop-up. The backoff after a quota error targets the next clock-hour boundary rather than a fixed duration, since GA's Realtime property-token quota resets on the hour, not on a rolling window from the failed request — confirmed directly from the GA account's Data API quota history log (Admin → Account data API quota history) during a 2026-07-02 incident where an early polling configuration burned ~14,000 Realtime tokens in a single hour.
- Apify (Instagram + Facebook latest post)
  - Config: `APIFY_TOKEN`, `APIFY_INSTAGRAM_PROFILE_URL`, `APIFY_FACEBOOK_PAGE_URL`
  - Used only for the ambient "system log" ticker (`app/wallboard/page.tsx`'s `SystemLog`/`useSystemLog`), which spans the full width of the wallboard below the panel grid and rotates the church's latest Instagram/Facebook post alongside internal heartbeat lines every 2-5 minutes. A post only surfaces as a distinct "New post" ticker line plus `.social-post-popup` overlay when its `postedAt` timestamp is within the last 5 minutes. Purely decorative/ambient in the sense that it never generates an audible alert or blocks rendering, and silently falls back to heartbeat-only lines on failure.
  - Neither platform has a free public feed (confirmed by direct testing: Facebook returns a flat error page and Instagram an empty JS shell to anonymous requests), so this runs through Apify's `apify~instagram-post-scraper` and `apify~facebook-posts-scraper` actors via the `run-sync-get-dataset-items` API — Apify does the actual scraping on its own infrastructure/ToS relationship with those platforms, this app never scrapes them directly.
  - Implementation: `lib/apify.ts`, cached 15 minutes per platform with the same in-flight-dedup/silent-fallback pattern as the GA client — each call is real billed Apify compute, so this cache protects cost, not just freshness.
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
  - Config: none; camera list is in `lib/trafficCameras.ts`.
  - Camera IDs/URLs: DriveNC `4210`, `5269`, `4208`, `4839`, `4224`, and `4221` at `https://www.drivenc.gov/map/Cctv/<id>`, plus IPCamLive snapshot feeds `ipcamlive-3bwa7esgv64g9mu5x` and `ipcamlive-1cvoiombj6sxjywzv`.
  - These are fetched as image snapshots, not iframe camera/map pages. The app proxies them through `/api/traffic-camera/[id]` for a 60-second cache, in-flight de-duplication, and last-good fallback; the client refreshes each tile every 60 seconds and shows a degraded overlay on image failure.
  - The wallboard API payload only ever exposes an absolute proxy URL for each camera (`${request origin}/api/traffic-camera/<id>`, built in `app/api/wallboard/route.ts`), never the raw upstream DriveNC/IPCamLive URL — correct for the same-origin Railway deployment and also for the less common case of a static `index.html` mirror hosted on a different domain than the API.
  - Layout: the ops column now shows weather plus an unlabeled eight-tile `2 x 4` camera grid. Traffic Detail moved to the former Website Pulse area in the top-left row. Camera labels remain in payload/alt text but are not rendered over the images.

## Security And Access

- Private display access is controlled by `WALLBOARD_ACCESS_TOKEN`. It is opt-in by design (unset means no auth gate) — publishing this app on the public internet requires setting it deliberately; there is no code-level enforcement.
- Cross-origin access to `/api/wallboard` (only needed if a static mirror of `index.html` is ever hosted on a different domain than the API) is controlled by `WALLBOARD_ALLOWED_ORIGIN` (`lib/config.ts`), a comma-separated origin allowlist. Unset means same-origin only — the standard Railway single-deployment setup doesn't need it.
- Open Apple TV signage to `/wallboard?token=...` on the production host.
- Use dedicated least-privilege viewer credentials for any authenticated embed.
- `.env.example` at repo root documents every config var with placeholder values only — copy it to `.env.local` for local dev, or mirror the names into the hosting platform's environment variable dashboard for production. Real secrets never belong in a committed file.
- Public hosting target: Railway (railway.com), one deployment serving `public/index.html`, `/wallboard`, and `/api/*` together on one domain. `railway.json` and `package.json`'s `engines.node`/`.nvmrc` pin the build; secrets are set in Railway's Variables tab. See README's "Publishing on the Internet" section.

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

- Add deploy/change feed from the preferred release system.
- Add vendor-specific fallback for dashboards that block iframe embedding.
- Add admin settings for thresholds and panel visibility.
- Add a second layout for true multi-screen command walls.
