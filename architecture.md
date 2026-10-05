# Architecture

## Stack
- **Web**: Next.js 14 App Router, React 18, TypeScript (strict), CSS Modules. One runtime dependency beyond React/Next (`@fontsource/noto-sans-cuneiform`); no UI, state, ORM, HTTP, test or validation library.
- **Data**: Supabase Postgres reached over PostgREST (`rest/v1`) with the service-role key — no ORM, no Supabase client on the server path (`app/lib/db/supabase.ts`).
- **Auth**: app-managed email/password plus Google OAuth; HMAC-signed `disu_session` cookie backed by a revocable `user_sessions` row.
- **Compute**: Python bridges spawned as child processes (`python/src/quant`, `python/src/filings`).
- **Async work**: DB-backed job queue processed in the Next.js server process.
- **i18n**: `en` / `sv` via client context (`app/i18n/`); legal documents and release notes carry their own per-locale strings.

## Layout
```
app/
  api/                     route handlers (all server-side)
  components/              shell, consent, error capture, charts
  lib/                     domain modules
    account/               GDPR export, erasure, personal-data register
    admin/  analytics/  auth/  brokers/  db/  jobs/  legal/
    market/  observability/  portfolio/  primers/  quant/
    release-notes/  runtime/  security/  theme/
  i18n/                    language context + en/sv dictionaries
  legal/  learn/  help/    public (unauthenticated) page trees
db/migrations/             ordered SQL, 0001…0021
docs/                      contracts (JSON Schema), decisions, policies, runbooks
python/src/{quant,filings} bridges invoked as `python -m src.<pkg>.<entry>`
scripts/check-delivery-readiness.mjs   build/boot gate
tests/                     node:test unit + integration suites
```

## Request flow
1. Browser hits a page or `/api/*` route.
2. `middleware.ts` runs on the Edge runtime over a fixed matcher list. It **verifies the HMAC signature** of `disu_session` via `app/lib/auth/session-edge.ts` (Web Crypto, no DB access) — a forged cookie never reaches the signed-in shell. It does not check revocation.
3. `app/layout.tsx` calls `getAuthenticatedSessionFromToken()` (Node, DB-backed) before rendering, so a signature-valid but revoked session renders the signed-out frame. One query per render, only when a cookie exists.
4. Route handlers resolve the session again with `app/lib/auth/session.ts`, read/write through `userScoped()` / `systemRequest()`, and record audit rows via `recordEvent()`.
5. Long-running work (Quant, Primers) is enqueued as a job row; the caller gets a job id and polls `/api/jobs/[jobId]`.

Route visibility is split deliberately. The middleware matcher gates `/account`, `/dashboard`, `/portfolio`, `/quant`, `/filings-primers`, `/sentiment`, `/placera`, `/help/release-notes` and the corresponding API prefixes. `/help`, `/help/faq`, `/help/docs`, `/legal/*`, `/learn/*` and `/primers` are public on purpose — legal documents must be readable before signup, and `/primers` browses logged out while the run itself still requires an account. `PROTECTED_PREFIXES` in `app/components/app-shell.tsx` is a *separate* list deciding which routes render inside the app frame; the two intentionally differ.

## Modules

