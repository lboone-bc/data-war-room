# Data Monitoring Room

Private cinematic wallboard for the database administrators office TV. The app is built as a Next.js kiosk display that can be hosted behind a private URL and opened from an Apple TV signage/browser app.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000/wallboard`. Without environment variables, panels show setup or blank states rather than fallback telemetry.

## Configuration

Create `.env.local` for local development. For production, set the same values in the cloud host.

```bash
WALLBOARD_ACCESS_TOKEN=change-me
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
- Google Analytics realtime powers active users, events, minute trend, and the world access map. The map uses realtime `countryId`, `country`, and `city` dimensions. City dots are used only when the city is in the app coordinate table; otherwise the dot falls back to a country-level anchor. Top Pages and Sources both use same-day standard GA reports (not Realtime) since page/source popularity doesn't need to-the-second freshness and the standard Reporting API has a far larger quota than Realtime.
- Google Analytics setup issues or failures show blank/setup states and a warning instead of fallback data. Analytics results are cached for 3 minutes to protect GA API quota, with concurrent requests sharing one in-flight fetch instead of each firing their own. If GA returns a quota exhaustion error, analytics panels stay blank and the wallboard pauses GA calls until the next clock hour (GA's Realtime token quota resets on the hour, not on a rolling timer from the failure) instead of showing raw provider errors or creating an alert pop-up.
- The trend/sparkline chart in Website Pulse hides itself automatically via a CSS container query when its panel doesn't have enough vertical room to render usable bars (this can happen depending on screen height and other panel sizing) — this is intentional graceful degradation, not a bug, and it reappears once the panel has enough room (e.g. on a taller/4K display).
- `DATABASE_MONITORS_STATUS_URL` can point at JSON with `downCount`, `down_count`, `down`, or a `monitors` array with `status` values. If it is not configured, the All Monitors row stays blank/nominal. If it is configured, any down/critical/failed/offline monitor creates a critical alert.
- Website health checks are passive by default and do not send synthetic requests to the public website. Set `WEBSITE_HEALTHCHECK_ENABLED=true` only if you want the wallboard API to send a periodic `HEAD` request to `WEBSITE_HEALTHCHECK_URL`.
- Audible alerts cover critical website traffic anomalies, failed website health, critical SSL state, and database monitor down states. All of these except a database monitor outage share one alert tone, gated to the configured cooldown (180s by default). A database monitor reporting down (the Site24x7 "All Monitors" feed) is treated as the most serious case: it plays a distinctly different siren-style tone that repeats automatically every 12 seconds — no cooldown, no manual dismiss — until the monitor recovers. Both tones require the `arm audio` button to have been pressed this browser session before anything can play (browser autoplay policy).
- A full-width ticker bar below the panel grid (and above the footer) scrolls a passive, ambient operations-log feed horizontally: real alerts appear there immediately (deduplicated, so the same alert isn't repeated), plus an occasional (every 2-5 minutes, randomized) ambient line pulled from the church's latest Instagram or Facebook post, or an internal "heartbeat" status phrase. A brand-new post also surfaces immediately (not waiting for the ambient rotation) as a "New post" ticker line, styled like a watch-level alert so it stands out — this is still ticker-only, though, and never touches the audible-alert system. Posts are fetched server-side via Apify (`lib/apify.ts`, `APIFY_TOKEN`) since neither platform exposes a free public feed (confirmed by direct testing: Facebook returns a flat error page to anonymous requests, Instagram returns an empty JS shell with no post data), and cached 15 minutes per platform — Apify runs cost real money/compute per call, so don't shorten that cache without accounting for cost. If `APIFY_TOKEN` isn't set, the ticker falls back to alerts + heartbeat only, same graceful-degradation convention as everything else. The Active Database System panel no longer shows its own "All Monitors" / "Website Check" / "SSL" summary boxes (removed to give the embedded dashboard more room) — All Monitors down-count is still visible in the Website Pulse mini-metrics.
- A "Live Stream" panel shows the Biltmore Church YouTube channel (`YOUTUBE_LIVE_CHANNEL_HANDLE`) when it's actively broadcasting: a muted, autoplaying embed of the live video with a "LIVE" badge. No YouTube Data API key is required — live/offline detection scrapes the channel's `/live` page canonical link (`lib/youtubeLive.ts`), cached 45 seconds, following the same silent-fallback discipline as the other external calls. When the primary channel isn't live, the panel falls back to a second channel (`YOUTUBE_FALLBACK_CHANNEL_HANDLE`, defaults to LiveNOW from Fox) if that one is live, clearly badged in amber so it never reads as "Biltmore is live." If neither is live, the panel shows a quiet "Not currently live" state with the channel link instead of an empty/broken embed. If `YOUTUBE_LIVE_CHANNEL_HANDLE` isn't set, the panel doesn't render at all rather than showing a setup warning.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
```
