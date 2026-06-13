# Dynatrace Entity Manager

SvelteKit app (Svelte 5 runes, TS, SSR off). A hook blocks pushes to main — branch + PR. No tests; verify via `npm run check` + a real tenant.

## Non-obvious decisions

- **Proxy**: Dynatrace API v2 sends no CORS headers, so all calls go through `src/routes/api/dt/[...path]/+server.ts`; credentials travel per-request in `x-dt-base-url`/`x-dt-token` headers from localStorage.
- **Cache**: API reads are cache-first (`src/lib/cache.ts`, localStorage `dtem:cache:*`). Tag writes patch cached lists in place; changing the env URL invalidates everything. List key prefix `entities:v3:` — bump on shape changes.
- **MZ filter** names come from schema `builtin:management-zones`; config v1 MZs aren't guaranteed on new tenants.
- **Detection settings** (`DETECTION_SCHEMAS`): each schema is queried separately because invalid scope/schema combos can 400. Key requests (`builtin:settings.subscriptions.service`) ride the same batched list call but are kept out of `DETECTION_SCHEMAS` so they don't flag the "custom" badge; drawer chips deep-link via a `SERVICE_METHOD` lookup (`isServiceMethodOfService`), matching on exact displayName.
- **Unified list**: no tabs — type toggles fetch each enabled type lazily with its own single-type selector (API allows one `type()` per selector), so per-type cache keys/shapes are unchanged; `entities`/`visible`/`loading` etc. are deriveds over `pages[type]`. Column filters + sort are client-side in the store (`columnFilters`/`sort`, persisted in `dtem:view`; legacy `{type}` shape migrates to `{types:[]}`). `loadAll` loops pages, enriches once at the end; `loadSeq` bump (filters/toggles/Stop) cancels it and stale enrichments.
- Row extras (detection badge/summary, problems, req/min) are batched per page in `loadEnrichmentsFor(type)`; `problems.read`/`metrics.read` scopes are optional; failures land in `enrichErrors`, cells show "—".
- Graph is per-service, direct neighbors only (`getServiceNeighborhood`); exclude-list middlemen bridge only to loaded-list services (topology can't tell which of a shared proxy's callers route to the focus), so the fetch depends on patterns + list and the cache key includes both. Callers read from `toRelationships.calls`. "Test connection" probes every scope; the `entities.write` probe POSTs tags to a nonexistent entity ID (matches nothing).
- "Process groups" toggle = `PROCESS_GROUP` (user choice).
- Theming: colors are `light-dark()` tokens in `app.css` only; never hardcode colors in components (exception: toasts). On ≥2400px screens the body zooms via `--app-zoom` — divide viewport units by it.
- Node pinned to 24 LTS and `@napi-rs/wasm-runtime` to 1.1.4 (`overrides`): 1.1.5 + Node 25 broke rolldown's wasm fallback. Drop both pins when upstream fixes land.
