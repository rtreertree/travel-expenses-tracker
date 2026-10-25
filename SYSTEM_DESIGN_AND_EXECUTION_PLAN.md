# Travel Expenses Tracker — System Design and Agent Execution Plan

Status: implementation-ready draft · Prepared: 2026-10-25

## 1. Instructions for the implementing agent

Build a mobile-friendly application for recording purchases during travel in Japan, with Japanese yen (JPY) and Thai baht (THB) views. Implement the MVP below, then verify the acceptance criteria. This document is a design and execution handoff; no application, database migrations, or deployment have been performed as part of preparing it. The project directory was empty when inspected.

Use these decisions as defaults. Do not delay implementation for cosmetic choices. Record material deviations and their reasons in the README. Verify current package compatibility, pin resolved versions in the lockfile, and use current official documentation for deployment configuration.

### Required outcomes

- Record purchase name, amount, purchase date/time, description, and purchaser.
- Enter either JPY or THB and immediately see the other currency.
- Use the current time or a custom date/time.
- Customize purchasers, initially `Me`, `A`, and `B`.
- Visualize spending by day and purchaser.
- Provide an HTTP API for adding purchases, usable by the UI and external scripts.
- Use TypeScript, React, Cloudflare hosting, and the user's Neon PostgreSQL database.
- No login, accounts, authentication, or authorization layer.
- Deliver working source code, migrations, tests, setup instructions, and API documentation.

### Deliberate MVP assumptions

| Topic | Decision |
|---|---|
| Data ownership | One shared ledger per deployment; every visitor sees the same data |
| Travel scope | One continuous ledger; use date filters to inspect individual trips |
| UI language | English; accept Unicode names and descriptions, including Thai and Japanese |
| Timezone | `Asia/Tokyo` for purchase entry, display, and daily grouping |
| Exchange rate | User-managed THB per 1 JPY; optional override per purchase |
| Rate initialization | Unset until the user supplies a rate; never invent a live rate |
| Default display currency | THB, with a JPY toggle and both currencies shown on purchase details |
| Purchaser meaning | The person who paid; no debt splitting or reimbursement calculation |
| Connectivity | Online saving; preserve an unsent form on failure, but no offline sync |

Additional MVP conveniences: purchase editing, recoverable deletion, search/filtering, and purchaser archiving. Defer categories, budgets, receipt uploads, automatic FX providers, multiple trips, CSV export/import, PWA installation, and settlements until the MVP passes acceptance. These are optional extensions, not prerequisites.

## 2. Architecture and stack

Use **React + React Router in library mode + Vite** for the client and **Hono** for a TypeScript API. Deploy the static assets and API as a single **Cloudflare Worker with Static Assets**. A Worker satisfies the requirement for Workers **or** Pages; supporting both deployment targets is not required.

Cloudflare documents a React/Vite SPA with a Worker API and a shared deployment workflow. Follow the current template and plugin conventions. [Cloudflare React SPA tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)

```text
Browser / mobile                         External script
    |                                         |
    | static React app + /api/v1 requests      | /api/v1 requests
    v                                         v
Cloudflare Worker deployment, one origin
    |-- Static Assets: HTML / JS / CSS
    |-- Hono API: validation, conversion, business rules
            |
            | Neon serverless driver over HTTPS
            v
        Neon PostgreSQL
        settings / purchasers / purchases
```

| Concern | Choice |
|---|---|
| Language | TypeScript, strict mode, shared API types |
| Client | React, Vite, React Router |
| API | Hono, Web-standard Request/Response |
| Validation | Zod schemas shared between client and server |
| Server data in UI | TanStack Query; invalidate affected queries after writes |
| Styling | Tailwind CSS with accessible native controls or a small component layer |
| Charts | Recharts; include text summaries and tabular equivalents |
| Exact currency calculations | `decimal.js`, shared calculation module |
| Database | Neon PostgreSQL |
| Database access | Drizzle ORM with `drizzle-orm/neon-http` and `@neondatabase/serverless` |
| Migrations | Versioned SQL generated/reviewed with Drizzle Kit; explicit migration command |
| Tests | Vitest, Worker-runtime API tests, Playwright for critical browser flows |

