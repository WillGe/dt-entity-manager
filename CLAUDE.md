# Dynatrace Entity Manager

Local SvelteKit (Svelte 5 runes, TS) app for browsing/tagging Dynatrace entities. SSR is disabled (`+layout.ts`); the only server code is the proxy route. Uses adapter-node (`npm run build && node build`). CI (`.github/workflows/ci.yml`) runs check + build on PRs; direct pushes to main are blocked by a local hook — always branch + PR.

## Non-obvious decisions

- **Proxy**: Dynatrace API v2 sends no CORS headers, so all calls go through `src/routes/api/dt/[...path]/+server.ts`. Connection config travels per-request in `x-dt-base-url` / `x-dt-token` headers from localStorage (`dtem:connection`) — there is no server-side config.
- **Cache**: every API read is cache-first via `src/lib/cache.ts` (localStorage, keys `dtem:cache:*`, TTL per call site, quota-eviction of oldest entries). Tag writes patch all cached entity lists in place (`updateCachedByPrefix`) instead of refetching. Changing the environment URL invalidates the whole cache (`connection.save`).
- **Management zone filter** uses `mzName(...)` in the entity selector, with names sourced from Settings 2.0 schema `builtin:management-zones` — the config v1 MZ endpoint is not guaranteed on newer tenants.
- **Detection settings** schemas per entity type live in `DETECTION_SCHEMAS` (`src/lib/api/dynatrace.ts`); entity scope is queried first, then `environment` scope as "inherited" fallback. Each schema is queried separately because invalid scope/schema combos can 400.
- "Processes" tab = `PROCESS_GROUP` entities (user decision; that's where tags/settings live).
- Quick-filter is client-side only; the FilterBar (Apply) is what triggers API calls.
- Lists fetch one extra property per type for the Type column (`TYPE_DETAIL_FIELD`); list cache keys are prefixed `entities:v2:` (bump on response-shape changes). The service-type filter goes into the selector (`serviceType(...)`), SERVICE tab only.
- Theming: all colors are CSS `light-dark()` tokens in `app.css`; the theme store only sets `data-theme` on `<html>` (auto/dark/light). Don't hardcode colors in components (toasts are the deliberate exception).
- Tab + filters persist in localStorage key `dtem:view`; `dtFetch` auto-retries 429 once.
- No test framework set up; verify with `npm run check` and a real tenant.
- Node is pinned to 24 LTS (`.nvmrc`, `engines` excludes 25): rolldown's wasm fallback broke under Node 25. `@napi-rs/wasm-runtime` is pinned to 1.1.4 via `overrides` (1.1.5, published 2026-06-10, regressed) — try removing both pins when upstream fixes land.
