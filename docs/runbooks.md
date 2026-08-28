# Runbooks

## 1) Market strip shows placeholders only
1. Open `/api/market/indices`.
2. Check `source` and `reason`.
3. If `source=fallback`:
   - verify `FINNHUB_API_KEY` is set in runtime environment,
   - restart app process after env changes,
   - verify outbound network/DNS from runtime.
4. Confirm recovery when `source` becomes `finnhub` or `yahoo-chart-fallback`.

## 2) Job stuck in queued/running
1. Open `/api/jobs/recent` for affected user/kind.
2. Check `status`, `stage`, `attempts`, and timings.
3. If `running` but no progress:
   - restart app worker process,
   - orphan recovery should requeue stale jobs.
4. If repeated failures:
   - inspect `error`, `errorCode`,
   - retry once via `/api/jobs/{jobId}/retry`,
   - escalate if same failure class repeats.

## 3) Quant or Primers failures after deploy
1. Validate env with startup logs (missing required vars fail fast).
2. Confirm Python binaries exist and are executable.
3. Run:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test:unit`
4. Check structured logs for:
   - `jobs.cleanup.failed`
   - bridge payload validation errors.

## 4) Retention cleanup health
1. Monitor logs:
   - `jobs.cleanup.ok`
   - `jobs.cleanup.slow`
   - `jobs.cleanup.failed`
2. If cleanup is slow:
   - increase DB resources or reduce retention window.
3. If cleanup fails:
   - inspect DB permissions and schema drift.

## 5) Portfolio history stopped recording
Every missed day is permanent — nothing can reconstruct what a portfolio was worth on a past
date — so treat a silent sweep as an incident rather than a backlog.
1. Monitor logs:
   - `portfolio.snapshot.sweep.ok` (expect `captured + alreadyCaptured` to equal `holders`),
   - `portfolio.snapshot.sweep.failed`, `portfolio.snapshot.failed`,
   - `portfolio.snapshot.sweep.truncated` (the user base outgrew one sweep's scan limit).
2. No `sweep.ok` line at all in 24h: the worker never started in that process. It is started by
   `/api/portfolio/positions` and the quant/primer routes — confirm the process is long-lived
   and has served one of them.
3. `nothingToRecord` climbing: holdings are being priced with placeholders, so nothing is
   eligible to record. Work runbook 1 — the history gap is a symptom, not the fault.
4. Rows missing for a date that has passed: they cannot be backfilled. Record the gap in the
   release notes rather than inventing values to fill it.

## 6) Model refresh cadence (Quant + Primers)
1. Trigger refresh on a fixed cadence (recommended weekly) and additionally after major data/schema changes.
2. Quant:
   - run one forced retrain for a representative ticker basket,
   - verify output schema and forecast invariants,
   - confirm `meta.modelVersion` reflects the intended version.
3. Primers:
   - run sample primer jobs with provider policy set to production defaults,
   - verify `meta.pipelineVersion`/`meta.llmModel`,
   - validate summary quality manually on at least 3 filings.
4. Record refresh evidence in release notes:
   - execution timestamp,
   - version values,
   - pass/fail outcome and rollback decision.

## 7) Client error spike
Browser errors reach the same sink as server errors: the page posts to
`/api/observability/client-error`, the route sanitises the report and logs it as
`client_error`, and `log.error()` forwards it to `ERROR_REPORT_WEBHOOK_URL`.
1. Group by `fingerprint`, not by message. One bug produces one fingerprint across users,
   deploys and bundle hashes; counting raw messages will make one regression look like fifty.
2. Read `path` and `kind` first:
   - `kind: "react"` with a `digest` — a render crash. The digest matches the server log line
     for the same failure; the user was shown the boundary in `app/error.tsx`.
   - `kind: "unhandledrejection"` — usually a failed `fetch` the page never handled.
   - `kind: "global"` — an uncaught throw outside React, with `source`/`line`/`column`.
3. Reports carry no query strings, emails, tokens or IP addresses by design
   (`app/lib/observability/client-error.ts`). If you need the user, use `userId`, which is
   present only for signed-in reports.
4. Volume is bounded on both sides: 8 distinct reports per page load, 30 requests per IP per
   minute. A spike therefore means more affected *clients*, never a retry loop — treat the
   count as a user count.
5. Silence is not proof of health. Confirm capture still works before concluding nothing is
   broken: `ClientErrorCapture` must be mounted in `app/layout.tsx`, and the endpoint must
   stay out of the middleware matcher (it is deliberately public — most client errors happen
   on signed-out pages).
