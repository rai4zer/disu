# Architecture

## Purpose
This repository is a unified investor workflow app built with Next.js (App Router) plus Python modules. It consolidates:
- Authentication and protected dashboard
- Portfolio/broker connection and holdings ingestion
- Placera forum fetch + rule-based NLP sentiment
- Quant inference via Python bridge
- SEC filings primer generation (PDF + inline transcript) via Python bridge + LLM
- Shared broker-style UI shell (left nav + top market bar + theme support)

## High-level runtime
1. User authenticates via `/auth/login` (session cookie `disu_session`).
2. Middleware gates protected pages and API routes.
3. Dashboard (`/dashboard`) links into Portfolio, Sentiment, Quant, and Primers.
4. Frontend pages call internal Next API routes.
5. Quant and Primers API routes spawn Python modules under `python/src/...` and return JSON results.

## Web app modules

### Auth and session
- `app/api/auth/register/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/api/auth/me/route.ts`
- `app/lib/auth/session.ts`
- `app/lib/auth/users.ts`

Behavior:
- Session token is HMAC-signed and stored in `disu_session` cookie.
- User records are persisted in Supabase (`users` table).

### Route protection
- `middleware.ts`

Protected surfaces:
- Pages: `/dashboard`, `/portfolio`, `/quant`, `/primers`, `/sentiment`, `/placera`  
  Legacy redirect kept: `/filings-primers -> /primers`
- APIs: `/api/brokers/*`, `/api/portfolio/*`, `/api/quant/*`, `/api/filings-primers/*`

### Dashboard and pages
- `app/dashboard/page.tsx`
- `app/portfolio/page.tsx`
- `app/sentiment/page.tsx`
- `app/placera/page.tsx`
- `app/quant/page.tsx`
- `app/primers/page.tsx`
- `app/filings-primers/page.tsx` (redirect shim)
- `app/components/ticker-autocomplete.tsx` (shared ticker/company suggestions input)
- `app/api/tickers/search/route.ts` (ticker/company symbol lookup API)

Dashboard operating model:
- Portfolio is the base context.
- Sentiment, Quant, and Primers are analysis branches.

### Shared shell and theming
- `app/components/app-shell.tsx`
- `app/components/market-strip.tsx`
- `app/components/theme-toggle.tsx`
- `app/components/workspace.tsx`
- `app/globals.css`

Behavior:
- Protected pages render inside a shared shell:
  - Left vertical nav (`Portfolio`, `Sentiment`, `Quant`, `Primers`) with icon-over-label tiles.
  - Brand block in sidebar (`DISU` + cuneiform glyph).
  - Top market strip with placeholder indices and compact controls.
- Top strip right controls:
  - Authenticated shell: theme toggle + `Sign out`.
  - Homepage (`/`): same strip style/indent + theme toggle + `Sign in`.
- Sidebar divider and layout are grid-based (not sticky-locked to `100vh`), so long content pages extend cleanly without divider cutoff.

### Portfolio and brokers
- `app/api/brokers/route.ts`
- `app/api/brokers/connect/route.ts`
- `app/api/brokers/[connectionId]/complete/route.ts`
- `app/api/brokers/[connectionId]/sync/route.ts`
- `app/api/brokers/avanza/import/route.ts`
- `app/api/portfolio/positions/route.ts`
- `app/lib/brokers/store.ts`
- `app/lib/brokers/adapters/*`
- `app/lib/brokers/avanzaCsv.ts`

Behavior:
- Broker connections and positions are persisted in Supabase (`broker_connections`, `positions`).
- Avanza CSV import is supported.
- List/sync endpoints return normalized positions for portfolio views.

### Placera sentiment fetch
- `app/api/placera/route.ts`
- `app/placera/types.ts`

Flow:
1. Resolve company id from query (if needed).
2. Fetch posts within fixed lookback (`90` days), paginated.
3. Fetch comments/replies per post with pagination + dedupe guards.
4. Flatten to `entities` (`post` + `reply`) and dedupe repeated content.
5. Compute rule-based NLP sentiment (EN+SV lexicon, phrase patterns, negation/intensifier handling, contrast handling).
6. Return:
   - aggregate sentiment (`score`, `label`, `band`, `badge`, `confidence`, `distribution`)
   - per-entity sentiment (`sentiment_score`, `sentiment_bucket`)
   - window metadata (`lookback_days`, `window_start`, `window_end`).

