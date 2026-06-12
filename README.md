# Dynatrace Entity Manager

Small local web app for working with the Dynatrace Environment API v2:

- Browse **services, hosts and process groups** with server-side filters (name, tags, management zone, health state) plus an instant client-side quick filter.
- View per-entity **problem/anomaly-detection settings** (with environment-default fallback when nothing is configured on the entity).
- **Add tags** to a single entity, to a multi-selection, or in **batch via CSV import**.
- **Export** the current list to CSV.
- Everything read from the API is **cached in localStorage** (entity lists & settings: 30 min, management zones: 24 h) so repeat browsing doesn't consume API rate limits. The Refresh button bypasses the cache.

## Setup

```sh
npm install
npm run dev          # development
npm run build && node build   # standalone production server (adapter-node)
```

Open the app, then enter your connection in the dialog:

- **Environment URL** — SaaS: `https://<env-id>.live.dynatrace.com`, Managed: `https://<domain>/e/<env-id>`
- **API token** — classic access token with scopes `entities.read`, `entities.write`, `settings.read`; optionally `problems.read` (open-problems column) and `metrics.read` (service throughput column) — without them those columns show "—"

The token is stored in your browser's localStorage and is only ever sent to the app's own server route, which proxies requests to Dynatrace (the Dynatrace API does not allow direct browser calls). Treat the machine/browser running this app accordingly.

## CSV tag import

Columns: `entityId,tagKey,tagValue` — one tag per row, `tagValue` optional (key-only tag), multiple rows per entity allowed. A template is downloadable from the import dialog. Import is add-only; it never removes tags. Rows are validated and previewed before anything is sent; identical tags are grouped into batched API calls (50 entities per call).

## Notes

- Switching to a different environment URL invalidates the local cache automatically; the connection dialog also shows cache usage and offers a manual "Clear cached data".
- Detection-settings schemas queried per entity type are defined in `src/lib/api/dynatrace.ts` (`DETECTION_SCHEMAS`) — extend the list there if you want more sections.
- Entity names link to the entity in the Dynatrace UI.
- Rate-limit (429) responses are retried once automatically, honoring `Retry-After`.
- The theme follows your OS by default; the header button toggles auto / dark / light.
- The active tab and applied filters persist across reloads.
