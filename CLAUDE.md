# Dynatrace Entity Manager

SvelteKit app (Svelte 5 runes, TS, SSR off). A hook blocks pushes to main — branch + PR. No tests; verify via `npm run check` + a real tenant.

## Non-obvious decisions

- **Proxy**: Dynatrace API v2 sends no CORS headers, so all calls go through `src/routes/api/dt/[...path]/+server.ts`; credentials travel per-request in `x-dt-base-url`/`x-dt-token` headers from localStorage.
- **Cache**: API reads are cache-first (`src/lib/cache.ts`, localStorage `dtem:cache:*`). Tag writes patch cached lists in place; changing the env URL invalidates everything. List key prefix `entities:v3:` — bump on shape changes.
- **MZ filter** names come from schema `builtin:management-zones`; config v1 MZs aren't guaranteed on new tenants.
- **Detection settings** (`DETECTION_SCHEMAS`): each schema is queried separately because invalid scope/schema combos can 400. Key requests (`builtin:settings.subscriptions.service`) ride the same batched list call but are kept out of `DETECTION_SCHEMAS` so they don't flag the "custom" badge.
- Row extras (detection badge/summary, problems, req/min) are batched per page in `loadEnrichments`; `problems.read`/`metrics.read` scopes are optional; failures land in `enrichErrors`, cells show "—".
- Graph is per-service, direct neighbors only (`getServiceNeighborhood`); just exclude-list middlemen are expanded through (capped), so the fetch depends on the patterns and the graph cache key includes them. Callers read from `toRelationships.calls`. "Test connection" probes every scope; the `entities.write` probe POSTs tags to a nonexistent entity ID (matches nothing).
- "Processes" tab = `PROCESS_GROUP` (user choice).
- Theming: colors are `light-dark()` tokens in `app.css` only; never hardcode colors in components (exception: toasts). On ≥2400px screens the body zooms via `--app-zoom` — divide viewport units by it.
- Node pinned to 24 LTS and `@napi-rs/wasm-runtime` to 1.1.4 (`overrides`): 1.1.5 + Node 25 broke rolldown's wasm fallback. Drop both pins when upstream fixes land.
