# disu-platform

DISU Platform is a Next.js + Python investor workspace for portfolio tracking, broker connectivity, sentiment, quant workflows, filings primers, weekly updates, and product feedback.

## Run locally
1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000`

## Avoid dev-server cache collisions
When `next dev` is running, use an isolated build output for validation builds:

- `npm run build:isolated`
- `npm run start:isolated`

These commands write to `.next-build` instead of `.next`, so your live dev server hot-reload state stays intact.

## Main surfaces
- `/dashboard`
- `/portfolio`
- `/placera`
- `/sentiment`
- `/quant`
- `/primers`
- `/help/release-notes`

Example `companyId` from local `company_ids.csv`:
- `9ea92aec-ec1d-46a4-9f5c-bcdbed76c85e` (avanza)

## Placera API route
- `GET /api/placera`
- Query params:
  - `companyId` (optional if `companyQuery` is provided)
  - `companyQuery` (optional if `companyId` is provided)
  - `postsPerCompany` (optional)
  - `commentsPageSize` (optional)

Returns merged JSON payload with posts and nested comments.

## Company ID helper script
- `placera_company_ids.py` can regenerate `company_ids.csv` by querying Placera search.

## Architecture
See `architecture.md` for current component, auth, pricing, and data-flow details.

## Quant + Primers setup
These pages run Python bridge scripts from `python/src/...` through Next.js API routes.

1. Create and populate `.env` in repo root:
```env
QUANT_PYTHON_BIN=/Users/anoyayousef/GitHub/finance-automation/python/.venv/bin/python
PRIMER_PYTHON_BIN=/Users/anoyayousef/GitHub/finance-automation/python/.venv/bin/python

# Primers user-agent for SEC requests (contact info is recommended by SEC)
SEC_USER_AGENT=YourAppName/1.0 (email@example.com)

# Optional fallback accepted by the Primers route
PRIMER_USER_AGENT=
REDDIT_USER_AGENT=

# Optional for LLM summarization in Primers UI
GROQ_API_KEY=
OPENAI_API_KEY=

# Optional: increase job timeout (milliseconds)
QUANT_JOB_TIMEOUT_MS=600000
PRIMER_JOB_TIMEOUT_MS=600000

# Optional: allow deterministic mock outputs when external network/dependencies are unavailable
# Defaults: enabled in non-production, disabled in production
QUANT_ALLOW_MOCK_FALLBACK=
PRIMER_ALLOW_MOCK_FALLBACK=

# Optional: requeue all running jobs on worker init (default 1 in single-worker mode)
JOB_RECOVERY_REQUEUE_ALL_RUNNING=1

# Optional: running-job recovery stale threshold (used when REQUEUE_ALL_RUNNING=0)
JOB_RECOVERY_RUNNING_STALE_MS=120000

# Optional retention cleanup for completed jobs/artifacts
JOB_RETENTION_DAYS=30
JOB_ARTIFACT_RETENTION_DAYS=30
```
2. Install Python dependencies:
```bash
cd python
./.venv/bin/pip install -r requirements.txt
```
3. Start app:
```bash
npm run dev
```

## Step 1 DB foundation setup
Auth users, broker connections, positions, and audit events are now DB-backed.

1. Create tables in Supabase Postgres using:
   - `db/migrations/0001_foundation.sql`
   - `db/migrations/0002_rls_policies.sql`
   - `db/migrations/0003_jobs_queue.sql`
   - `db/migrations/0004_jobs_stage_and_artifacts.sql`
   - `db/migrations/0005_jobs_idempotency.sql`
   - `db/migrations/0006_jobs_stage_timing.sql`
   - `db/migrations/0007_weekly_updates.sql`
   - `db/migrations/0008_rename_weekly_updates_table.sql`
   - `db/migrations/0009_weekly_updates_reliability.sql`
   - `db/migrations/0010_jobs_dismissed_state.sql`
   - `db/migrations/0011_broker_accounts_scope.sql`
   - `db/migrations/0012_broker_connection_secrets.sql`
2. Ensure required env vars exist in `.env`:
```env
DISU_SESSION_SECRET=replace-with-long-random-secret
BROKER_TOKEN_ENCRYPTION_KEY=replace-with-32-byte-random-secret
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<service-role-or-server-key>
QUANT_PYTHON_BIN=/absolute/path/to/python
PRIMER_PYTHON_BIN=/absolute/path/to/python

# Broker connectivity foundation (Tink)
TINK_CLIENT_ID=<tink-client-id>
TINK_CLIENT_SECRET=<tink-client-secret>
TINK_REDIRECT_URI=http://localhost:3000/api/brokers/tink/callback
TINK_AUTH_BASE_URL=https://link.tink.com/1.0/products/connect-accounts
TINK_API_BASE_URL=https://api.tink.com
TINK_SCOPE=accounts:read,investment-accounts:readonly
TINK_LINK_PRODUCTS=INVESTMENTS
TINK_MARKET=SE
```
3. Restart server after env or schema updates.

## Broker connection foundation (current state)
- Broker catalog now includes: `Swedbank`, `SEB`, `Handelsbanken`, `Nordea`, `Avanza`, `Nordnet`.
- Tink-backed providers become connectable when both `TINK_CLIENT_ID` and `TINK_CLIENT_SECRET` are set.
- Tink OAuth callback path: `/api/brokers/tink/callback` and account selection page: `/portfolio/accounts`.
- Avanza currently supports CSV import.
- Nordnet is listed, but direct API onboarding is pending.
