# Dynatrace Entity Manager

Local SvelteKit (Svelte 5 runes, TS) app for browsing/tagging Dynatrace entities. SSR is disabled (`+layout.ts`); the only server code is the proxy route.

## Non-obvious decisions

- **Proxy**: Dynatrace API v2 sends no CORS headers, so all calls go through `src/routes/api/dt/[...path]/+server.ts`. Connection config travels per-request in `x-dt-base-url` / `x-dt-token` headers from localStorage (`dtem:connection`) — there is no server-side config.
- **Cache**: every API read is cache-first via `src/lib/cache.ts` (localStorage, keys `dtem:cache:*`, TTL per call site, quota-eviction of oldest entries). Tag writes patch all cached entity lists in place (`updateCachedByPrefix`) instead of refetching. Changing the environment URL invalidates the whole cache (`connection.save`).
- **Management zone filter** uses `mzName(...)` in the entity selector, with names sourced from Settings 2.0 schema `builtin:management-zones` — the config v1 MZ endpoint is not guaranteed on newer tenants.
- **Detection settings** schemas per entity type live in `DETECTION_SCHEMAS` (`src/lib/api/dynatrace.ts`); entity scope is queried first, then `environment` scope as "inherited" fallback. Each schema is queried separately because invalid scope/schema combos can 400.
- "Processes" tab = `PROCESS_GROUP` entities (user decision; that's where tags/settings live).
- Quick-filter is client-side only; the FilterBar (Apply) is what triggers API calls.
- No test framework set up; verify with `npm run check` and a real tenant.
