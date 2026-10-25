# Tabi — Travel Expenses Tracker

A shared Japan travel ledger with purchases, saved JPY/THB conversion rates, Tokyo dates, a spending dashboard, and a public JSON API. Built from [the execution plan](SYSTEM_DESIGN_AND_EXECUTION_PLAN.md).

**Public shared ledger:** there is deliberately no login or API key. Anyone who can reach the deployment can read and change purchases, purchasers, and rates. Purchaser names identify who paid; they do not implement debt splitting.

## Run locally

Use Node.js 22.12 or newer (tested with Node 24) and npm.

```sh
npm ci
cp -n .dev.vars.example .dev.vars
# Edit .dev.vars privately and set DATABASE_URL to a Neon development branch URL.
npm run db:migrate -- --environment development
npm run dev
```

Open http://127.0.0.1:5173. The single Vite process runs React and the Cloudflare Worker together. Purchases, Dashboard, and Settings support direct navigation and reload. The API is under `/api/v1`; `/api/v1/health` works without database configuration.

The provided database connection has been stored in the ignored `.dev.vars` on this machine. It is never exposed through `VITE_` variables, client code, or the examples. Do not copy `.dev.vars` into a public repository. Use a separate Neon branch for future development and integration testing.

Start in Settings: enter your **THB per 1 JPY** rate and manage the initial purchasers Me, A, and B. The rate begins unset; the application never invents a live rate. You can also enter an explicit rate on a purchase.

## What is implemented

- Add purchases in JPY or THB, with an immediate estimated counterpart, purchaser, Unicode descriptions, and Now/custom Tokyo time.
- Save an optional GPS/location from coordinates, map links, place text, or the device location button; open each saved location in Google Maps.
- Retain the original input and exact decimal conversions, rounded half up; keep a saved rate per purchase.
- Search and filter by Tokyo date and purchaser, change display currency, and load additional pages.
- Edit with version conflict detection, soft-delete with confirmation, and restore from persistent Trash.
- Create, rename, archive, and reactivate purchasers. Historical purchases retain their purchaser relation.
- Show all-matching totals, daily spending, and purchaser charts with accessible data tables.
- Use creation UUIDs and canonical hashes to make retries safe; retain an unsent form on failure and across reloads.

Currency is a local browser preference. The ledger and exchange-rate default are shared. A new default rate changes future purchases only. Chart totals sum the saved rounded values, rather than converting a total using today's rate. All entry/display/day grouping uses `Asia/Tokyo`, even on a device in Bangkok.

## Commands and checks

| Command                                           | Purpose                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                                     | Local React + Worker development                                               |
| `npm run typecheck`                               | Strict TypeScript checking                                                     |
| `npm run lint`                                    | Source linting                                                                 |
| `npm run format:check`                            | Check source formatting                                                        |
| `npm run format`                                  | Format editable source and documentation                                       |
| `npm test`                                        | Unit tests without database credentials                                        |
| `npm run test:integration`                        | Real PostgreSQL SQL/API tests in isolated PGlite; never reads Neon credentials |
| `npm run test:worker`                             | API routing/handling in Cloudflare's Worker runtime                            |
| `npm run test:e2e`                                | Desktop/mobile browser lifecycle on isolated PostgreSQL                        |
| `npm run build`                                   | Typecheck and production Worker/static assets build                            |
| `npm run preview`                                 | Preview the production build locally                                           |
| `npm run cf:types`                                | Regenerate Worker environment/runtime types                                    |
| `npm run db:generate`                             | Generate a reviewed schema migration with Drizzle Kit                          |
| `npm run db:migrate -- --environment development` | Apply pending migrations explicitly to the configured target                   |
| `DEPLOY_TARGET=production npm run deploy`         | Build and deploy to the named production Worker                                |

Before browser tests, install Chromium once: `npx playwright install chromium`. Browser tests start their own local server, use a fresh embedded PostgreSQL engine, and do not read `.dev.vars`. They exercise the real API and database queries rather than mocked persistence. Worker tests override database configuration and check routing without contacting Neon.