UI model (`app/placera/page.tsx`):
- Fixed window input model (no user sample-size controls).
- Shared ticker/company autocomplete (`AAPL` or `Apple` style input), with local + API-backed suggestions.
- Overview badge states:
  - `Armageddon`, `Strong Bear`, `Bear`, `Neutral`, `Bull`, `Strong Bull`, `Euphoria`.
- Three fixed-height scroll lanes for `Positive`/`Neutral`/`Negative` entities.
- Animated badge glyphs and distribution summary.

## Quant bridge architecture

### Next.js side
- `app/quant/page.tsx`
- `app/api/quant/infer/route.ts`

Request:
- `POST /api/quant/infer`
- body: `{ ticker: string, retrain?: boolean }`

Route behavior:
- Validates ticker format.
- Spawns Python: `-m src.quant.web_infer`.
- Parses JSON from last stdout line.
- Returns prediction rows per horizon + historical series (`open/high/low/close/adj_close/dividends`) + filing report markers (`10-K`/`10-Q`).

Quant UI model (`app/quant/page.tsx`):
- Shared ticker/company autocomplete (`AAPL` or `Apple` style input), with server-side symbol resolution fallback before run.
- Interactive horizon chips (`1d`-`10d`) with animated projection transitions.
- Default selections on run:
  - timeline range defaults to `1 week`
  - horizon defaults to `1d` when available (fallback to strongest-confidence horizon otherwise)
- Historical price chart with:
  - chart style/tool menu (`Sharp`, `Smooth`, `Candlestick`, `OHLC`, `High/Low`, `Reports`, `Dividends`, `Grid`)
  - hover crosshair + date/price tooltip context
  - corrected hover/index mapping (pointer + crosshair + value alignment based on historical span only)
  - ghost trail for previous projection on horizon switch
  - mountain/area fill under line in line modes
  - report/dividend point markers with hover tooltips
  - timeline range selectors below chart:
    - `1 day`, `1 week`, `1 month`, `3 months`, `This year`, `1 year`, `3 years`, `5 years`, `Max`
- In-form loading state with centered orbiting-dot animation.
- Results reset immediately when running a different ticker (prevents stale chart/table during new run).
- User-facing model artifact path is hidden (no model path rendering in UI metadata).
- Quant table:
  - Added `Expected Return` column (displayed after `Implied Price`) with rank badge and compact strength bar.
  - Table columns are fixed-width/evenly distributed; expected-return sublayout is fixed so bars align row-to-row.
  - Table area is independently scrollable with sticky header (chart remains connected above).

Runtime/env details:
- Python binary: `QUANT_PYTHON_BIN` fallback `PRIMER_PYTHON_BIN` fallback `python3`.
- Timeout: `QUANT_JOB_TIMEOUT_MS` (default `600000`).
- Sets `PYTHONUNBUFFERED=1`.
- Sets `MPLCONFIGDIR` to writable dir (`python/.mplconfig`) if not explicitly set.

### Python side
- `python/src/quant/web_infer.py` (JSON bridge entrypoint)
- `python/src/quant/predict.py` (core inference/train/load logic)
- `python/src/quant/model.py`, `data.py`, `features.py`, `fundamentals.py`, `config.py`

Bridge payload shape (current):
- `rows`: per-horizon inference table.
- `history`: full available adjusted-close history (frontend filters to selected timeline windows).

Artifacts:
- Models saved under `python/models/` (ignored in git).

## Primers architecture

### Next.js side
- `app/primers/page.tsx`
- `app/filings-primers/page.tsx` (redirects to `/primers`)
- `app/api/filings-primers/run/route.ts`
- `app/api/filings-primers/pdf/route.ts`

Requests:
- `POST /api/filings-primers/run`
- body: `{ ticker: string, llmProvider?: "none" | "openai_compatible" }` (LLM is forced server-side to `openai_compatible`)
- `GET /api/filings-primers/pdf?file=<filename.pdf>`
- `GET /api/filings-primers/pdf?file=<filename.pdf>&download=1` (attachment download)

