# Architecture

## Stack
- **Web**: Next.js 14 App Router, React 18, TypeScript (strict), CSS Modules. One runtime dependency beyond React/Next (`@fontsource/noto-sans-cuneiform`) — no UI, state, ORM, HTTP, test or validation library.
- **Data**: Supabase Postgres over PostgREST (`rest/v1`) with the service-role key; no ORM, no Supabase client (`app/lib/db/supabase.ts`).
- **Auth**: app-managed email/password + Google OAuth. HMAC-signed `disu_session` cookie backed by a revocable `user_sessions` row. Supabase Auth is not in the path.
- **Compute**: Python bridges spawned as child processes (`python/src/{quant,filings}`).
- **Async**: DB-backed job queue processed in-process.
- **i18n**: `en`/`sv` client context (`app/i18n/`), persisted in `localStorage` (`app_language`).
- **Styling**: three global sheets loaded in `app/layout.tsx` — `globals.css` (tokens), `design-system.css` (`--ds-*` surfaces, radii, elevation), `theme-glass.css` (scoped to the `glass-enabled` class `app/layout.tsx` sets from `GLASS_ENABLED`). The theme toggle is gone and `globals.css` pins `color-scheme: light` — there is no dark token set, though `design-system.css` derives every value with `color-mix` from surface/ink so one could be added without touching component CSS. Separation is elevation + spacing; 1px borders only on inputs and focus rings.

## Layout
```
app/
  api/                     route handlers (server-only)
  components/              shell, consent, charts, chart-download, mood-animal, error capture
  lib/
    account/               GDPR export, erasure, personal-data register
    admin/ analytics/ auth/ brokers/ db/ export/ jobs/ legal/
    market/ observability/ placera/ portfolio/ primers/ quant/
    release-notes/ runtime/ security/ theme/ trading/
  dashboard/               page + market-cards, movers-card, shortcuts-card, value-card
  portfolio/               accounts | positions | analysis | calendar (route tabs)
  profile/                 account module (/account 308s here)
  legal/ learn/ help/ primers/   public page trees
db/migrations/             ordered SQL, 0001…0022
docs/                      contracts (JSON Schema), decisions, policies, runbooks
python/src/{quant,filings} invoked as `python -m src.<pkg>.<entry>`
scripts/check-delivery-readiness.mjs   build/boot gate
tests/                     node:test unit + integration
```

## Request flow
1. `middleware.ts` (Edge, fixed matcher) verifies the `disu_session` HMAC via `app/lib/auth/session-edge.ts` — Web Crypto, no DB, signature only, no revocation check.
2. `app/layout.tsx` calls `getAuthenticatedSessionFromToken()` (Node, DB-backed) before render, so a signed-but-revoked session gets the signed-out frame. One query per render, only when a cookie exists.
3. Route handlers re-resolve with `app/lib/auth/session.ts`, read/write via `userScoped()` / `systemRequest()`, audit via `recordEvent()`.
4. Long work (Quant, Primers) is enqueued; the caller polls `/api/jobs/[jobId]`.

Two route lists, deliberately different:

| List | Location | Decides |
| --- | --- | --- |
| `config.matcher` | `middleware.ts` | requires a session: `/profile`, `/account`, `/dashboard`, `/portfolio`, `/quant`, `/filings-primers`, `/sentiment`, `/placera`, `/help/release-notes`, and `/api/{brokers,portfolio,quant,filings-primers,jobs,account,release-notes}` |
| `PROTECTED_PREFIXES` | `app/components/app-shell.tsx` | renders inside the app frame (superset; adds `/primers`, `/learn`, `/help`, `/legal`) |

Public on purpose: `/help`, `/help/faq`, `/help/docs`, `/legal/*`, `/learn/*`, `/primers`.

## Modules

