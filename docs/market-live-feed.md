# Market Strip — Live Feed Next Steps

## What was wired
`app/components/market-strip.tsx` now fetches real data instead of showing static `--`
placeholders:

- On mount it calls `GET /api/market/indices` and re-polls every 60s
  (`REFRESH_INTERVAL_MS`).
- It renders whatever `items` the endpoint returns (OMXS30, DJI, NASDAQ).
- The status dot/label is driven by the response `stale` flag: green + "Live"
  when fresh, amber + "Delayed" when the endpoint is serving fallback/last-known data.
- On any fetch error it keeps the last values and stays flagged "Delayed" — the
  strip never blanks out.

The endpoint (`app/api/market/indices/route.ts`) already existed and does the real
work. Its source chain, in order:

1. **Finnhub** (`FINNHUB_API_KEY`) — preferred.
2. **Yahoo quote** (`query1/query2.finance.yahoo.com/v7/finance/quote`) — no key.
3. **Yahoo chart** (`.../v8/finance/chart/...`) — no key, used when quote 401s.
4. **Last-known values**, then a static placeholder — response is marked `stale: true`.

The JSON response includes a `source` field (`finnhub` | `yahoo-chart-fallback` |
`fallback` | a Yahoo host) that tells you which path served the data.

## What you need to do to get the live feed going

### 1. Local development
A `FINNHUB_API_KEY` is already present in your local `.env` (gitignored, not committed),
so the live feed should work locally already. To confirm:

```bash
npm run dev
# then in another shell:
curl -s http://localhost:3000/api/market/indices | jq '{source, stale, items}'
```

- `source: "finnhub"` → live feed working via Finnhub.
- `source: "yahoo-chart-fallback"` or a Yahoo host → Finnhub failed, Yahoo is covering.
- `source: "fallback"` with `stale: true` → no upstream reachable; check the key/network.

If you change `.env`, restart the dev server (env is read at process start).

### 2. Production / staging
The key is **not** committed (it's in gitignored `.env`). For any deployed environment
you must set it in that environment yourself, per `docs/deployment-policy.md`:

- Add `FINNHUB_API_KEY` to the deployment platform's **secret manager** (not the repo,
  not CI plaintext).
- Use a **separate key per environment** (policy: "Keep separate secret sets per
  environment").
- Restart the app process after the env change (see `docs/runbooks.md`).
- Record the env-var change in the PR notes (policy requires every env-var change to be
  tracked there).

### 3. Add the key name to the env template — DONE
`.env.example` now exists at the repo root with key names only (no values), including
`FINNHUB_API_KEY=` and every var the app reads. `npm run check:delivery` passes.

### 4. Rotate the local key if it has ever been shared
The value currently in `.env` is a working Finnhub token. If that file was ever pasted,
screenshotted, or shared, rotate the key in the Finnhub dashboard and update each
environment's secret.

## Recommended follow-ups (not required for "live")

- **Server-side caching. — DONE.** `app/api/market/indices/route.ts` now holds an
  in-memory cache: successful upstream payloads are reused for `CACHE_TTL_MS` (45s) across
  all viewers, and after a failed attempt it serves last-known values for
  `FAILURE_COOLDOWN_MS` (20s) instead of re-hitting a rate-limited upstream. Verified:
  rapid repeat requests return one shared `asOf`. This is per-process in-memory only —
  a multi-instance deploy caches per instance (fine for this low-cardinality endpoint).
- **Finnhub free-tier limits — CONFIRMED BLOCKER (2026-07-25).** The current key's plan
  does **not** cover indices: `GET /quote?symbol=^OMX` returns
  `"Market data subscription required for CFD indices."`, and `index/list` + `index/candle`
  are paid-only. So the Finnhub path can never serve OMXS30/DJI/NASDAQ on this plan — the
  strip is currently living entirely off the Yahoo fallback. To make Finnhub the real
  primary you must upgrade the plan; otherwise treat Yahoo as the de-facto source and keep
  a close eye on the 429s.
- **Yahoo fallback is undocumented.** It works today but can break or rate-limit without
  notice. Treat it as a stopgap, not a guaranteed source — Finnhub should be the primary.
- **Verify recovery** using the runbook: after fixing the key, confirm `source` flips back
  to `finnhub` (or `yahoo-chart-fallback`) and the strip shows green "Live".

## Finnhub coverage, measured 2026-08-27

The provider chain in `app/lib/market/market-provider.ts` is Yahoo → Finnhub →
(placeholder, only where `MARKET_MOCK_FALLBACK_MODE` permits). Probed directly
against the live API with the configured key:

| Call | Result |
|---|---|
| `/quote?symbol=AAPL` | 200, real data |
| `/quote?symbol=EVO.ST` | 403 — "You don't have access to this resource." |
| `/quote?symbol=VOLV-B.ST` | 403 |
| `/forex/rates?base=USD` | 403 |

**Finnhub is currently a failover for US equities only.** Nordic tickers and
every FX rate still depend on Yahoo alone, which is the majority of what a
Swedish portfolio needs and the entire basis of the SEK display total (D5).

This extends the blocker already recorded above: the free tier was known not to
serve OMXS30/DJI/NASDAQ, and it also does not serve Nordic single names or FX.

What this means in practice:

- The failover is real and correct, and starts covering more the moment the plan
  does. No code change is needed to benefit from an upgrade.
- Until then, a Yahoo outage or rate-limit means Nordic holdings return no price
  at all in production (`MARKET_MOCK_FALLBACK_MODE` defaults to `never` there),
  and the UI says "No price" rather than inventing one.
- Pricing a paid tier that covers Nordic equities + FX is the open item in
  ROADMAP §2.7 / D2, and this table is the evidence for what it has to cover.