### Auth (`app/lib/auth/`, `app/api/auth/`)
- `users` table; passwords salted + `scrypt`-hashed. `password_hash`/`password_salt` are nullable — a Google-only account has neither, and `authenticateUser()` refuses to authenticate such a row.
- Session = HMAC-signed cookie keyed on `DISU_SESSION_SECRET`. Two verifiers, deliberately asymmetric: `session-edge.ts` is signature-only (Edge, no DB), `session.ts` is authoritative (signature + `user_sessions` row state).
- Google sign-in (`google.ts`, `/api/auth/google/{start,callback}`) is a hand-rolled authorization-code flow with PKCE and a nonce — no Supabase Auth, no extra dependency. `start` stores a signed state, the PKCE verifier and the nonce in short-lived cookies scoped to `/api/auth/google`; `callback` exchanges the code, validates `iss`/`aud`/`exp`/`nonce`, and mints the same `disu_session` the password flow issues. The `id_token` signature is not JWKS-verified because the token is read directly from Google's token endpoint over TLS.
- Google identities are keyed on `sub` (`users.google_sub`, unique). A Google sign-in whose verified email matches an existing account links to it; an unverified Google email is rejected outright.
- The signed state carries a mode. `signin` is the login page. `mode=link` bakes the signed-in user id into the state and the callback links only if the live session is still that user, so a sign-out/sign-in mid-flow is refused rather than linking Google to the wrong account. An unrecognised mode degrades to `signin`. Because the session is the authorisation, an explicit link may attach a Google address differing from the account email; `linkGoogleToUser()` refuses a `sub` another account owns and refuses a Google address another account is registered under (`sub` is matched before email, so that case would otherwise route the address's owner into the linking account).
- Reset flow issues single-use hashed tokens in `password_reset_tokens`, 1h TTL. Non-production returns the reset link inline instead of sending email.
- Password policy (`password-policy.ts`, enforced by `password-guard.ts` on register, reset and in-session change): 10-char floor, 200-char ceiling, a common-word blocklist matched after folding trailing digits / leetspeak / punctuation, and structural rejects (few distinct characters, keyboard runs, short all-digit strings, anything derived from the user's own email). Plus a breached-password lookup against the Pwned Passwords k-anonymity range API (`app/lib/security/pwned-passwords.ts`) — only a 5-char SHA-1 prefix leaves the process, and the lookup fails open and logs when unreachable. `PASSWORD_BREACH_CHECK=off` disables it. Rejections carry a stable code so forms localise the reason. Sign-in validates nothing, so accounts created under the old 8-char rule are unaffected until they reset.
- Supabase Auth is not part of the auth path at all. The `@supabase/ssr` client wrappers that once sat unused in `app/lib/auth/` are gone, along with the `@supabase/*` dependencies; the only Supabase surface is PostgREST over `fetch` in `app/lib/db/supabase.ts`.
- Admin authorization is a `user_roles` lookup (`app/lib/admin/access.ts`), checked per request in `/api/admin/*`.

### Sessions (`app/lib/auth/sessions.ts`, `0019`)
- `createSessionRecord` / `findSessionById` / `revokeSession` / `revokeAllSessionsForUser` / `pruneExpiredSessions`. 7-day TTL.
- The cookie carries `sid`; a missing, revoked or expired row kills the token however well it is signed. Logout revokes one; a password reset or in-session password change revokes every session for that user and reissues the current browser.
- Expired rows are deleted on the job worker's retention sweep.

### Account & GDPR (`app/lib/account/`, `app/api/account/`)
- `personal-data.ts` is the register: every table holding personal data, its `user_id` column, and an erasure policy of `erase` | `anonymise` | `blocks`. `export.ts`, `delete.ts` and `store.ts` are generic over it — adding a table to the register is the whole change.
- `GET /api/account/export` (Art. 15/20) and `DELETE /api/account/delete` (Art. 17). `findAccountDeletionBlockers()` reports `blocks` rows before deleting: `release_notes.created_by` is `on delete restrict`, so an admin who authored a release note is reported as un-erasable until authorship is reassigned rather than failing mid-delete.
- `GET /api/account/security` reports which sign-in methods exist — booleans only, never the hash, salt or `sub`. `POST /api/account/password` sets or changes a password in-session: a Google-only account needs no current password because the Google-issued session is the proof, an account that has one must prove it, and either way `assertAcceptablePassword()` applies. `DELETE /api/account/google` unlinks, and is refused while no password exists — that would leave the account reachable only through the reset email.

### Jobs (`app/lib/jobs/`, `app/api/jobs/`)
- States: `queued → running → succeeded | failed`, plus `cancelled` and `dismissed`.
- `store.ts` = persistence, `lifecycle.ts` = pure state/retry/backoff logic, `processor.ts` = in-process worker, `request-schemas.ts` = payload validation, `artifacts.ts` = derives `job_artifacts` rows from bridge output, `subprocess.ts` = process-group spawn/kill.
- `initJobWorker()` is idempotent module-level state (`activeJobs`, `runningJobAbortControllers`) driven by `setTimeout`/`setInterval`. It schedules: orphan recovery at t=0; `cleanupOldJobData()` at t=2s then every 6h; `captureDailySnapshots()` at t=15s then every `PORTFOLIO_SNAPSHOT_SWEEP_INTERVAL_MS`.
- The retention sweep is shared: old terminal jobs (`JOB_RETENTION_DAYS`, default 30), artifacts (`JOB_ARTIFACT_RETENTION_DAYS`), expired `user_sessions`, and funnel events past `ANALYTICS_RETENTION_DAYS`. A sweep exceeding `JOB_RETENTION_ALERT_THRESHOLD_MS` logs at `warn`.
- **Constraint**: the queue is per-process. Multiple server instances each run their own worker; correctness relies on the DB claim in `store.ts` and job idempotency keys (`0005`), not on a shared broker.

### Quant / Primers (`app/lib/quant/executor.ts`, `app/lib/primers/executor.ts`)
- Each executor spawns `QUANT_PYTHON_BIN` / `PRIMER_PYTHON_BIN` with `-m src.<pkg>.<entry>`, streams stdout, and parses a single JSON payload conforming to `docs/contracts/*.schema.json`.
- Children run in their own process group; cancellation kills the tree.
- Failures are classified (`timeout`, `bridge_output`, `network`, `runtime`, …) for retry decisions.
- `QUANT_MOCK_FALLBACK_MODE` / `PRIMER_MOCK_FALLBACK_MODE` must be `never` in production; `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE` must be `0`. Both are enforced at boot, not by convention.

### Portfolio & brokers (`app/lib/portfolio/`, `app/lib/brokers/`)
- Positions view unions broker-synced `positions` with user-owned `manual_positions`.
- Manual holdings are repriced at read time from live quotes; a currency mismatch triggers an FX lookup before computing `currentPrice` / `positionValue` / PnL. Totals are denominated in `PORTFOLIO_DISPLAY_CURRENCY` (default SEK, not per-user).
- Broker ingest: Tink OAuth (`tink.ts`, `/api/brokers/tink/*`) and Avanza CSV import (`avanzaCsv.ts`). `adapters/index.ts` maps every `BrokerProvider` to a `missingAdapter` that throws — no per-provider adapter is implemented, so the two ingest paths above are the whole of it.
- Broker tokens are encrypted with `BROKER_TOKEN_ENCRYPTION_KEY` and stored in `broker_connection_secrets` (`tokenVault.ts`). They are never exported and never rendered.
- Daily history: `snapshots.ts` writes one `portfolio_snapshots` row per user per day. The sweep runs off the job worker's timer, and `/api/portfolio/positions` calls `initJobWorker()` so an instance nobody runs quant jobs on still records history. The first capture of a date wins; a later sweep only fills gaps. `snapshot-value.ts` is stricter than the live total — placeholder-priced and unconvertible holdings are excluded and counted, and a day with nothing observable produces no row, because a fabricated point in a permanent series cannot be told from a real one later.

### Market & feeds (`app/lib/market/`)
- `quote.ts` holds the contract and is deliberately import-free so the node test runner can load it without the `@/` alias. Every `QuoteSnapshot` carries `source` (`yahoo` | `finnhub` | `placeholder`), `synthetic`, and a `previousClose` that is `null` rather than estimated. `computeDayChange()` returns `null` for a synthetic quote — a change derived from a fabricated price is itself fabricated.
- `HybridMarketProvider` chain: Yahoo quote → Yahoo chart → Finnhub → flagged placeholder. `getQuote(symbol, fallbackCurrency)` and `getQuoteInCurrency()` are separate calls; `fallbackCurrency` labels a placeholder and never relabels an observed price.
- `marketFallbackMode()` reads `MARKET_MOCK_FALLBACK_MODE` (`never` | `offline` | `always`) and **defaults to `never` under `NODE_ENV=production` even when unset** — a missing config value fails closed.
- **Measured Finnhub coverage (2026-08-27, current key)**: `/quote AAPL` 200; `/quote EVO.ST`, `/quote VOLV-B.ST`, `/forex/rates` all 403. On this plan Finnhub is a US-equities failover only — Nordic tickers and all FX still have Yahoo as a single point of failure.
- FX rates are cached in-process with a short TTL. Ticker search layers Yahoo search over a curated local list.
- Sentiment/news pages consume `/api/market/indices` and `/api/news/feed` (RSS from FT, WSJ, NYT, Google News). `/api/placera` scrapes the Placera forum API (90-day lookback, paginated, 10s timeout) and derives a sentiment summary.

### Consent & legal (`app/lib/legal/`, `app/components/consent-*`)
The legal pages are generated from registers that the build checks against the code, so the documents cannot drift from what the system does.

- `controller.ts` — controller identity. Unknown facts are `PENDING`, rendered as a visible gap, never as plausible placeholder text. `check:delivery:strict` refuses to boot a production server while anything is pending.
- `cookies.ts` — every cookie, `localStorage` and `sessionStorage` key, each with a category (`essential` | `preference` | `analytics` | `marketing`), lifetime, purpose and source.
- `subprocessors.ts` — every outbound host, split into `processor` (Art. 28, handles personal data: Supabase, Tink, Resend, Google, Groq, OpenAI, GA/Ads/Meta/LinkedIn, hosting) and `source` (public data only, learns that *DISU* asked about a symbol: Yahoo, Finnhub, SEC EDGAR, Placera, news publishers, Pwned Passwords). `NON_DATA_HOSTS` exempts hosts that are only linked, not called.
- `retention.ts` — the published retention periods, each naming the code path that enforces it. Several are env-driven, so changing e.g. `ANALYTICS_RETENTION_DAYS` changes a published statement.
- `consent.ts` — `CONSENT_VERSION` (currently 2), `CONSENT_MAX_AGE_DAYS` (180), `DEFAULT_CONSENT` denying everything optional. Stored consent below the current version is treated as absent. Bumping the version is how a change to what a category *covers* re-asks everyone.
- `tags.ts` — a tag loads only when **both** the visitor consented to its category **and** the deployment set the id env var. `cookies[].firstParty` is what `withdrawTag()` can actually delete; vendor-domain cookies are honestly reported as out of reach.
- `document.ts` + `{privacy,terms,cookie}-document.ts` render the prose as data (blocks, per-locale strings) with cookie/sub-processor/retention tables generated from the registers.

### Funnel analytics (`app/lib/analytics/`, `0020`)
A second event stream, deliberately separate from the `events` audit log.

- `events` is `user_id not null references users(id)`, written through `userScoped()`, held under legitimate interest. `landing_view` and `signup_start` have no user by definition, so they cannot be written there at all.
- `analytics_events` has a nullable `user_id`, is **not** in `USER_OWNED_TABLES`, and is reached through `supabaseRequest()` directly. The property that replaces tenant scoping: the app only ever writes here — no route returns a row from this table. A CHECK constraint requires `anon_id is not null or user_id is not null`.
- `analyticsAllowed()` in `funnel-store.ts` reads the consent cookie off the causing request and drops the event otherwise, failing closed on anything unparseable. Consequence: a funnel event can only be recorded where a request is in scope, which is why `quant_run` / `primer_run` fire at enqueue in the route and never in the job worker.
- The taxonomy in `funnel.ts` is closed — every event declares its properties, every value is an enum member, slug or count, everything else is dropped before the insert. `origin` is stored, not derived. `/api/analytics/events` is unauthenticated, IP rate-limited at 120/min, capped at 10 events per request, and accepts only the two events whose spec says `origin: "client"`; a posted `signup_complete` is refused.
- `anon-id.ts` keeps the visit id in `sessionStorage`, not a cookie: never sent on other requests, and it dies with the tab, so it structurally cannot follow anyone across visits. Every access is try/caught (Safari private mode throws).
- `track.ts` (`useFunnelEvent()`) fires once, never before the consent cookie has been read, never without analytics consent, and uses `sendBeacon` where available so a `landing_view` survives the navigation it precedes.

### Observability (`app/lib/observability/`)
- `log.ts` emits single-line JSON (`ts`, `level`, `event`, fields). `error` also POSTs to `ERROR_REPORT_WEBHOOK_URL` with a 1.5s abort and swallowed failures — reporting never fails a request.
- `client-error.ts` is total over untrusted input: every field whitelisted, coerced, truncated and redacted; anything unparseable yields `null` rather than a half-formed report. Paths are sanitised to `pathname` only — query strings carry reset tokens and OAuth codes. It is dependency-free so both `/api/observability/client-error` and the browser reporter import it.
- `app/components/client-error-capture.tsx` mounts outside `AppShell` so listeners are attached even when the shell is what broke.

### Release notes & feature requests (`app/lib/release-notes/`, `app/lib/feature-requests/`)
- Release notes are markdown with per-locale rows in `release_note_translations`; public read via `/api/release-notes`, authoring via `/api/admin/release-notes`, optional machine translation via `translate.ts`.
- Feature requests support comments, one vote per user, pagination, and admin status transitions; each action writes an `events` row and can fire a notification email. `COMMENTS_REQUIRE_LOGIN` / `VOTES_REQUIRE_LOGIN` gate the anonymous paths.

## Data model
| Domain | Tables |
| --- | --- |
| Auth | `users`, `password_reset_tokens`, `user_roles`, `user_sessions` |
| Portfolio | `broker_connections`, `broker_connection_accounts`, `broker_connection_secrets`, `positions`, `manual_positions`, `portfolio_snapshots` |
| Jobs | `jobs`, `job_artifacts` |
| Feedback | `release_notes`, `release_note_translations`, `feature_requests`, `feature_request_comments`, `feature_request_votes` |
| Audit | `events` (user-owned, legitimate interest) |
| Analytics | `analytics_events` (not user-owned, consent-only, write-only) |

Migrations are forward-only and applied in filename order.

| | |
| --- | --- |
| `0007`–`0009` | Quant Updates email tables; `0017` drops them |
| `0018` | `users.google_sub` |
| `0019` | `user_sessions` — until applied, **every sign-in fails**: a token cannot be minted without a session row |
| `0020` | `analytics_events` |
| `0021` | `portfolio_snapshots` — until applied the daily sweep fails, and each day it does not run is value history that cannot be recovered later |

## Security & tenancy
- RLS is enabled on app tables (`0002_rls_policies.sql`), but server code uses the service-role key and bypasses it. RLS is defense-in-depth against direct/anon access; **the `user_id` filter is the authorization boundary**.
- That filter is structural, not remembered. `app/lib/db/user-scope.ts` declares `USER_OWNED_TABLES` (`broker_connection_accounts`, `broker_connection_secrets`, `broker_connections`, `events`, `job_artifacts`, `jobs`, `manual_positions`, `portfolio_snapshots`, `positions`, `user_roles`, `user_sessions`) and exposes `userScoped(userId, table, options)`, which injects `user_id=eq.<id>` into reads/updates/deletes and stamps `user_id` onto inserts; supplying your own `user_id`, an empty user id, or an insert naming another owner all throw. Deliberate cross-tenant work (queue drain, orphan recovery, retention pruning) goes through `systemRequest(table, { reason, … })`, which forces the exemption to be written down at the call site.
- Auth routes are rate-limited per client IP **and** per email (`app/lib/security/`), covering `/login`, `/register`, `/forgot-password`, `/reset-password`; `/api/analytics/events` is IP-limited. Counters are in-process — correct for a single long-lived Node instance, and they must move to a shared store before running more than one.
- Secrets at rest: password hashes (`scrypt`), reset tokens (hashed), broker tokens (encrypted).
- Sessions are revocable server-side (see Sessions). Session *forgery* resistance still depends on `DISU_SESSION_SECRET`; rotating it invalidates everything, but is no longer the only way to revoke one.

## Build gates (`scripts/check-delivery-readiness.mjs`)
Run as `check:delivery` in CI and as `check:delivery:strict` in `prestart` — a failing gate does not boot the server. 387 lines, no dependencies. It fails on:

1. A missing `docs/deployment-policy.md`, `docs/runbooks.md` or `docs/synthetic-data-policy.md`.
2. An `.env.example` missing any delivery-critical key.
3. *(strict)* A missing runtime env var; and under `NODE_ENV=production`, `QUANT_MOCK_FALLBACK_MODE`/`PRIMER_MOCK_FALLBACK_MODE` not `never`, `MARKET_MOCK_FALLBACK_MODE` set to anything but `never`, or `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE=1`.
4. `charCodeAt(` anywhere under `app/{dashboard,portfolio,quant,filings-primers}` — hash-derived numbers must come from a provider that flags them, never inline in a page (`docs/synthetic-data-policy.md`).
5. A raw `supabaseRequest("<user-owned table>")` call outside `userScoped()`/`systemRequest()`.
6. A `<column> references users(id)` in any live migration that is not declared in `app/lib/account/personal-data.ts` — so adding a table and forgetting is a build failure, not a row that survives an erasure request.
7. An outbound `https://<host>` in `app/` (comments stripped) not declared in `subprocessors.ts` or `NON_DATA_HOSTS`; a `*COOKIE*` constant not declared in `cookies.ts`.
8. A consent-requiring category declared while any of `consent.ts`, `consent-provider.tsx`, `consent-banner.tsx`, `consent-tags.tsx` is missing; a `DEFAULT_CONSENT` entry other than `necessary` set `true` (pre-ticked box); a banner with no button wired to `rejectEverything` or `acceptEverything`; a footer with nothing wired to `openPreferences`.
9. *(strict, production)* Any `PENDING` field in `controller.ts`.

## Environment
**Required**: `DISU_SESSION_SECRET`, `BROKER_TOKEN_ENCRYPTION_KEY`, `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`). `QUANT_PYTHON_BIN` / `PRIMER_PYTHON_BIN` are optional (executors fall back to `python3`) but validated when set.

**Fail-closed switches**: `QUANT_MOCK_FALLBACK_MODE`, `PRIMER_MOCK_FALLBACK_MODE`, `MARKET_MOCK_FALLBACK_MODE`, `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE`.

**Feature-flagged by presence**: `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (login page and `/account` connect button both self-hide without both); `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` (blank = hard off, regardless of consent); `FINNHUB_API_KEY`; `ERROR_REPORT_WEBHOOK_URL`; `RESEND_API_KEY`; `TINK_*`.

**Retention knobs that are also published statements**: `JOB_RETENTION_DAYS` (30), `JOB_ARTIFACT_RETENTION_DAYS`, `ANALYTICS_RETENTION_DAYS` (180). Changing one changes text in `app/lib/legal/retention.ts`.

**Other**: `PORTFOLIO_SNAPSHOT_SWEEP_INTERVAL_MS` (6h, floor 1min), `PORTFOLIO_DISPLAY_CURRENCY` (SEK), `PASSWORD_BREACH_CHECK`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_ALLOWLIST_EMAILS`, `COMMENTS_REQUIRE_LOGIN`, `VOTES_REQUIRE_LOGIN`, `JOB_IDEMPOTENCY_WINDOW_HOURS`, `JOB_RECOVERY_*`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `SEC_USER_AGENT`, `REDDIT_*`. `WEEKLY_EMAIL_FROM` survives only as a legacy fallback for the password-reset from-address (`app/lib/auth/reset.ts`).

`.env.example` is key-names-only and is itself checked by the delivery gate. Runtime validation is centralized in `app/lib/runtime/env.ts` (`ensureRuntimeEnv()`), called from `app/layout.tsx`.

## Verification
`npm run ci` = `lint` → `typecheck` → `test:unit` → `test:smoke` → `check:delivery`.

Tests use the built-in `node:test` runner with `--experimental-strip-types` (no test framework dependency) and `--import ./tests/support/alias-hooks.mjs`, which resolves the `@/*` tsconfig alias so app modules import directly. `tests/support/fake-supabase.ts` is an in-memory PostgREST stand-in that lets store-layer tests run without a live project. Smoke tests require live Supabase credentials and skip without them.

Test files are enumerated explicitly in `package.json`, not globbed. `tests/market-provider-strict.test.ts` exists but is wired into neither `test:unit` nor `test:smoke`, so it does not run in CI.

## Known constraints
- Job worker is in-process and non-distributed; auth and analytics rate-limit counters share that single-process assumption.
- Market data has no paid provider covering the actual universe. Finnhub 403s on Nordic tickers and FX on the current plan, so Yahoo's unofficial endpoints remain a single point of failure for most of a Swedish portfolio; the terminal fallback is a flagged placeholder, disabled in production.
- Tink is sandbox-verified only; production enablement is pending.
- Google sign-in is coded and migrated but inert until the client id and secret are set.
- `app/lib/legal/controller.ts` is entirely `PENDING` — the entity is not registered, so `check:delivery:strict` will not boot a production server.