### Auth (`app/lib/auth/`, `app/api/auth/`)
- `users`; passwords salted + `scrypt`-hashed. `password_hash`/`password_salt` nullable — `authenticateUser()` refuses a Google-only row.
- Two verifiers, asymmetric by design: `session-edge.ts` signature-only; `session.ts` authoritative (signature + `user_sessions` state).
- Google: hand-rolled auth-code flow with PKCE + nonce (`google.ts`, `/api/auth/google/{start,callback}`). `start` writes signed state, verifier and nonce to short-lived cookies scoped to `/api/auth/google`; `callback` validates `iss`/`aud`/`exp`/`nonce` and mints the same `disu_session`. `id_token` is not JWKS-verified — read directly from Google's token endpoint over TLS.
- Identity keyed on `users.google_sub` (unique). Verified email matching an account links to it; unverified email is rejected. Signed state carries a mode: `signin`, or `link` bound to the user id (refused if the live session changed). `linkGoogleToUser()` refuses a `sub` or a Google address another account owns (`sub` matched first).
- Reset: single-use hashed tokens, `password_reset_tokens`, 1h TTL; non-production returns the link inline.
- Password policy (`password-policy.ts` via `password-guard.ts` on register/reset/change): 10–200 chars, common-word blocklist after folding digits/leetspeak/punctuation, structural rejects (few distinct chars, keyboard runs, short all-digit, email-derived), plus Pwned Passwords k-anonymity (5-char SHA-1 prefix, fails open, `PASSWORD_BREACH_CHECK=off` disables). Stable rejection codes for localisation. Sign-in validates nothing.
- Admin authz is a `user_roles` lookup (`app/lib/admin/access.ts`), per request in `/api/admin/*`.

### Sessions (`app/lib/auth/sessions.ts`, `0019`)
7-day TTL. Cookie carries `sid`; a missing/revoked/expired row kills the token regardless of signature. Logout revokes one; password reset or change revokes all for that user and reissues the current browser. Expired rows die on the retention sweep.

### Account & GDPR (`app/lib/account/`, `app/api/account/`)
- `personal-data.ts` is the register: table, `user_id` column, erasure policy `erase` | `anonymise` | `blocks`. `export.ts`, `delete.ts`, `store.ts` are generic over it.
- `GET /api/account/export` (Art. 15/20), `DELETE /api/account/delete` (Art. 17). `findAccountDeletionBlockers()` reports `blocks` rows first: `release_notes.created_by` is `on delete restrict`; `trading_accounts` blocks under Art. 17(3)(b) (bokföringslag 7y, MiFID II 5y) — refused and escalated, never cascaded.
- `GET /api/account/security` returns booleans only. `POST /api/account/password` sets or changes in-session (Google-only account needs no current password; the session is the proof). `DELETE /api/account/google` is refused while no password exists.
- UI lives at `/profile`; `/account` is a redirect kept for bookmarks and in-flight OAuth state carrying `nextPath: "/account"`.

### Jobs (`app/lib/jobs/`, `app/api/jobs/`)
- States `queued → running → succeeded | failed`, plus `cancelled`, `dismissed`.
- `store.ts` persistence · `lifecycle.ts` pure state/retry/backoff · `processor.ts` worker · `request-schemas.ts` payload validation · `artifacts.ts` → `job_artifacts` · `subprocess.ts` process-group spawn/kill.
- `initJobWorker()` is idempotent module state on timers: orphan recovery t=0; `cleanupOldJobData()` t=2s then 6h; `captureDailySnapshots()` t=15s then `PORTFOLIO_SNAPSHOT_SWEEP_INTERVAL_MS`.
- One sweep covers terminal jobs (`JOB_RETENTION_DAYS`, 30), artifacts (`JOB_ARTIFACT_RETENTION_DAYS`), expired `user_sessions`, funnel events (`ANALYTICS_RETENTION_DAYS`). Over `JOB_RETENTION_ALERT_THRESHOLD_MS` logs `warn`.
- **Constraint**: per-process queue. Correctness rests on the DB claim in `store.ts` and idempotency keys (`0005`), not a broker.