Neon's HTTP driver supports individual queries and non-interactive transactions. Use a single SQL statement or the documented HTTP transaction mechanism for atomic multi-query work. Do not assume interactive ORM transaction callbacks work with `neon-http`. [Neon driver](https://neon.com/docs/serverless/serverless-driver), [Drizzle Neon integration](https://orm.drizzle.team/docs/connect-neon)

Keep database access inside the Worker. The browser must never connect directly to Neon. Use parameterized SQL, including search and filter values. No additional cache, queue, WebSocket server, or Durable Object is needed for this scope.

## 3. Currency and time rules

### 3.1 Amounts and exchange rates

Store the original input as the source of truth plus a per-purchase exchange-rate snapshot and calculated amounts in both currencies.

- `originalCurrency`: `JPY` or `THB`.
- `originalAmount`: positive decimal string, at most `999999999.99`; JPY input must be a whole number, THB input has at most two decimal places.
- `exchangeRate`: decimal string representing **THB for 1 JPY**, greater than zero and at most `100`, with at most eight decimal places. This bound is an application validation limit, not a claim about market rates.
- `amountJpy`: original JPY amount, or original THB amount divided by the rate and rounded to the nearest whole yen.
- `amountThb`: original THB amount, or original JPY amount multiplied by the rate and rounded to two decimals.
- Use decimal arithmetic and round-half-up. Never use binary floating-point arithmetic to calculate or aggregate money.
- Return all money and rate fields as strings in JSON; only convert to numbers at the chart rendering boundary.
- Sum persisted rounded purchase amounts for totals. Never convert an aggregate using the current default rate.
- The server calculates derived amounts; reject client-supplied `amountJpy` or `amountThb` fields.
- `rateSource` is `default` or `manual`. It describes where that purchase's snapshot came from, not a market-data provider.

Example rates below are **test fixtures only**:

| Input | Rate | Stored JPY | Stored THB |
|---|---|---|---|
| JPY `1500` | `0.23000000` | `1500` | `345.00` |
| THB `100.00` | `0.23000000` | `435` | `100.00` |
| JPY `1` | `0.23500000` | `1` | `0.24` |

The second example demonstrates rounding loss: converting its rounded JPY amount back would produce THB `100.05`. Preserve THB `100.00` as the original. A display-currency toggle must never rewrite stored data or repeatedly convert rounded values.

In the form, the last explicitly edited currency amount is authoritative. Switching the input currency can show a rounded preview, but must not change the authoritative input until the user edits that amount. Label the calculated counterpart as an estimate. This allows switching back and forth without silent drift.

On creation, use an explicit rate if provided; otherwise resolve the current default once and persist it. When no default exists and no override was supplied, return `409 RATE_NOT_CONFIGURED`. Changing the default affects future purchases only. Editing a purchase preserves its existing rate unless explicitly changed; any amount/currency/rate change recalculates both derived values. Editing only its name or description never changes money fields.

### 3.2 Dates and time

- Store instants in PostgreSQL `timestamptz`; return ISO 8601 strings in UTC.
- `purchasedAt` is the transaction time; `createdAt` is the server insertion time. Keep them distinct.
- Omitted `purchasedAt` on creation means server time at successful insertion. The UI's “Now” mode omits it instead of freezing the time when the form opened.
- For custom time, interpret the form's wall-clock value in `Asia/Tokyo` and send an explicit offset, for example `2026-10-25T14:30:00+09:00`.
- Reject API timestamps without an explicit offset or `Z`, invalid calendar dates, and null timestamps. Accept valid custom past or future instants.
- Never let the browser's Bangkok or other local timezone silently determine Japan trip dates.
- Date filters are local calendar dates in Tokyo, inclusive for `from` and `to`. Translate them into `[from at 00:00, day after to at 00:00)` instants before querying.
- Daily charts group by `(purchased_at AT TIME ZONE 'Asia/Tokyo')::date`.