## Database and migrations

The Worker connects to Neon using Drizzle's HTTPS serverless driver. Money fields remain PostgreSQL numeric/string values. Migration tooling explicitly reads server environment variables and `.dev.vars`; it does not use Vite's client environment injection. `DATABASE_MIGRATION_URL` overrides `DATABASE_URL` for a separate schema owner role. Use a restricted runtime role with SELECT/INSERT/UPDATE on the three application tables; migrations belong to a schema owner.

Inspect existing database objects before the initial migration. The migration command refuses untracked existing ledger tables. It applies ordered SQL files transactionally, records a checksum in `ledger_migrations`, detects edited applied files, and skips files already applied. There is no reset or request-time schema creation. Run one migration process at a time. The seed migration uses deterministic IDs and runs only once: renamed initial purchasers are never recreated on requests.

```sh
# Explicitly identify your intended target. The label does not switch credentials:
# the configured server-only connection string selects the database.
npm run db:migrate -- --environment production
```

Schema: singleton settings; purchasers with case-insensitive unique names; versioned purchases with original input, saved exchange rate, derived JPY/THB amounts, soft-delete time, and immutable creation hash. Database constraints verify bounds and conversion formulas. Active purchaser row locks make create/reassignment atomic with archiving. Keyset pagination includes the normalized filter fingerprint; change filters to start a new list.

## External HTTP API

The full contract is in [docs/openapi.yaml](docs/openapi.yaml). Responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "requestId", "fieldErrors"? } }`. Money/rates in responses are decimal **strings**; the `price` input also accepts a JSON integer. Example commands use placeholders and require no browser headers or login:

Create a purchase with only a name and a yen price. The purchaser defaults to **Me**, matched by name without case sensitivity. A saved default exchange rate must be configured (or supply `exchangeRate`).

```json
{ "name": "Lunch", "price": 1500 }
```

An optional purchaser uses their existing name, so `"purchaser": "a"` selects **A**. Numeric or string `price` values must be positive whole yen. Unknown or archived names return `409 PURCHASER_UNAVAILABLE`; they do not create new purchasers.

All other creation fields are optional: `id`, `purchaser` (or `purchaserId`), `description`, `purchasedAt`, and `exchangeRate`. The detailed `originalAmount`/`originalCurrency` input remains supported, including THB; omitted currency defaults to JPY. Supply `price` or `originalAmount`, and `purchaser` or `purchaserId`, without combining each pair. With no UUID, each POST creates a new purchase. For safe retries, generate an optional UUID once and retain it across attempts; the browser already does this.

```sh
BASE_URL='http://127.0.0.1:5173/api/v1'
curl "$BASE_URL/health"
curl "$BASE_URL/purchasers"

curl -X PATCH "$BASE_URL/settings" \
  -H 'Content-Type: application/json' \
  --data '{"defaultThbPerJpy":"0.23","version":1}'

# Minimal purchase: defaults to purchaser Me, JPY, now, and the saved exchange rate.
curl -X POST "$BASE_URL/purchases" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Lunch","price":1500}'

# Purchaser names are case-insensitive.
curl -X POST "$BASE_URL/purchases" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Train ticket","price":1200,"purchaser":"a"}'

# Optional UUID makes this request safe to retry with the same body.
curl -X POST "$BASE_URL/purchases" \
  -H 'Content-Type: application/json' \
  --data '{"id":"4903709b-cea6-4cb8-9ff4-6362805444db","name":"Lunch at ramen shop","price":1500,"purchaser":"Me","description":"Ramen and tea","purchasedAt":"2026-10-25T14:30:00+09:00","exchangeRate":"0.23"}'

curl "$BASE_URL/purchases?from=2026-10-01&to=2026-10-31&limit=50"
curl "$BASE_URL/summary?from=2026-10-01&to=2026-10-31"
curl -X PATCH "$BASE_URL/purchases/4903709b-cea6-4cb8-9ff4-6362805444db" \
  -H 'Content-Type: application/json' --data '{"name":"Ramen and tea","version":1}'
