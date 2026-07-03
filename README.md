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
- Google Analytics realtime powers active users, events, top pages, minute trend, and the world access map. The map uses realtime `countryId`, `country`, and `city` dimensions. City dots are used only when the city is in the app coordinate table; otherwise the dot falls back to a country-level anchor. The sources panel uses today's standard GA channel report because GA realtime does not expose source/medium dimensions.
- Google Analytics setup issues or failures show blank/setup states and a warning instead of fallback data. Analytics results are cached briefly to protect GA API quota; if GA returns a quota exhaustion error, analytics panels stay blank and the wallboard pauses GA calls during the cooldown instead of showing raw provider errors or creating an alert pop-up.
- `DATABASE_MONITORS_STATUS_URL` can point at JSON with `downCount`, `down_count`, `down`, or a `monitors` array with `status` values. If it is not configured, the All Monitors row stays blank/nominal. If it is configured, any down/critical/failed/offline monitor creates a critical alert.
- Website health checks are passive by default and do not send synthetic requests to the public website. Set `WEBSITE_HEALTHCHECK_ENABLED=true` only if you want the wallboard API to send a periodic `HEAD` request to `WEBSITE_HEALTHCHECK_URL`.
- Audible alerts cover critical website traffic anomalies, failed website health, critical SSL state, and database monitor down states. Alerts respect the configured cooldown.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
```