### Quant / Primers (`app/lib/{quant,primers}/executor.ts`)
Spawn `QUANT_PYTHON_BIN` / `PRIMER_PYTHON_BIN` with `-m src.<pkg>.<entry>`, stream stdout, parse one JSON payload against `docs/contracts/*.schema.json`. Own process group; cancel kills the tree. Failures classified (`timeout`, `bridge_output`, `network`, `runtime`, …) for retry. `QUANT_MOCK_FALLBACK_MODE` / `PRIMER_MOCK_FALLBACK_MODE` must be `never` and `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE` `0` in production — enforced at boot.

### Portfolio (`app/lib/portfolio/`, `app/lib/brokers/`)
- Positions union broker-synced `positions` with `manual_positions`; manual holdings repriced at read time, FX-converted on currency mismatch. Totals in `PORTFOLIO_DISPLAY_CURRENCY` (SEK, not per-user).
- Ingest: Tink OAuth (`tink.ts`, `/api/brokers/tink/*`) and Avanza CSV (`avanzaCsv.ts`). `adapters/index.ts` maps every other `BrokerProvider` to a throwing `missingAdapter`.
- Broker tokens encrypted with `BROKER_TOKEN_ENCRYPTION_KEY` in `broker_connection_secrets` (`tokenVault.ts`); never exported, never rendered.
- `snapshots.ts` writes one `portfolio_snapshots` row per user per day off the worker timer; `/api/portfolio/positions` calls `initJobWorker()` so a quant-idle instance still records history. First capture of a date wins; later sweeps only fill gaps. `snapshot-value.ts` is stricter than the live total — placeholder-priced and unconvertible holdings are excluded and counted, and a day with nothing observable writes no row.
- Four routes, one module, tabs derived from pathname (`portfolio-tabs.tsx`): accounts, positions, analysis, calendar. `/api/portfolio/calendar` reports its own coverage per symbol (resolved / provider-refused / not asked) — Finnhub answers US earnings, 403s Nordic earnings and all dividends; AGMs have no feed and are absent, not approximated.

### Market (`app/lib/market/`)
- `quote.ts` is import-free so `node:test` can load it without the `@/` alias. Every `QuoteSnapshot` carries `source` (`yahoo` | `finnhub` | `placeholder`), `synthetic`, and a `previousClose` that is `null` rather than estimated. `computeDayChange()` returns `null` for a synthetic quote.
- `HybridMarketProvider`: Yahoo quote → Yahoo chart → Finnhub → flagged placeholder. `getQuote(symbol, fallbackCurrency)` and `getQuoteInCurrency()` are separate; `fallbackCurrency` labels a placeholder and never relabels an observed price.
- `marketFallbackMode()` reads `MARKET_MOCK_FALLBACK_MODE` (`never` | `offline` | `always`) and defaults to `never` under `NODE_ENV=production` even when unset.
- `board-catalogue.ts` declares the dashboard board (markets, commodities, crypto, FX) as `IndexDescriptor`s so all four cards go through the provider rather than a private fetch path; `finnhubMatchers` is empty where Finnhub cannot resolve the symbol. `/api/market/board` fetches all 24 readings in one Yahoo batch, with a server-side cache, failure cooldown and per-entry retention. A missing reading is `null` to the card.
- `/api/market/movers` ranks the fixed 24-name universe only; the count travels in the payload. Unpriced names are dropped, not ranked at zero. No provider on the current plan exposes a screener.
- `price-export.ts` + `app/lib/export/xlsx.ts`: OHLC/dividend history for one symbol over an arbitrary range, served by `/api/tickers/history/download` as CSV or XLSX. The writer is a single-sheet zip built from `node:zlib` + `Buffer` — no library. Gaps stay gaps.
- **Measured Finnhub coverage (2026-08-27, current key)**: `/quote AAPL` 200; `/quote EVO.ST`, `/quote VOLV-B.ST`, `/forex/rates` 403. US-equities failover only.
- FX cached in-process, short TTL. Ticker search layers Yahoo search over a curated list. Sentiment/news read `/api/market/indices` and `/api/news/feed` (FT, WSJ, NYT, Google News RSS). `app/lib/placera/sentiment-pipeline.ts` holds the Placera forum logic (90-day lookback, paginated, 10s timeout); `/api/placera` is only parameters, status codes and cache headers.

