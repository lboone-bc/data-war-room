# Agent Notes

## Project Intent

This repo owns a private cinematic monitoring room wallboard for a single landscape TV. The first screen should be the working wallboard experience, not a marketing page. Keep the interface operational, dense, dark, readable from across the room, and free of visible organization branding.

## Implementation Conventions

- Prefer configuration-driven panels and server-side data fetching.
- Keep `/wallboard` suitable for unattended Apple TV signage/browser use.
- Preserve graceful degradation: missing credentials, blocked embeds, or API failures should show setup/degraded states rather than crash.
- GA traffic sources should use a standard GA report such as today's `sessionDefaultChannelGroup`; GA realtime rejects source/medium dimensions.
- The world access map uses GA realtime `countryId` plus `country`; add coordinates to `COUNTRY_COORDINATES` in `lib/analytics.ts` for new countries that need precise placement.
- Iframe dashboards are fragile. Check vendor support for kiosk/embed URLs before assuming a normal logged-in page can render inside the wallboard.
- The Site24x7 embed is scaled through `DATABASE_FRAME_VIEWPORT_WIDTH` and `DATABASE_FRAME_VIEWPORT_HEIGHT`; use the current `1024x640` default unless visual QA shows clipping.
- The `DatabaseFrame` iframe's auto-scale calculation (`updateScale` in `app/wallboard/page.tsx`) must subtract the rendered height of every flex sibling below it (`.database-frame-summary`, `.system-log`) before computing scale, or the iframe overlaps/clips them. If a new element is added to that column, add its ref to the reservation math too.
- Site24x7 public dashboard dark theme is configured in Site24x7 share settings, not by styling the iframe from this app.
- Do not embed YallBot/YouTube directly. Its ambient "emergency operations center" feel is realized natively instead, via the `SystemLog` component (real alerts + Hacker News + Fox News headlines + heartbeat lines) in `app/wallboard/page.tsx` and `lib/newsFeed.ts` — treat that as the actual implementation of the style inspiration, not a placeholder for a future embed. `SystemLog` renders as a horizontally scrolling ticker (`.ticker-track`/`.ticker-entry` in `app/globals.css`), not a stacked list — the underlying `useSystemLog` hook logic (entry state, dedup, ambient rotation) is unchanged, only the render/CSS layer is a marquee. Scroll speed is held roughly constant regardless of content length by measuring `scrollWidth` and deriving `animationDuration` from a fixed px/sec constant (`TICKER_PX_PER_SECOND`), not a fixed duration.
- Fox News headlines come from a public RSS feed (`FOX_NEWS_RSS_URL`, no API key) parsed with `fast-xml-parser` in `getFoxHeadlines()` (`lib/newsFeed.ts`), following the exact same caching/timeout/silent-fallback discipline as the Hacker News fetch below. AP News was considered but has no free public feed (only a paid API), so it was not integrated. `app/api/wallboard/route.ts` fetches both sources in the same `Promise.all` and interleaves them into `payload.newsHeadlines` — a Fox outage can't block Hacker News or the rest of the payload since each source caches/fails independently.
- The "serious" alarm (`database-monitors-down` only — i.e. the Site24x7 All Monitors feed reporting a down monitor) plays a distinct square-wave siren tone (`playAlarmPulse`, `app/wallboard/page.tsx`) on a fixed 12s repeat with no cooldown gate, separate from the normal `playTone`/180s-cooldown path used by every other critical alert (website health, SSL, traffic zero/spike/drop). It stops automatically once `database-monitors-down` drops out of `payload.alerts` — there is no acknowledge/silence control, and it still requires the same `arm audio` gesture as the rest of the audio system.
- **Any new external API call (GA, Hacker News, or future additions) must follow the caching discipline in `lib/analytics.ts` / `lib/newsFeed.ts`: a generous TTL cache, in-flight-promise de-duplication so concurrent requests share one outstanding fetch, and a silent fallback to the last-good/empty result on failure — never throw, never surface a raw provider error to the UI.** This was learned the hard way: an early version polled GA Realtime aggressively enough to burn ~14,000 tokens in a single clock-hour and exhaust the quota. GA's Realtime token quota resets on the clock hour, not a rolling window from the failure — any quota-style backoff should target the next hour boundary, not a fixed duration.
- Panels with a fixed-height budget that can shrink (e.g. via a parent grid's `fr` sizing) should gracefully hide non-essential sub-content rather than render an unreadably squeezed sliver — see `.hero-panel`'s `@container` query in `app/globals.css`, which hides the trend sparkline below 275px of panel height instead of showing ~2px bars. Prefer this pattern (CSS container queries scoped to the panel, not viewport media queries) for any future panel content that depends on space freed up by other layout changes.

## Frontend Direction

- Use high-contrast cinematic data-center styling: dark base, cyan/green signal colors, sharp panel lines, subtle scanline/grid motion.
- Maintain stable 16:9 TV layout first. Desktop and 4K viewports matter more than phone ergonomics.
- Keep text inside panels compact and readable. Avoid feature explanation copy inside the wallboard.
- Use icon buttons where possible and keep controls minimal for kiosk use.

## Testing Expectations

- Run `npm run typecheck` and `npm run build` before handoff.
- **Never run `npm run build` while `npm run dev` is also running against this repo** — both write to `.next` and will corrupt each other, breaking the dev server with `MODULE_NOT_FOUND` errors. Stop `dev` first (or skip `build` and rely on `typecheck` + the dev server's hot-reload) if a dev server is already up.
- **The user typically runs `npm run dev` as their actual local site, not as disposable test infrastructure.** Don't stop a dev server you didn't start yourself without asking, and leave `npm run dev` running when you finish a change rather than tearing it down.
- Visually inspect `/wallboard` at `1920x1080`; inspect `3840x2160` when practical.
- Test both demo mode and configured env mode when credentials are available.
- For audio, verify the visual alert still works when browser autoplay blocks sound.
- When touching `lib/analytics.ts` or `lib/newsFeed.ts` (or adding a new external call), spot-check that request volume is reasonable — for GA, check the Account data API quota history page in Google Analytics admin.