## 4. Data model

Use snake_case in PostgreSQL and camelCase in API responses. UUIDs are generated in application code. Unless specified otherwise, fields are NOT NULL. Add database checks as well as API validation.

### `app_settings` — exactly one row

| Column | Type / rule |
|---|---|
| `id` | smallint primary key, CHECK `id = 1` |
| `default_thb_per_jpy` | numeric(12,8), nullable until configured; same bounds as exchangeRate |
| `version` | integer, starts at 1, positive |
| `updated_at` | timestamptz, default now() |

Timezone is a shared application constant for the MVP. Display currency is a browser preference in localStorage, not a shared setting.

### `purchasers`

| Column | Type / rule |
|---|---|
| `id` | uuid primary key |
| `name` | varchar(60), trimmed, nonempty; unique index on lower(name) |
| `archived_at` | timestamptz, nullable |
| `version` | integer, starts at 1, positive |
| `created_at`, `updated_at` | timestamptz, default now() |

Seed `Me`, `A`, and `B` once using deterministic UUIDs and an idempotent seed migration. Never reseed on requests or recreate a renamed seed purchaser. Names are unique across active and archived purchasers. Archiving removes a purchaser from new-entry choices while preserving historical rows. Renaming changes the name displayed on historical purchases. Reactivation is supported. Hard deletion is not exposed.

### `purchases`

| Column | Type / rule |
|---|---|
| `id` | uuid primary key; client-generated creation identifier |
| `name` | varchar(160), trimmed, nonempty |
| `description` | text, default empty string; maximum 4,000 characters |
| `purchaser_id` | uuid FK → purchasers.id, ON DELETE RESTRICT |
| `original_currency` | text, CHECK IN ('JPY', 'THB') |
| `original_amount` | numeric(20,2); input bounds and currency precision checks |
| `thb_per_jpy` | numeric(12,8), positive and at most 100 |
| `rate_source` | text, CHECK IN ('default', 'manual') |
| `amount_jpy` | numeric(20,0), nonnegative |
| `amount_thb` | numeric(20,2), nonnegative |
| `purchased_at` | timestamptz |
| `created_at`, `updated_at` | timestamptz, default now() |
| `deleted_at` | timestamptz, nullable; soft deletion |
| `version` | integer, starts at 1, positive |
| `create_request_hash` | text; SHA-256 of canonical validated creation input; immutable |

Derived amounts can round to zero even when the original input is positive. Do not reject those purchases. The numeric widths accommodate both conversion directions at the specified limits. Add checks that derived amounts equal the prescribed rounding formulas.

Indexes:

- Active purchases: `(purchased_at DESC, id DESC) WHERE deleted_at IS NULL`.
- Active purchaser history: `(purchaser_id, purchased_at DESC, id DESC) WHERE deleted_at IS NULL`.
- Index `deleted_at` for the trash view.
- Simple parameterized ILIKE search is enough initially; introduce a search index only if measured need justifies it.

Each write increments `version` and updates `updated_at` in the same statement. All purchase reads and aggregates exclude deleted rows unless explicitly requesting trash. Build a reusable filter builder to keep list and summary behavior consistent.

## 5. HTTP API contract

Prefix: `/api/v1`. JSON requests and responses, except an empty body on a successful DELETE. No API key is required. Produce `docs/openapi.yaml` implementing this contract and a README example for external callers.

### 5.1 Endpoints

| Method / path | Behavior |
|---|---|
| `GET /health` | Liveness only; `{ "data": { "status": "ok" } }`; no secret or database details |
| `GET /settings` | Singleton settings, version, and timezone constant |
| `PATCH /settings` | Set default rate; body `{ defaultThbPerJpy, version }` |
| `GET /purchasers` | Active purchasers; `includeArchived=true` returns all |
| `POST /purchasers` | Create from `{ name }`, return 201 |
| `PATCH /purchasers/:id` | `{ name?, archived?, version }`; at least one change |
| `GET /purchases` | Filtered and paginated list |
| `GET /purchases/:id` | Purchase detail, including `deletedAt` if soft-deleted |
| `POST /purchases` | Create; body below; 201 new or 200 successful replay |
| `PATCH /purchases/:id` | Partial editable fields plus required `version`; return updated row |
| `DELETE /purchases/:id?version=N` | Soft delete active row; 204 |
| `POST /purchases/:id/restore` | `{ version }`; restore deleted row |
| `GET /summary` | Totals and grouped chart series over all matching active purchases |

