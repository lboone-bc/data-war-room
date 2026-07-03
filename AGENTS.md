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
- Site24x7 public dashboard dark theme is configured in Site24x7 share settings, not by styling the iframe from this app.
- Do not embed YallBot/YouTube in v1. Treat it as style inspiration only.

## Frontend Direction

- Use high-contrast cinematic data-center styling: dark base, cyan/green signal colors, sharp panel lines, subtle scanline/grid motion.
- Maintain stable 16:9 TV layout first. Desktop and 4K viewports matter more than phone ergonomics.
- Keep text inside panels compact and readable. Avoid feature explanation copy inside the wallboard.
- Use icon buttons where possible and keep controls minimal for kiosk use.

## Testing Expectations

- Run `npm run typecheck` and `npm run build` before handoff.
- Visually inspect `/wallboard` at `1920x1080`; inspect `3840x2160` when practical.
- Test both demo mode and configured env mode when credentials are available.
- For audio, verify the visual alert still works when browser autoplay blocks sound.