curl -X DELETE "$BASE_URL/purchases/4903709b-cea6-4cb8-9ff4-6362805444db?version=2"
curl "$BASE_URL/purchases?status=deleted"
curl -X POST "$BASE_URL/purchases/4903709b-cea6-4cb8-9ff4-6362805444db/restore" \
  -H 'Content-Type: application/json' --data '{"version":3}'
```

Omitting `purchasedAt` on create uses insertion time; custom timestamps require Z or an explicit offset. Omit `exchangeRate` to resolve the current default once. A missing default produces `409 RATE_NOT_CONFIGURED`. Unknown fields and null replacements are rejected. A matching creation retry returns the current purchase with 200; changed input under that ID conflicts. Replaying a deleted creation never restores it.

PATCH/DELETE/restore and settings/purchaser writes require the last-read version. On `409 VERSION_CONFLICT`, fetch the resource and review before resubmitting. Do not blindly retry mutations. Summary filters match list filters but span all matching active rows, irrespective of pagination. `q` searches literal substrings, including `%` and `_` characters.

Requests are limited to 16 KiB. JSON mutation bodies and same-origin browser requests are required; origin-free scripts work. There is no wildcard CORS. All API responses are `no-store`. No per-client platform rate limit is configured; no 429 guarantee is implied. Logs contain request ID, route template, status, and duration, without submitted descriptions or database errors.

## Purchase locations and GPS

Both the web form and API accept an optional location. In the form, paste a location or choose **Use current location**. GPS is requested only when you press that button; the browser may ask permission. The existing draft and location remain available if GPS or saving fails. Device GPS needs a secure browser connection (HTTPS, or localhost during development); pasting works without GPS permission. The button first accepts a location fix up to one minute old with a 20-second timeout, then automatically retries for up to 30 seconds with higher accuracy if the provider times out or is unavailable. The pending request can be canceled, and a returned accuracy estimate is shown before saving. If both attempts fail, check device Location Services, site permission, Wi-Fi, and connectivity; the app cannot generate a location when the device provider is unavailable.

```json
{
  "name": "Lunch",
  "price": 1500,
  "location": { "latitude": 35.6762, "longitude": 139.6503 }
}
```

Common input forms:

| Format                                       | Example for `location`                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Decimal pair (latitude, longitude)           | `"35.6762, 139.6503"`                                                           |
| Coordinate object                            | `{"latitude":35.6762,"longitude":139.6503}` or `{"lat":35.6762,"lng":139.6503}` |
| GPS object                                   | `{"coords":{"latitude":35.6762,"longitude":139.6503}}`                          |
| Plain coordinate array (latitude, longitude) | `[35.6762,139.6503]`                                                            |
| GeoJSON Point (longitude, latitude)          | `{"type":"Point","coordinates":[139.6503,35.6762]}`                             |
| WKT Point (longitude, latitude)              | `"POINT (139.6503 35.6762)"`                                                    |
| Degrees/minutes/seconds                      | `"35°40'34.32\"N 139°39'1.08\"E"`                                               |
| Geographic URI                               | `"geo:35.6762,139.6503"`                                                        |
| Map link                                     | `"https://www.google.com/maps/search/?api=1&query=35.6762,139.6503"`            |
| Place name or address                        | `"Shinjuku Station, Tokyo"`                                                     |

Google Maps, Apple Maps, and OpenStreetMap links with embedded coordinates are recognized. JSON objects/arrays can also be pasted as text in the web field. Bare coordinate pairs use latitude first; unambiguously reversed pairs are recognized. Use named fields or GeoJSON/WKT when your source uses longitude first. Finite scientific notation is also supported for GPS coordinates. Out-of-range or incomplete coordinates produce a validation error instead of creating a misleading pin.

`gps` is an alternative to `location`. Paired top-level `latitude`/`longitude` (or `lat`/`lng`/`lon`) also work. A text location can be combined with GPS, for example `{"location":"Tokyo Tower","gps":{"lat":35.6586,"lng":139.7454}}`; multiple coordinate sources must agree. The normalized API response contains `location: {text, latitude, longitude, googleMapsUrl}` or `location: null`. Coordinates are numbers, independent of the string-valued money fields. Editing unrelated purchase fields preserves the location; `PATCH` with `{"version":1,"location":null}` clears it. Locations survive deletion and restoration. Search also matches location text.

Saved coordinates open an exact pin using the [official Google Maps URL format](https://developers.google.com/maps/documentation/urls/get-started). Place names/addresses open a Google Maps search, and supported shortened Google map links open the shared map directly. These forms keep coordinates null when the input does not contain them: the application does not invent coordinates or call a geocoding provider. Map links are generated/checked locally; saving never fetches arbitrary pasted URLs. Opening a Maps link sends that location to Google Maps. As with the rest of this public shared ledger, saved locations are visible to anyone who can reach the app.

## Cloudflare deployment

One Cloudflare Worker serves static React assets and Hono API routes. Current configuration follows the [Cloudflare React/Vite tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) and [SPA/API routing guidance](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/). `/api` and `/api/*` run the Worker first so browser API navigation cannot turn into SPA HTML. The Vite plugin generates deployment output paths; use its generated Wrangler configuration rather than a manually copied asset directory.

1. Authenticate Cloudflare: `npx wrangler login`.
2. Check `wrangler.jsonc`'s Worker name/account target.
3. Set the secret interactively: `npx wrangler secret put DATABASE_URL`. Do not put the value in a shell argument, client variable, or tracked file.
4. Inspect the target database and apply reviewed migrations with an explicit `--environment production` label.
5. Run all checks above, then `DEPLOY_TARGET=production npm run deploy`.
6. On the returned deployment URL, verify health, direct `/dashboard` and `/settings` reloads, JSON API 404, rate setup, and a clearly marked purchase create/edit/delete/restore. Remove smoke data through the ordinary Trash workflow.

The compatibility date is pinned in `wrangler.jsonc`; `nodejs_compat` supports the Neon/Drizzle dependency tree. Binding types are generated by Wrangler. Use separate Workers and Neon branches for staging and production, and configure each secret independently. No cloud deployment is performed unless explicitly requested.

## Backup and recovery

Use Neon branch/restore and snapshot capabilities appropriate to your project plan before schema changes. Keep versioned migration files with your source. For portable backups, use PostgreSQL `pg_dump` with a server-only migration connection and store its output securely; rehearse restore into a separate Neon branch before relying on a backup. See [Neon branching](https://neon.com/docs/introduction/branching) and [Neon restore](https://neon.com/docs/introduction/branch-restore).

Restore a mistakenly deleted purchase from Trash; it keeps its original amounts, rate, purchaser, and time. Reactivate an archived purchaser in Settings. Soft deletion is not a full backup, and there is no hard-delete API or automatic trash purge in this MVP.

## Design notes and limits

Following the API simplification request, purchase creation now requires only name and yen price; UUID, currency, and purchaser ID are optional. Named purchasers default to Me and match case-insensitively. Existing detailed requests and their canonical retry hashes remain compatible.

The requested stack is used: TypeScript, React, React Router library mode, Vite/Cloudflare, Hono, Zod, TanStack Query, Tailwind, Recharts, decimal.js, Drizzle, and Neon. Exact installed versions are pinned in `package.json` and `package-lock.json`. Cloudflare's supported `@cloudflare/vitest-plugin` replaces the deprecated `@cloudflare/vitest-pool-workers` named in older examples. Tested overrides pin patched Undici, Zod, and esbuild versions within development tooling; the final dependency audit reports no vulnerabilities.

For repeatable offline tests, PGlite executes PostgreSQL schema/constraints/queries in an isolated engine; the deployed runtime always uses Neon HTTP. These tests cannot establish real multi-connection lock behavior or Neon availability, so inspect locking queries and use a dedicated Neon branch for multi-connection race/load testing. No login, offline synchronization, automatic exchange provider, CSV, budgets, receipts, or settlement feature is added.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the checks actually run and any remaining setup.