All successful resource responses use `{ "data": ... }`. Purchaser list data is an array. A purchase resource includes its stored public fields and `purchaser: { id, name, archived }`; omit `createRequestHash`. The settings response includes `defaultThbPerJpy`, `version`, `updatedAt`, and `timezone: "Asia/Tokyo"`.

### 5.2 Create a purchase

```json
{
  "id": "4903709b-cea6-4cb8-9ff4-6362805444db",
  "name": "Lunch at ramen shop",
  "originalAmount": "1500",
  "originalCurrency": "JPY",
  "purchasedAt": "2026-10-25T14:30:00+09:00",
  "description": "Ramen and tea",
  "purchaserId": "93149f36-6aae-4489-8bb2-1ece7351caaf",
  "exchangeRate": "0.23000000"
}
```

Required: `id`, `name`, `originalAmount`, `originalCurrency`, `purchaserId`. The purchaser ID above is illustrative; callers must use an actual ID from `/purchasers`. Optional: `description` defaults to empty, `purchasedAt` defaults to now, `exchangeRate` defaults to the configured rate. Null is not a substitute for omission. Reject unknown fields and enforce string decimal syntax without exponents, commas, NaN, or Infinity.

Expected money/time fields for the example: `amountJpy: "1500"`, `amountThb: "345.00"`, `exchangeRate: "0.23000000"`, `rateSource: "manual"`, `purchasedAt: "2026-10-25T05:30:00.000Z"`. Include `id`, original fields, purchaser relation, timestamps, `deletedAt: null`, and `version: 1` in the returned resource.

PATCH accepts `name`, `description`, `originalAmount`, `originalCurrency`, `purchasedAt`, `purchaserId`, `exchangeRate`, and required `version`. Omitted fields retain existing values. If changing originalCurrency, require originalAmount as well. No reset-to-current-default shortcut: callers explicitly supply a replacement rate. Require at least one editable field.

### 5.3 Retry safety and concurrent edits

Generate the creation UUID once per new form and keep it across retries. Hash canonical validated request input, including the distinction between omitted time/rate and explicitly supplied values, **before resolving defaults**. Normalize key order, trimmed strings, decimal spellings, and explicit timestamps. The hash remains unchanged after edits.

For an existing creation ID with the same hash, return the current active purchase with 200 without changing it; defaults are not resolved again. If its content was subsequently edited, the returned resource may differ from the original creation response. For a different hash, return `409 IDEMPOTENCY_CONFLICT`. For a matching soft-deleted row, return `409 PURCHASE_DELETED`; replay never restores it.

Use the primary-key constraint and `INSERT ... ON CONFLICT DO NOTHING`, followed by a fresh read on conflict, to resolve concurrent duplicate submissions. A pre-insert existence check alone is insufficient. Only the winning insert determines the default rate and timestamp. Preserve the resolved rate/source consistently within that insert operation.

For PATCH, DELETE, restore, purchaser changes, and settings changes, require a version and use an atomic version predicate. A stale version returns `409 VERSION_CONFLICT`; do not silently overwrite another device's edit. The UI offers reload/review while preserving the unsaved form. Never retry mutations blindly; use the creation ID or reload state after uncertain results.

New purchases and reassignment require an active purchaser. Editing an existing purchase without changing its archived purchaser remains allowed, as does restoring a purchase linked to one. Enforce purchaser active-state checks atomically with insertion/reassignment using a transaction or statement with appropriate row locking; avoid a race between a separate check and an archive.

### 5.4 Listing and filters

`GET /purchases` accepts:

- `from`, `to`: optional `YYYY-MM-DD` dates; validate actual calendar dates and ordering.
- `purchaserId`: optional UUID.
- `q`: optional trimmed text, maximum 100 characters; case-insensitive literal substring match against name and description. Escape SQL LIKE wildcards.
- `status`: `active` (default) or `deleted`.
- `limit`: integer, default 50, range 1–100.
- `cursor`: optional opaque cursor for the `(purchasedAt, id)` descending keyset.

Return `{ "data": [...], "page": { "nextCursor": "... or null" } }`. Fetch limit + 1 to detect another page. Encode the last timestamp/UUID and a normalized filter fingerprint in the cursor; reject malformed cursors or cursors reused with different filters. Changing filters resets pagination. Keyset pagination is not a frozen snapshot under concurrent edits; refresh starts a new list.

### 5.5 Summary and visualization data

`GET /summary` accepts the same `from`, `to`, `purchaserId`, and `q` filters. It does not accept pagination or deleted status. Return:

```json
{
  "data": {
    "timezone": "Asia/Tokyo",
    "count": 1,
    "totals": { "jpy": "1500", "thb": "345.00" },
    "byDay": [
      { "date": "2026-10-25", "count": 1, "jpy": "1500", "thb": "345.00" }
    ],
    "byPurchaser": [
      { "purchaserId": "93149f36-6aae-4489-8bb2-1ece7351caaf", "name": "Me", "count": 1, "jpy": "1500", "thb": "345.00" }
    ]
  }
}
```

Aggregate in PostgreSQL across **all** matching purchases, not the visible list page. Obtain all groups/totals from one consistent statement or read-only repeatable-read transaction. Return only days with purchases, ordered ascending; the chart may insert zero points within a bounded displayed range. By-purchaser rows include archived purchasers with matching purchases. Empty results return count 0, zero-valued totals, and empty arrays.

The dashboard defaults to the current Tokyo calendar month; offer Today, This month, All time, and custom date filters. Changing display currency selects the corresponding persisted totals/series and does not fetch a new FX rate.