### Trading (`app/lib/trading/`, `0022`) — scaffolding, not wired
No route imports it, and `0022_trading_accounts.sql` is **not applied**; the gate is `docs/trading-platform.md` §5. Shape assumes a licensed partner holding custody, client money and KYC, so every table carries both ids (`partner_ref`) for daily reconciliation. Money is `numeric` in SQL and a decimal string in TS — never `number`. `order-state.ts` is a pure transition table (no I/O, no clock) with four terminal states as empty arrays, exhaustively tested in `tests/trading-order-state.test.ts`. Over-fill is refused by the machine and by a CHECK. Fills are immutable and additive; balances derive from double-entry `trading_ledger_entries`, never stored.

### Consent & legal (`app/lib/legal/`, `app/components/consent-*`)
Legal pages are generated from registers the build checks against the code.
- `controller.ts` — controller identity; unknown facts are `PENDING` and render as a visible gap. `check:delivery:strict` refuses to boot production while any remain.
- `cookies.ts` — every cookie, `localStorage` and `sessionStorage` key with category (`essential` | `preference` | `analytics` | `marketing`), lifetime, purpose, source.
- `subprocessors.ts` — every outbound host, split `processor` (Supabase, Tink, Resend, Google, Groq, OpenAI, GA/Ads/Meta/LinkedIn, hosting) vs `source` (Yahoo, Finnhub, SEC EDGAR, Placera, news publishers, Pwned Passwords). `NON_DATA_HOSTS` exempts linked-only hosts.
- `retention.ts` — published periods, each naming the enforcing code path; several are env-driven.
- `consent.ts` — `CONSENT_VERSION` 2, `CONSENT_MAX_AGE_DAYS` 180, `DEFAULT_CONSENT` denies everything optional; stored consent below the current version counts as absent.
- `tags.ts` — a tag loads only with both category consent and the id env var. `cookies[].firstParty` bounds what `withdrawTag()` can delete.
- `document.ts` + `{privacy,terms,cookie}-document.ts` render prose as per-locale blocks with tables generated from the registers.

### Funnel analytics (`app/lib/analytics/`, `0020`)
Separate from the `events` audit log, which is `user_id not null` and written through `userScoped()` under legitimate interest.
- `analytics_events` has nullable `user_id`, is **not** in `USER_OWNED_TABLES`, and goes through `supabaseRequest()`. The invariant replacing tenant scoping: the app only writes here — no route returns a row. CHECK requires `anon_id is not null or user_id is not null`.
- `analyticsAllowed()` reads the consent cookie off the causing request and fails closed, so events need a request in scope — hence `quant_run` / `primer_run` fire at enqueue, never in the worker.
- `funnel.ts` taxonomy is closed: declared properties, enum/slug/count values, everything else dropped pre-insert; `origin` stored, not derived. `/api/analytics/events` is unauthenticated, IP-limited 120/min, 10 events/request, and accepts only the two `origin: "client"` events.
- `anon-id.ts` keeps the visit id in `sessionStorage` (never sent on other requests, dies with the tab); every access try/caught.
- `track.ts` (`useFunnelEvent()`) fires once, after the consent cookie is read, and uses `sendBeacon` where available.

### Observability (`app/lib/observability/`)
`log.ts` emits single-line JSON (`ts`, `level`, `event`, fields); `error` also POSTs to `ERROR_REPORT_WEBHOOK_URL` with a 1.5s abort and swallowed failures. `client-error.ts` is total over untrusted input — every field whitelisted, coerced, truncated, redacted; paths reduced to `pathname` because query strings carry reset tokens and OAuth codes. Dependency-free, shared by the route and the browser reporter. `client-error-capture.tsx` mounts outside `AppShell`.

