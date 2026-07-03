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
- Hacker News public Firebase API
  - Config: none — no API key required.
  - Used only for the ambient "system log" feed under the Active Database System panel (`app/wallboard/page.tsx`'s `SystemLog`/`useSystemLog`), which rotates in real HN headlines alongside internal heartbeat lines every 2-5 minutes. Purely decorative — never generates an alert, never blocks rendering, and silently falls back to heartbeat-only lines on failure.
  - Implementation: `lib/newsFeed.ts`, cached 15 minutes with the same in-flight-dedup/silent-fallback pattern as the GA client.
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
- The ambient "system log" (Active Database System panel) is a separate, non-audible, non-alerting display of the same `alerts` array plus decorative content — it does not affect audible-alert logic or cooldowns.

## Future Work

- Add deploy/change feed from the preferred release system.
- Add vendor-specific fallback for dashboards that block iframe embedding.
- Add admin settings for thresholds and panel visibility.
- Add a second layout for true multi-screen command walls.