### 5.6 Errors and request handling

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the highlighted fields.",
    "fieldErrors": { "originalAmount": ["JPY must be a whole number."] },
    "requestId": "generated-correlation-id"
  }
}
```

Use 400 for malformed JSON, query, cursor, or body; 404 for unknown IDs/routes; 409 for state/version/name/idempotency conflicts; 413 for bodies over 16 KiB; 415 for unsupported content type; 429 for configured rate limits; 503 for transient database unavailability; and 500 for unexpected errors. Return JSON for all `/api/*` errors, including unknown paths. Do not return raw SQL, connection strings, stack traces, or submitted descriptions in error logs.

Browser requests are same-origin. For mutations, accept JSON only and reject an explicitly foreign Origin. Allow requests without Origin so command-line clients work. Do not enable wildcard CORS. These checks are browser protections, not authentication; external callers can still directly use the API.

## 6. User interface

Use a responsive layout with three main destinations: **Purchases**, **Dashboard**, and **Settings**. Place a prominent Add purchase button where it remains easy to reach on a phone.

### Purchases and form

- List newest purchases first, with name, purchaser, Tokyo date/time, primary amount, and secondary currency amount.
- Search, date filters, purchaser filter, currency toggle, loading/error/empty states, and load-more pagination.
- Form order: name → amount/currency → converted preview and rate → purchaser → Now/custom time → optional description.
- Default to JPY entry and the last-used active purchaser on this device; fall back to Me if active, then the first active purchaser.
- If there are no active purchasers, provide a direct path to create/reactivate one.
- Show the rate as `1 JPY = … THB`, and let the user override it without changing the global default.
- If the global rate is unset, show setup guidance or allow an explicit purchase rate; never save an unconverted amount silently.
- Disable duplicate submission while a request is pending. Announce success only after the API succeeds. Preserve form input and creation UUID on network failure.
- Provide edit, soft-delete confirmation, a trash view, and restore. A restore is available after reload, not only through a temporary undo toast.

### Dashboard

- Total spend in the selected currency, alternate-currency total, and purchase count.
- Daily-spend bar chart and spending-by-purchaser horizontal bar chart.
- Charts and detail lists share filters; clearly display the active date range and timezone.
- Tooltips show both currencies. Include accessible summary text/table and useful empty states.
- Use per-purchase saved rates; explain in a short tooltip why totals do not change when the default rate changes.

### Settings

- Set/change default THB per JPY; display its last update time and explain that existing purchases retain saved rates.
- Create, rename, archive, and reactivate purchasers. Show clear duplicate-name errors.
- Display currency preference is local to each browser.

Use labeled inputs, keyboard navigation, visible focus, readable contrast, and touch targets around 44 px. Verify at a 375 px mobile width and a desktop width. Save plain text descriptions; do not render user-supplied HTML.

## 7. Configuration, hosting, and operations

### Secrets and database target

Use the Neon project supplied by the user. Its credential is deliberately not reproduced in this handoff. Obtain `DATABASE_URL` from the user's secure configuration or existing environment. If unavailable, finish code and local tests using an isolated test database, then report deployment configuration as outstanding.

```dotenv
# .dev.vars.example — placeholder only
DATABASE_URL="postgresql://USER:PASSWORD@NEON_HOST/neondb?sslmode=require&channel_binding=require"
```

Keep the actual URL in an ignored local `.dev.vars` and a Cloudflare Worker secret for deployment. Never use a `VITE_` prefix, commit the secret, embed it in frontend code, or log it. Use a separate migration credential/environment variable if the selected migration workflow requires a direct connection. The user's Prisma-specific comment does not require Prisma in this design. [Cloudflare secret configuration](https://developers.cloudflare.com/workers/configuration/secrets/)

Ignore `.dev.vars*` and `.env*` while explicitly allowing placeholder-only example files. Migration scripts must load their server-only credentials explicitly; they must not rely on browser/Vite environment injection. Prefer a dedicated runtime database role with only the application permissions needed; schema changes belong to a migration role.

Use a separate Neon branch/database for development and integration tests. Do not run destructive test cleanup against the user's production ledger. Do not auto-run migrations during HTTP requests. Review existing database objects before applying the initial migration and never reset an existing database to make the schema fit.

### Worker routing

Use the Cloudflare Vite plugin's generated build configuration. Configure SPA fallback for client routes and explicitly run the Worker first for `/api` and `/api/*`. Illustrative routing fragment:

```json
{
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api", "/api/*"]
  }
}
```

Let the chosen template/plugin determine build output paths; verify the generated asset directory instead of copying an unrelated `dist` path. Test direct browser navigation to API routes as well as fetch requests, so SPA fallback cannot disguise an API 404 as HTML. [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)

Pin a tested Worker compatibility date. Generate binding types using the installed Wrangler tooling. Add compatibility flags only if required by selected dependencies. Keep runtime code compatible with Workers; local migration tooling may run in Node.

### Public access and reliability

This is intentionally an unauthenticated shared application. Anyone who can reach the URL/API can read, create, change, archive, delete, and restore its data, including rates and purchaser names. Purchaser labels are not verified identities. A secret URL or CORS policy does not create a private ledger. Do not silently add login or API-key requirements.

Set API responses to `Cache-Control: no-store`. Cache only static versioned assets. Apply bounded query sizes and request-body limits; document any platform rate limiting actually configured. Log request ID, route, status, and duration with sanitized errors. Keep production logs free of purchase descriptions and credentials.

Show retryable errors on Neon/network failures; do not claim a failed save succeeded. Revalidate lists, summaries, and settings after successful writes and when the window regains focus. No real-time subscription is required. Keep database backup/restore instructions and migration history in the README; soft deletion is useful recovery but is not a full backup.

## 8. Proposed repository layout

```text
src/
  client/
    app/                 # routing, layout, providers
    components/          # shared accessible UI
    features/
      purchases/         # list, form, filters, trash
      dashboard/         # cards, charts, accessible tables
      settings/          # exchange rate and purchasers
    lib/                 # API client, formatting, query keys
  server/
    index.ts             # Worker entry and Hono routes
    routes/
    services/            # business rules and atomic writes
    db/                  # Drizzle schema, connection, query helpers
    middleware/          # validation/error/request handling
  shared/
    schemas.ts
    money.ts
    time.ts
    types.ts
drizzle/                 # committed SQL migrations and metadata
scripts/                 # explicit migrate/seed tooling
tests/
  unit/
  integration/
  e2e/
docs/openapi.yaml
.dev.vars.example
wrangler.jsonc
vite.config.ts
drizzle.config.ts
README.md
SYSTEM_DESIGN_AND_EXECUTION_PLAN.md
```

Do not create a monorepo or split deployments for this scope. Keep modules small enough to test business rules without launching the UI.

## 9. Ordered execution plan

Complete the stages in order. Each stage has a reviewable output and exit condition. Later stages can refine earlier code, but do not substitute mocked persistence for the Neon integration.

### Stage 1 — Scaffold and deployment skeleton

1. Inspect repository instructions and preserve existing work.
2. Scaffold React/TypeScript/Vite, React Router, Hono, and the Cloudflare Vite plugin.
3. Establish strict TypeScript, formatting/linting, package scripts, Worker bindings, and environment examples.
4. Add the three client routes and `/api/v1/health`; configure SPA/API routing.
5. Document the chosen package versions and local development command.

**Exit:** client routes survive reload, health returns JSON, unknown API paths return JSON 404, and the production build succeeds without secrets in client assets.

### Stage 2 — Domain rules and persistence

1. Implement shared validation, exact conversion/rounding, and Tokyo-time helpers.
2. Define schema, constraints, indexes, version fields, and immutable creation hashes.
3. Generate and inspect the initial SQL migration; add idempotent initial settings/purchaser data.
4. Connect through the Neon HTTP driver and verify SQL numeric values remain strings.
5. Implement atomic creation, versioned updates, archive checks, and soft-delete/restore queries.

**Exit:** migrations apply cleanly to an isolated database, rerunning the migration command is safe, and domain/persistence tests pass.

### Stage 3 — API

1. Implement settings and purchaser endpoints, then purchases, then summary.
2. Add body limits, validation, error envelopes, origin policy, and no-store headers.
3. Implement keyset pagination, shared filters, idempotent creation, and optimistic concurrency.
4. Write OpenAPI documentation and runnable HTTP/curl examples using placeholders.

**Exit:** an external HTTP client can create/read/edit/delete/restore a purchase without login; filtered summary totals match database fixtures; concurrent duplicate writes do not duplicate records.

### Stage 4 — Purchase and settings experience

1. Build purchaser/rate setup and customization.
2. Build the mobile form, bidirectional currency preview, Now/custom time, and error handling.
3. Build listing, filters, pagination, editing, trash, and restore.
4. Add query invalidation, focus refetch, stale-version handling, and accessible status messages.

**Exit:** the complete purchase lifecycle works in a browser against the real API; failed saves preserve user input; default-rate changes leave existing amounts unchanged.

### Stage 5 — Visualization

1. Connect total cards and charts to the summary endpoint.
2. Implement shared filter state, preset/custom date ranges, and currency preference.
3. Add accessible chart tables, zero/empty states, and loading/error handling.

**Exit:** charts, cards, and filtered purchases reconcile across multiple pages and both currencies, including archived purchasers and different saved rates.

### Stage 6 — Verification and deployment handoff

1. Run the focused tests below, lint/typecheck, production build, and Worker preview.
2. Inspect mobile/desktop layouts and browser errors; fix blocking issues.
3. Verify built frontend output contains no database URL or credential.
4. Complete README setup, migration, API, backup/recovery, and deployment instructions.
5. Configure the intended deployment environment and secret, apply reviewed migrations, and deploy when deployment is authorized and credentials are available. If not, deliver a ready-to-deploy build and identify only the missing configuration.
6. Perform a deployed smoke test using clearly marked test data and clean it up through the normal application workflow.

**Exit:** provide source, checks run/results, deployment URL if deployed, and explicit remaining limitations. Do not claim deployment or successful tests without evidence.

### Required package-script interfaces

Provide documented equivalents of `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate`, and `deploy`. Unit tests must run without production credentials. Database and deployment commands must identify their intended environment before making changes.

## 10. Acceptance and test checklist

### Money and time

- [ ] JPY 1,500 at 0.23 becomes THB 345.00; THB 100.00 becomes JPY 435 while preserving THB 100.00.
- [ ] Half-up boundary behavior is correct; repeated display toggles never alter amounts.
- [ ] Negative, zero, malformed, excessive-precision, and out-of-range original amounts/rates are rejected.
- [ ] Very small converted values may round to zero; maximum allowed input/rate combinations fit database columns.
- [ ] Changing the default rate affects only new purchases; editing text preserves the saved rate and totals.
- [ ] No default rate produces a clear setup state; an explicit valid rate still allows creation.
- [ ] Omitted time uses insertion time; custom Tokyo time survives round-trip display on a device configured for Bangkok.
- [ ] `2026-10-25T15:30:00Z` groups under Tokyo date `2026-10-26`; date-filter upper boundaries exclude the next day.

### API and persistence

- [ ] New records persist after refresh/restart; test records live in an isolated database.
- [ ] Duplicate concurrent POSTs with one UUID produce one row; retries do not reevaluate default time/rate.
- [ ] Same UUID with changed input conflicts; replay after deletion does not restore the row.
- [ ] Two editors using the same version cannot silently overwrite each other.
- [ ] New/reassigned purchases cannot use an archived purchaser, including during concurrent archive/create.
- [ ] Archived purchasers remain visible in historical spending; rename and reactivation work.
- [ ] Delete removes a purchase from active totals; restore adds it back with its original values.
- [ ] Pagination is stable for equal timestamps and never substitutes a page subtotal for the overall total.
- [ ] Totals equal the sum of per-day and per-purchaser groups for the same fixture/filter snapshot.
- [ ] Unknown API routes, bad input, database failures, and version conflicts return the documented JSON/status.
- [ ] SQL injection-like input is stored/searched as text; descriptions render as text, not HTML.

### Browser and hosting

- [ ] Purchases, Dashboard, and Settings work at mobile and desktop sizes with keyboard access.
- [ ] Browser flows cover setup → add in both currencies → edit → filter/chart → delete → restore.
- [ ] A network failure preserves the form and its creation ID; retry does not create a second record.
- [ ] External API creation works without browser-only headers or login.
- [ ] Direct client route navigation works; direct API navigation returns JSON rather than SPA HTML.
- [ ] Worker production build and preview work, and browser bundles/source maps expose no database secret.
- [ ] README describes the public shared-ledger behavior and the exact setup/deployment steps.

## 11. Future extensions, only after MVP

- Multiple trips: introduce trips and scope purchases, defaults, and analytics by trip.
- Categories: customizable categories with a category chart.
- CSV export: export the complete filtered ledger, include original and converted amounts/rates/timezone, and escape spreadsheet formula prefixes.
- Automatic FX: select and verify a provider, licensing, availability, caching, and historical-rate policy; retain per-purchase snapshots and manual overrides.
- Receipt uploads: add object storage, file validation, retention, and upload limits.
- Budgets and settlements: specify allocation/debt rules before implementation; purchaser alone is insufficient to infer who owes whom.
- Offline queue: add explicit reconciliation and conflict UX before allowing offline saves.

## 12. Official implementation references

Reviewed while preparing this draft on 2026-10-25; recheck before implementation if package APIs or hosting configuration change.

- [Cloudflare React SPA with API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare SPA and API routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Cloudflare Worker secrets and local environment](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Neon serverless driver and HTTP transactions](https://neon.com/docs/serverless/serverless-driver)
- [Drizzle's Neon integrations](https://orm.drizzle.team/docs/connect-neon)