### Release notes & feature requests
Markdown with per-locale `release_note_translations`; public read `/api/release-notes`, authoring `/api/admin/release-notes`, optional MT via `translate.ts`. Feature requests: comments, one vote per user, pagination, admin status transitions; each action writes an `events` row and may send email. `COMMENTS_REQUIRE_LOGIN` / `VOTES_REQUIRE_LOGIN` gate anonymous paths.

## Data model
| Domain | Tables |
| --- | --- |
| Auth | `users`, `password_reset_tokens`, `user_roles`, `user_sessions` |
| Portfolio | `broker_connections`, `broker_connection_accounts`, `broker_connection_secrets`, `positions`, `manual_positions`, `portfolio_snapshots` |
| Jobs | `jobs`, `job_artifacts` |
| Feedback | `release_notes`, `release_note_translations`, `feature_requests`, `feature_request_comments`, `feature_request_votes` |
| Audit | `events` (user-owned, legitimate interest) |
| Analytics | `analytics_events` (not user-owned, consent-only, write-only) |
| Trading *(unapplied)* | `trading_accounts`, `trading_orders`, `trading_fills`, `trading_ledger_entries` |

Migrations are forward-only, applied in filename order. There is no migration runner and no `schema_migrations` table — applying DDL is a manual, verified act.

| | |
| --- | --- |
| `0007`–`0009` | Quant Updates email tables; `0017` drops them |
| `0018` | `users.google_sub` |
| `0019` | `user_sessions` — until applied, **every sign-in fails** |
| `0020` | `analytics_events` |
| `0021` | `portfolio_snapshots` — until applied the daily sweep fails, and each missed day is unrecoverable history |
| `0022` | trading tables — **must not be applied** before the `docs/trading-platform.md` §5 gate |

## Security & tenancy
- RLS is on (`0002_rls_policies.sql`) but server code uses the service-role key and bypasses it. RLS is defence-in-depth against direct/anon access; **the `user_id` filter is the authorization boundary**.
- That filter is structural. `app/lib/db/user-scope.ts` declares `USER_OWNED_TABLES` (`broker_connection_accounts`, `broker_connection_secrets`, `broker_connections`, `events`, `job_artifacts`, `jobs`, `manual_positions`, `portfolio_snapshots`, `positions`, `user_roles`, `user_sessions`) and exposes `userScoped(userId, table, options)`, injecting `user_id=eq.<id>` into reads/updates/deletes and stamping it onto inserts. Supplying your own `user_id`, an empty id, or an insert naming another owner throws. Cross-tenant work (queue drain, orphan recovery, retention) goes through `systemRequest(table, { reason, … })`.
- Auth routes are rate-limited per IP **and** per email (`app/lib/security/`) across `/login`, `/register`, `/forgot-password`, `/reset-password`; `/api/analytics/events` is IP-limited. Counters are in-process and must move to a shared store before running more than one instance.
- At rest: `scrypt` password hashes, hashed reset tokens, encrypted broker tokens. Sessions revocable server-side; forgery resistance still rests on `DISU_SESSION_SECRET`.

## Build gates (`scripts/check-delivery-readiness.mjs`)
`check:delivery` in CI, `check:delivery:strict` in `prestart` — a failing gate does not boot the server. No dependencies. Fails on:

1. Missing `docs/{deployment-policy,runbooks,synthetic-data-policy}.md`.
2. `.env.example` missing a delivery-critical key.
3. *(strict)* A missing runtime env var; under production, `QUANT_MOCK_FALLBACK_MODE`/`PRIMER_MOCK_FALLBACK_MODE` not `never`, `MARKET_MOCK_FALLBACK_MODE` set to anything but `never`, or `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE=1`.
4. `charCodeAt(` under `app/{dashboard,portfolio,quant,filings-primers}`.
5. A raw `supabaseRequest("<user-owned table>")` outside `userScoped()`/`systemRequest()`.
6. A `<column> references users(id)` in a live migration not declared in `personal-data.ts`.
7. An outbound `https://<host>` in `app/` (comments stripped) not in `subprocessors.ts` or `NON_DATA_HOSTS`; a `*COOKIE*` constant not in `cookies.ts`.
8. A consent-requiring category with any of `consent.ts`, `consent-provider.tsx`, `consent-banner.tsx`, `consent-tags.tsx` missing; a `DEFAULT_CONSENT` entry other than `necessary` set `true`; a banner with nothing wired to `rejectEverything`/`acceptEverything`; a footer with nothing wired to `openPreferences`.
9. *(strict, production)* Any `PENDING` field in `controller.ts`.
10. An ACCEPTED record in `docs/decisions/` with no `**Expires:**` date, or one past it. Within 21 days it warns.

## Environment
**Required**: `DISU_SESSION_SECRET`, `BROKER_TOKEN_ENCRYPTION_KEY`, `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`), `QUANT_PYTHON_BIN`, `PRIMER_PYTHON_BIN`.

**Fail-closed switches**: `QUANT_MOCK_FALLBACK_MODE`, `PRIMER_MOCK_FALLBACK_MODE`, `MARKET_MOCK_FALLBACK_MODE`, `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE`.

**Feature-flagged by presence**: `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (login page and `/profile` connect button self-hide without both); `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` (blank = hard off regardless of consent); `FINNHUB_API_KEY`; `ERROR_REPORT_WEBHOOK_URL`; `RESEND_API_KEY`; `TINK_*`.

**Retention knobs that are published statements**: `JOB_RETENTION_DAYS` (30), `JOB_ARTIFACT_RETENTION_DAYS`, `ANALYTICS_RETENTION_DAYS` (180) — each changes text in `retention.ts`.

**Other**: `PORTFOLIO_SNAPSHOT_SWEEP_INTERVAL_MS` (6h, floor 1min), `PORTFOLIO_DISPLAY_CURRENCY` (SEK), `PASSWORD_BREACH_CHECK`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_ALLOWLIST_EMAILS`, `COMMENTS_REQUIRE_LOGIN`, `VOTES_REQUIRE_LOGIN`, `JOB_IDEMPOTENCY_WINDOW_HOURS`, `JOB_RECOVERY_*`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `SEC_USER_AGENT`, `REDDIT_*`. `WEEKLY_EMAIL_FROM` survives only as a legacy fallback for the reset from-address.

`.env.example` is key-names-only and checked by the gate. Runtime validation is centralized in `app/lib/runtime/env.ts` (`ensureRuntimeEnv()`), called from `app/layout.tsx`.

## Verification
`npm run ci` = `lint` → `typecheck` → `test:unit` → `test:smoke` → `check:delivery`.

`node:test` with `--experimental-strip-types` and `--import ./tests/support/alias-hooks.mjs` (resolves the `@/*` alias) — no test framework. `tests/support/fake-supabase.ts` is an in-memory PostgREST stand-in for store-layer tests. Smoke tests need live Supabase credentials and skip without them. Test files are enumerated in `package.json`, not globbed.

## Known constraints
- Job worker is in-process and non-distributed; auth and analytics rate-limit counters share that assumption.
- No paid provider covers the actual universe. Finnhub 403s Nordic quotes, FX, all dividends and Nordic earnings on the current plan, so Yahoo's unofficial endpoints are a single point of failure for most of a Swedish portfolio; the terminal fallback is a flagged placeholder, disabled in production. No screener at any tier here — `/api/market/movers` ranks a declared 24-name universe.
- Tink is sandbox-verified only; production enablement pending.
- Google sign-in is coded and migrated but inert until the client id and secret are set.
- Trading is types, a state machine and an unapplied migration. Nothing is wired.
- `controller.ts` is entirely `PENDING` — the entity is unregistered, so `check:delivery:strict` will not boot production.