Route behavior:
- Validates ticker.
- Accepts plain-language company input in UI and resolves to ticker before submit.
- Spawns Python: `-m src.filings.web_primer`.
- Returns PDF metadata + inline primer transcript (`primer_text`) for chat-style rendering.
- Uses result caching for already-generated tickers (serves latest cached PDF + transcript when available).
- Cache auto-invalidates if primer rendering code changed (prevents serving stale watermark/layout artifacts).
- PDF route serves files from `python/primers/` with filename/path validation.

Runtime/env details:
- Python binary: `PRIMER_PYTHON_BIN` fallback `QUANT_PYTHON_BIN` fallback `python3`.
- SEC user-agent fallback order:
  - `SEC_USER_AGENT`
  - `PRIMER_USER_AGENT`
  - `REDDIT_USER_AGENT`
- Timeout: `PRIMER_JOB_TIMEOUT_MS` (default `600000`).
- Primer result cache toggle:
  - enabled by default
  - set `PRIMER_DISABLE_RESULT_CACHE=1` to force fresh runs
- Sets `PYTHONUNBUFFERED=1`.
- Sets `MPLCONFIGDIR` to writable dir (`python/.mplconfig`) if not explicitly set.

### Python side
- `python/src/filings/web_primer.py` (JSON bridge entrypoint)
- `python/src/filings/cli.py` (orchestration)
- `python/src/filings/edgar.py` (SEC fetch + caching)
- `python/src/filings/extract.py`, `parse.py`, `chunk.py`, `segments.py`
- `python/src/filings/statements.py`, `normalize.py`, `analysis.py`
- `python/src/filings/llm.py`, `prompts.py`
- `python/src/filings/pdf_report.py`

Artifacts:
- SEC/cache intermediates in `python/filings_cache/` (ignored in git).
- Final PDFs in `python/primers/` (ignored in git).
- Canonical web transcript alongside filing cache (`primer_web.txt`) used by web UI to mirror PDF-rendered sections.
- PDF branding:
  - centered tilted `DISU` watermark
  - top-right DISU logo mark per page

## Environment variables

Core runtime:
- `DISU_SESSION_SECRET`
- `QUANT_PYTHON_BIN`
- `PRIMER_PYTHON_BIN`
- `QUANT_JOB_TIMEOUT_MS`
- `PRIMER_JOB_TIMEOUT_MS`
- `MPLCONFIGDIR` (optional override)

Primers/LLM:
- `SEC_USER_AGENT` (recommended)
- `PRIMER_USER_AGENT` (fallback)
- `REDDIT_USER_AGENT` (fallback)
- `GROQ_API_KEY` or `OPENAI_API_KEY` for LLM summarization
- `GROQ_MAX_INPUT_TOKENS` (default `6000`, temporary input cap guard)
- `GROQ_MAX_OUTPUT_TOKENS` (default `1200`, temporary output cap guard)
- `PRIMER_DISABLE_RESULT_CACHE` (`1` disables cached primer results)

