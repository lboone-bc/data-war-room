# Reference Index

## Product

- Name: Data Monitoring Room
- Purpose: Private emergency-monitoring-room style wallboard for the database administrators office TV.
- Primary route: `/wallboard`
- Display target: single 16:9 landscape screen through Apple TV signage/browser software.
- Brand posture: no visible organization branding.

## External Systems

- Google Analytics Realtime Data API
  - Config: `GA_PROPERTY_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GA_CLIENT_EMAIL`, or `GA_PRIVATE_KEY`
  - Used for active users, event count, minute trend, and world-map geo activity via `countryId` and `country`.
  - Realtime also supports `city`; the wallboard uses city-level dots only for cities present in the coordinate table and otherwise falls back to a country-level anchor.
  - Top Pages and Sources both use today's standard GA report (not Realtime) — page/source popularity doesn't need to-the-second freshness, and it keeps load off the much smaller Realtime quota.
  - Implementation: `lib/analytics.ts`. Responses are cached for 3 minutes with in-flight-promise de-duplication (concurrent requests share one fetch instead of each hitting GA). Quota exhaustion blanks analytics panels, shows a concise degraded banner/footer message, and does not create a visual/audible alert pop-up. The backoff after a quota error targets the next clock-hour boundary rather than a fixed duration, since GA's Realtime property-token quota resets on the hour, not on a rolling window from the failed request — confirmed directly from the GA account's Data API quota history log (Admin → Account data API quota history) during a 2026-07-02 incident where an early polling configuration burned ~14,000 Realtime tokens in a single hour.
- Apify (Instagram + Facebook latest post)
  - Config: `APIFY_TOKEN`, `APIFY_INSTAGRAM_PROFILE_URL`, `APIFY_FACEBOOK_PAGE_URL`
  - Used only for the ambient "system log" ticker (`app/wallboard/page.tsx`'s `SystemLog`/`useSystemLog`), which spans the full width of the wallboard below the panel grid and rotates the church's latest Instagram/Facebook post alongside internal heartbeat lines every 2-5 minutes; a brand-new post also surfaces immediately as a distinct "New post" line. Purely decorative/ambient in the sense that it never generates an audible alert or blocks rendering, and silently falls back to heartbeat-only lines on failure.
  - Neither platform has a free public feed (confirmed by direct testing: Facebook returns a flat error page and Instagram an empty JS shell to anonymous requests), so this runs through Apify's `apify~instagram-post-scraper` and `apify~facebook-posts-scraper` actors via the `run-sync-get-dataset-items` API — Apify does the actual scraping on its own infrastructure/ToS relationship with those platforms, this app never scrapes them directly.
  - Implementation: `lib/apify.ts`, cached 15 minutes per platform with the same in-flight-dedup/silent-fallback pattern as the GA client — each call is real billed Apify compute, so this cache protects cost, not just freshness.
- Existing active database dashboard
  - Config: `DATABASE_DASHBOARD_URL`
  - Rendered as a scaled iframe and refreshed on `DATABASE_REFRESH_SECONDS`.
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
- DriveNC traffic cameras
  - Config: none; camera list is in `lib/trafficCameras.ts`.
  - Camera IDs/URLs: `4210`, `5269`, `4208`, `4839` at `https://www.drivenc.gov/map/Cctv/<id>`.
  - These DriveNC URLs return raw JPEG images with `Cache-Control: max-age=60`, not iframe map pages. The app proxies them through `/api/traffic-camera/[id]` for a 60-second cache, in-flight de-duplication, and last-good fallback; the client refreshes each tile every 60 seconds and shows a degraded overlay on image failure.

## Security And Access

- Private display access is controlled by `WALLBOARD_ACCESS_TOKEN`.
- Open Apple TV signage to `/wallboard?token=...` on the production host.
- Use dedicated least-privilege viewer credentials for any authenticated embed.

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
