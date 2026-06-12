# Dynatrace Entity Manager

SvelteKit app (Svelte 5 runes, TS, SSR off). A local hook blocks direct pushes to main — always branch + PR. No tests; verify with `npm run check` and a real tenant.

## Non-obvious decisions

- **Proxy**: Dynatrace API v2 sends no CORS headers, so all calls go through `src/routes/api/dt/[...path]/+server.ts`; credentials travel per-request in `x-dt-base-url`/`x-dt-token` headers from localStorage.
- **Cache**: API reads are cache-first (`src/lib/cache.ts`, localStorage `dtem:cache:*`). Tag writes patch cached lists in place; changing the env URL invalidates everything. List keys are prefixed `entities:v3:` — bump when the response shape changes.
- **MZ filter** names come from schema `builtin:management-zones`; the config v1 MZ endpoint isn't guaranteed on newer tenants.
- **Detection settings** (`DETECTION_SCHEMAS`): each schema is queried separately because invalid scope/schema combos can 400.
- Row extras (detection badge/summary, problems, req/min) are batched per page in `loadEnrichments`; `problems.read`/`metrics.read` scopes are optional — per-source failures land in `enrichErrors` and cells degrade to "—".
- "Processes" tab = `PROCESS_GROUP` (user decision).
- Theming: colors are `light-dark()` tokens in `app.css` only; never hardcode colors in components (exception: toasts).
- Node pinned to 24 LTS and `@napi-rs/wasm-runtime` to 1.1.4 (`overrides`): 1.1.5 + Node 25 broke rolldown's wasm fallback. Drop both pins when upstream fixes land.