Other values present in repo workflows:
- `SUPABASE_URL`, `SUPABASE_KEY`
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`

## Storage model and constraints
- Auth, broker connections, and positions are DB-backed (Supabase Postgres).
- Python model/cache/pdf outputs are local filesystem outputs.
- Jobs are DB-backed and recoverable across restarts.

## Current project structure (high-level)
- `app/` (Next.js App Router pages, APIs, UI, auth, brokers)
- `python/src/quant/` (quant pipeline and inference bridge)
- `python/src/filings/` (filings ingestion, synthesis, and PDF bridge)
- `middleware.ts` (auth gate)
- `README.md` (setup)
- `architecture.md` (this document)

## Suggested next steps (resume options)

### Option 1: Production data/state foundation (recommended first)
1. Move auth users, broker connections, and positions from in-memory stores to durable DB (Supabase Postgres).
2. Add migrations and typed data access layer.
3. Add basic audit/event table for key actions (login, sync, run quant, run primer).
4. Add environment validation on startup (required keys, python binary paths).

#### Option 1 implementation conditions (definition of ready)
- Supabase project is provisioned and reachable from local/staging runtime.
- Required env vars exist and are documented (`SUPABASE_URL`, `SUPABASE_KEY`, session secret, python bin vars).
- Data ownership is decided per table (`user_id` scoping) and Row Level Security strategy is defined.
- Current in-memory schemas are mapped to SQL schemas (users, broker_connections, positions).
- A rollback plan exists (read-only fallback to old in-memory adapters during cutover window).

#### Option 1 execution steps (recommended order)
1. **Schema + migrations**
   - Create SQL migrations for `users`, `broker_connections`, `positions`, and `events`.
   - Add indexes for common filters (`user_id`, `broker`, `status`, `updated_at`).
   - Add FK constraints + cascade behavior where intended.
2. **Typed data access layer (DAL)**
   - Implement repository modules in `app/lib/...` for each domain object.
   - Keep API handlers free of raw SQL; only call typed repository functions.
   - Add a strict DTO boundary between DB rows and API payloads.
3. **Auth + session persistence migration**
   - Replace in-memory user store with DB-backed auth lookup/create flows.
   - Preserve current session cookie contract to avoid frontend changes.
4. **Broker + positions migration**
   - Replace in-memory broker/positions stores with DB repositories.
   - Keep route-level behavior identical (`/api/brokers`, `/api/portfolio/positions`, sync/import endpoints).
5. **Audit events**
   - Write events for `login`, `broker_connect`, `broker_sync`, `quant_run`, `primer_run`.
   - Include `user_id`, action name, status, duration, and a compact metadata JSON blob.
6. **Startup/runtime validation**
   - Add env validation during server startup; fail fast with actionable error messages.
   - Validate python binary paths exist and are executable.
7. **Cutover + verification**
   - Run smoke tests on login, connect, sync, and holdings render.
   - Validate no behavior regressions in portfolio/quant/primers entry flows.

#### Option 1 acceptance criteria (definition of done)
- No in-memory stores are used for auth, broker connections, or positions in production paths.
- All related API routes operate against Postgres through typed repositories.
- Audit event rows are created for the five key actions.
- Startup fails fast when required env vars are missing or invalid.
- Manual smoke test checklist passes in local and staging.

### Option 2: Job orchestration and reliability
### Option 2 implementation status (complete for current scope)
- Implemented DB-backed `jobs` queue with statuses (`queued`, `running`, `succeeded`, `failed`) and retry metadata.
- Quant and Primers endpoints now enqueue jobs and return a `jobId` immediately.
- Added `GET /api/jobs/{jobId}` status endpoint for polling.
- Added `GET /api/jobs/recent` for resumable job discovery.
- Quant and Primers pages now poll job status instead of waiting on long request threads.
- Quant and Primers pages persist active `jobId` in local storage and offer "Resume job" after relogin/reload.
- Added retry loop in processor (`max_attempts`) with classified error codes.
- Added orphan-job recovery on worker init:
  - resumes due `queued` jobs
  - requeues orphan `running` jobs after restart in single-worker mode
- Added dedup policy: reuse active `queued/running` job for same `user+ticker+kind`.
- Added idempotency-key support for submitted jobs (`x-idempotency-key` or `idempotencyKey` body field).
- Added progress stage field (`stage`) in jobs lifecycle and API (`queued` -> `fetching` -> `running` -> terminal).
- Added artifacts persistence via `job_artifacts` table and artifact extraction on successful runs.
- Added `GET /api/jobs/{jobId}/artifacts` endpoint and surfaced artifact metadata in Quant/Primers result views.
- Added `POST /api/jobs/{jobId}/cancel` and `POST /api/jobs/{jobId}/retry` endpoints; Quant/Primers resume cards now expose cancel/retry controls.
- Added queue lifecycle test file for retry/recovery stage logic (`tests/jobs-queue-lifecycle.test.ts`).
- Added DB-backed integration tests for jobs/artifacts constraints (`tests/jobs-queue-db.integration.test.ts`, env-gated).
- Added API-level integration test scaffold for jobs routes (`tests/jobs-api.integration.test.ts`, env-gated).
- Added stage timing metrics (`queued_ms`, `fetch_ms`, `run_ms`) exposed via jobs APIs.
- Added retention cleanup loop for stale terminal jobs and artifacts (`JOB_RETENTION_DAYS`, `JOB_ARTIFACT_RETENTION_DAYS`).
- Added deterministic offline/mock fallback for Quant and Primers in non-production unless explicitly disabled.
- Verified manually:
  - kill server mid-job -> restart -> recovered job proceeds and completes
- Current semantics: **at-least-once execution** (dedup limits concurrent duplicates but retries/recovery can still produce repeated side effects).

### Option 2 follow-up improvements (optional)
1. Add process-group termination on cancel for stronger child-tree cleanup across platforms.
2. Add retention analytics/monitoring (deleted rows count, cleanup duration, failure alerts).
3. Expand API integration tests to run automatically in CI with ephemeral Supabase or test project.
4. Consider idempotency-key expiration and replay protection window policy.

### Option 3: Primers and Quant quality hardening
1. Add input/output schemas for Python bridge payloads (strict validation both ways).
2. Add regression test fixtures:
   - Quant: deterministic sample inference snapshots.
   - Primers: sample filing extraction + PDF smoke snapshots.
3. Add feature flags for LLM provider/model selection and fallback behavior.
4. Add model/artifact versioning and display in UI.

### Option 4: UX + product polish
1. Add real market index feed in top strip (replace placeholders).
2. Add per-page empty/loading/error states with consistent design tokens.
3. Add saved user preferences (theme, default ticker, page defaults).
4. Add keyboard nav/accessibility pass and responsive QA.
5. Autocomplete interaction polish:
   - keep `Run` always visible/clickable when suggestion list is open
   - add collision-aware dropdown placement and bounded list behavior across Sentiment/Quant/Primers

### Option 5: Delivery readiness
1. Add CI pipeline for lint, typecheck, unit tests, and smoke API tests.
2. Add structured logs and error reporting (server + Python subprocess boundaries).
3. Add staging/prod env separation and secrets management policy.
4. Add runbooks: incident triage, failed job replay, cache cleanup, model refresh cadence.

## Weekly Quant Email Updates (sharp/short)
User request signal: "ge mig uppdateringar varje vecka på ett enkelt sätt" (simple weekly updates).

### Objective
- Deliver one concise weekly email per watched ticker with clear action context in under 20 seconds of reading time.

### Best-practice format
1. **Subject line**
   - Use strict structure: `{Ticker} weekly: {trend} | {top signal} | {risk flag}`.
2. **Top summary (2-3 bullets max)**
   - What changed this week, what it implies, what to watch next week.
3. **Minimal metrics block**
   - Last price, 1w change, model best horizon + implied price delta, confidence.
4. **Risk-first callout**
   - One explicit downside risk and one invalidation level/condition.
5. **Single action line**
   - `Action: Hold / Add small / Reduce / No-trade` with one sentence rationale.
6. **Consistent cadence**
   - Same weekday/time each week (e.g., Fridays 16:30 local exchange time).
7. **Token discipline**
   - Cap body length (~120-180 words), avoid jargon, avoid multi-paragraph prose.

### Content rules
- Prefer deltas over raw data dumps (what changed since last week).
- Keep confidence explicit (`Low/Medium/High`) and explain why in one clause.
- Include only one chart link or app deep-link per email to avoid noise.
- Avoid false precision (round prices/percentages reasonably).
- Include a lightweight disclaimer footer (not financial advice).

### Implementation notes for this repo
1. Add a `watchlists` table (`user_id`, `ticker`, `active`, `frequency`, `send_time`, `timezone`).
2. Add `email_subscriptions` table (`user_id`, `channel`, `enabled`, `locale`).
3. Add a weekly scheduler job that:
   - runs Quant snapshot for subscribed tickers
   - computes week-over-week deltas
   - builds compact email payloads
   - stores send results in `events` (`email_send` action).
4. Add an email template module with strict section limits (subject + fixed blocks).
5. Add `/dashboard` toggle UI for weekly updates (on/off + preferred weekday/time).
