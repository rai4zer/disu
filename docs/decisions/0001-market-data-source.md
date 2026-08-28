# 0001 — Market data source for M0

- **Status:** PROPOSED — needs your sign-off (see [Sign-off](#sign-off))
- **Date drafted:** 2026-08-27
- **Closes:** ROADMAP §2.7, and the M0 exit line in §2.8 ("Licensed market-data
  provider contracted **or** an explicit, written, time-boxed decision to launch on
  Yahoo with a documented switch plan")
- **Companion:** [market-data-providers.md](../market-data-providers.md) — the priced comparison

## Context

`docs/market-live-feed.md` records a confirmed blocker (2026-07-25): the Finnhub free
tier does not serve indices. `GET /quote?symbol=^OMX` returns *"Market data
subscription required for CFD indices"*, and `index/list` + `index/candle` are
paid-only. The Finnhub branch of the source chain in `app/api/market/indices/route.ts`
therefore never succeeds.

A later probe (2026-08-27, recorded in ROADMAP §2.7) found the gap is **wider than
indices**: `/quote EVO.ST`, `/quote VOLV-B.ST` and `/forex/rates` all return `403 — not
included in the plan`. Finnhub on this tier is a failover for US equities only. Yahoo is
therefore the sole source for most of a Swedish portfolio **and for every FX rate**,
which means it silently underpins the display total, not just the market strip. That
raises the stakes on everything below: an FX outage is a wrong number on the dashboard,
not a dash in a ticker.

Every price the product shows today comes from Yahoo's unofficial, undocumented
endpoints:

- **Indices** (`app/api/market/indices/route.ts`): Finnhub → Yahoo `v7/finance/quote`
  → Yahoo `v8/finance/chart` → last-known → static placeholder marked `stale: true`.
- **Per-symbol quotes and ticker search** (`app/lib/market/market-provider.ts`,
  `HybridMarketProvider`): Yahoo quote → Yahoo chart → `PlaceholderMarketProvider`.

These endpoints have no ToS grant for redistribution, no schema stability guarantee,
and undocumented rate limits. Risk R4 in ROADMAP §7 rates this High.

## Decision

**Launch M0 on the Yahoo endpoints, deliberately and with an expiry date, rather than
contracting a provider now.**

Rationale: pre-launch, at zero users, a €20–150/mo feed buys nothing that Yahoo does
not currently deliver, and the priced comparison shows no candidate that cleanly
covers *both* Nordic equities and the index set on a small budget without a
commercial-licence conversation. The cost of being wrong is bounded because the
provider seam already exists. What is *not* acceptable is the current state: Yahoo as
an accidental default that nobody has decided on and no alarm watches.

This decision therefore commits to three things, not one:

1. **Time box.** This decision expires on the date in [Sign-off](#sign-off). Past that
   date, either a provider is contracted or the expiry is explicitly extended in a new
   revision of this file. Silence is not an extension.
2. **Tripwires.** The conditions below force the switch before the expiry.
3. **Switch plan.** The work is scoped now, while it is cheap, so the switch is a
   two-day change and not a rewrite.

### Scope limit

This applies to M0 only (pre-launch and internal use). **Before the first paying user
or any public marketing of live prices, the licence question must be settled** — free
tiers at every provider surveyed are personal-use only, and Yahoo grants nothing.

## Tripwires

Any one of these fires the switch immediately, regardless of the expiry date.

| # | Condition | How it is detected today | Gap |
|---|-----------|--------------------------|-----|
| T1 | Sustained rate limiting — `source` is `fallback` or `stale: true` for >30 min in a trading session, or Yahoo returns HTTP 429 on >5% of attempts over a day | `/api/market/indices` already returns `source` and `stale` in its JSON | **Nothing watches them.** Needs the counter in W1 below |
| T2 | Schema change — a Yahoo response parses but yields no usable price, or the parse throws where it previously succeeded | Falls through to placeholder silently | Same gap as T1 |
| T3 | Any contact from Yahoo/Oath/Verizon Media about the endpoints, or a ToS change naming programmatic access | Human | — |
| T4 | First external paying user, or public marketing that claims live market data | Human | — |
| T5 | Expiry date reached | Calendar | Put it in your calendar, not just this file |

## Required work while on Yahoo (W1–W3)

These are not the switch — they are the price of choosing to stay on Yahoo. Without
W1 the tripwires are decorative.

- **W1 — Instrument the source.** Count outcomes per source (`finnhub`, Yahoo host,
  `yahoo-chart-fallback`, `fallback`) in `app/api/market/indices/route.ts` and in
  `HybridMarketProvider`, and alert through `ERROR_REPORT_WEBHOOK_URL` when the
  fallback rate crosses T1's threshold. Note `recordEvent()` in `app/lib/db/events.ts`
  is **not** the vehicle: it is user-scoped and takes a closed `AuditAction` union.
  This wants a process-level counter plus the existing webhook.
- **W2 — Tell the truth in the UI.** `app/components/market-strip.tsx` shows
  "Live" / "Delayed" off the `stale` flag. Yahoo data is not contractually live.
  Label it "indicative" or "delayed" and keep the source out of user-facing copy.
  §2.7 already calls for a "delayed 15 min" label; adopt it now rather than at switch.
- **W3 — Keep the seam honest.** The indices route bypasses `MarketProvider` entirely
  and reimplements its own chain. That is two places to swap instead of one. Either
  route indices through the provider interface or note the duplication at the top of
  both files.

## Switch plan

When a tripwire fires or the expiry lands:

1. **Pick from** [market-data-providers.md](../market-data-providers.md). Decide
   delayed vs real-time first — delayed is materially cheaper and §2.7 already accepts
   it for everything before M6.
2. **Implement one class** against the existing `MarketProvider` interface in
   `app/lib/market/market-provider.ts` (`searchTickers`, `getQuote`). Register it in
   the `getMarketProvider()` factory behind an env var — e.g.
   `MARKET_PROVIDER=hybrid|<name>` — so rollback is a config change, and add the new
   key to `.env.example` per `docs/deployment-policy.md`.
3. **Add the same provider as a branch in the indices route's source chain**, ahead of
   the Yahoo branches (see W3 — if W3 was done, this step disappears).
4. **Keep Yahoo as the fallback tier**, not the primary. It is a fine degraded mode;
   it is a bad contract.
5. **Verify** against the symbol set that actually matters: the index list in
   `app/api/market/indices/route.ts` (OMXS30, DJI, NASDAQ, S&P 500, N225, FTSE, DAX,
   SSE, HSI) plus a Nordic equity, a US equity, and one FX pair. A provider that
   covers US equities but not `^OMX` is not a switch, it is a regression.
6. **Cache at the symbol level.** ~10k users watch maybe 800 distinct symbols; one
   fetch per symbol per interval, shared. The 45s TTL / 20s failure cooldown in the
   indices route is the pattern to extend, and it is per-process — a multi-instance
   deploy multiplies upstream calls by instance count, which matters once calls are
   metered and billed.
7. **Update** `docs/market-live-feed.md`, this file's status, and the §2.8 exit line.

## Consequences

- **Accepted:** prices may go stale or wrong-shaped without warning until W1 ships; no
  redistribution right; the switch cost is deferred, not removed.
- **Bought:** €0/mo through M0, and a decision that is written down, watched, and dated
  instead of implicit.
- **Rejected:** contracting now (pays for coverage no user consumes yet); building two
  live implementations up front, as §2.7's checklist suggests (the interface exists;
  the second implementation should be written against a provider actually chosen, not
  speculatively).

## Sign-off

Fill these in and set the status to ACCEPTED. Unsigned, this document does **not**
satisfy the §2.8 exit criterion — that line asks for an explicit decision, and an
undated draft is the same implicit default in nicer clothes.

- **Decided by:** _______________
- **Date accepted:** _______________
- **Expires:** _______________  ← suggested: first external user, or 3 months from
  acceptance, whichever comes first
- **Calendar reminder set:** ☐
