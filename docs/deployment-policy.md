# Deployment And Secrets Policy

## Environments
- `local`: developer machine, mock/offline fallbacks allowed.
- `staging`: production-like behavior, real services, non-customer data where possible.
- `production`: customer-facing, strict secrets and no debug defaults.

## Required env separation
- Keep separate secret sets per environment.
- Never reuse production secrets in local or staging.
- Do not commit `.env`; use `.env.example` for key names only.

## Minimum required variables
- `DISU_SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `QUANT_PYTHON_BIN`
- `PRIMER_PYTHON_BIN`
- `ERROR_REPORT_WEBHOOK_URL` (recommended in staging/prod; optional in local)
  - Receives both server errors and browser errors (`client_error`, see runbooks 7).
  - Reports are sanitised before they leave the process — no query strings, emails, tokens
    or IP addresses — but they still carry a `userId` for signed-in users and a stack trace.
    That makes the receiving service a processor: add it to `app/lib/legal/subprocessors.ts`
    and to the privacy notice **before** pointing this variable at it, not after.

## Secrets handling
- Store secrets in deployment platform secret manager (not repo, not CI plaintext).
- Rotate secrets on:
  - credential leak suspicion,
  - staff offboarding,
  - quarterly cadence for high-impact keys.
- Use least-privilege keys (scoped API keys where provider supports it).

## Production defaults
- `QUANT_MOCK_FALLBACK_MODE=never`
- `PRIMER_MOCK_FALLBACK_MODE=never`
- `PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE=0`

## Change control
- Every env var change must be tracked in PR notes:
  - key name
  - old/new behavior
  - rollout and rollback plan

## Release preflight
- Run `npm run check:delivery` in CI for docs + env template integrity and the
  synthetic-data guard (see `docs/synthetic-data-policy.md`).
- `npm run check:delivery:strict` runs automatically via the `prestart` script, so
  `npm start` refuses to boot a production process with a non-compliant env. Do not
  bypass it by invoking `next start` directly.
- Run `npm run check:delivery:strict` manually before a staging/prod rollout if the
  host starts the server by some means other than `npm start`.
