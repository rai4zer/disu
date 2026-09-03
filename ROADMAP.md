# DISU — Product Roadmap & Milestone Plan

> **Document type:** milestone-gated roadmap. Progress is measured by *gates with numeric
> exit criteria*, not by dates. A gate is closed when every exit criterion is met and
> verified — not when the code merged. Dates are estimates; gates are commitments.
>
> **Status:** v1 — 2026-08-19
> **Owner:** solo founder (one person, no team)
> **Companion docs:** `architecture.md` (how it works today), `docs/deployment-policy.md`,
> `docs/runbooks.md`, `docs/market-live-feed.md` (market-data reality check),
> `docs/trading-platform.md` (M6 scaffolding), `app/design-system.css` (the shared UI language)

---

## Now — the queue

*The only forward-looking list in this document. Everything below §0 is rationale: when an
item here is done, tick it here and write the finding in its § section. M0 is the only open
gate — 10 of its 16 blocking items are closed (§13).*

**Tree state 2026-09-03 (end of day):** `typecheck`, `check:delivery` (11 gates) and
`test:unit` (278/278) all green, and `next build` compiles — worth stating separately, because
`npm run ci` has no build step and the two were green-and-broken at the same time earlier today
(§5). 22 commits on `feature/product-surface-rework`, `main` untouched.

**A day of M0-adjacent work, honestly labelled.** Live market data, instrument pages, search and
the module-to-tab move are all §2.9 cut-list material — new pages and new modules — and they sit
on the branch for that reason. What *did* land on the M0 path: the shared quote cache (2.3), the
W1 counters (2.8), an eleventh delivery gate, and a latent write bug in `supabaseRequest()`.

### 0 — Broken now

Nothing. The quant mock snapshot hash drift that blocked `npm run ci`
(`tests/jobs-bridge-regression.test.ts`) no longer reproduces.

### 1 — External setup: accounts, keys, vendors (not code)

Nothing here moves by writing software. Three are M0 exit criteria.

| # | Item | Unblocks | § |
|---|---|---|---|
| 1.1 | Register entity → name controller (`legalName`, `registrationNumber`, `address`, `privacyEmail`, `supportEmail`) | `app/lib/legal/controller.ts` is `PENDING`; `check:delivery:strict` refuses a prod boot | §2.2 |
| 1.2 | Provision Google OAuth client → `GOOGLE_OAUTH_CLIENT_ID` / secret | Code and migration are live, inert without the vars | §2.3 |
| 1.3 | Commit hosting decision (D1: long-lived Node — Fly/Railway/Render, 1 instance) | All of block 3 | §2.5 |
| 1.4 | Pick alerting sink → `ERROR_REPORT_WEBHOOK_URL` (Discord/Slack now, GlitchTip/Sentry EU later) | Capture and fingerprinting already ship; nothing notifies a human | §2.6 |
| 1.5 | ~~Sign `docs/decisions/0001`~~ **done 2026-08-30.** Nothing left for you — tripwire T5 was going to be a calendar reminder, and is instead a build guard in `scripts/check-delivery-readiness.mjs`: past 2026-11-30 `check:delivery` exits 1, with a warning for 21 days before | Closed the §2.8 market-data line | §2.7 |
| 1.6 | Marketstack free key | Runs 2.1 — **lower priority since 2026-09-03**: the question it was going to answer (can anything cheap serve `^OMX`?) is answered, see 2.1 | §2.7 |
| 1.7 | EODHD B2B quote at ~10k users; ~~Finnhub ticket re: which tier serves `^OMX`~~ — the Finnhub half is moot, `^OMX` resolves through yfinance today. The EODHD half stands: this is about a *licensed* feed, which is a different purchase from a working one | Provider contract (D2) | §2.7 |
| 1.8 | DPAs: Google, Meta, LinkedIn | Consent gate is built; a DPA is a separate obligation | §2.2 |

A vendor goes into `app/lib/legal/subprocessors.ts` and the privacy notice **before** 1.4 points at it.

### 2 — Backend / data

| # | Item | Where | § |
|---|---|---|---|
| 2.1 | ~~Run `scripts/marketstack-omxs30-test.py`~~ **overtaken 2026-09-03.** The budget question is answered from the other end: yfinance resolves all 52 sweep symbols including `^OMX`, `GC=F`, `SEKUSD=X` and every `.ST` name, at zero cost. Marketstack was being evaluated to buy what we now have. **This does not close D2** — see 2.9 | `docs/market-data-providers.md` | §2.7 |
| 2.2 | Live market-data smoke test — every market test mocks the network, so nothing catches Yahoo changing its JSON shape | `tests/` | §2.7 |
| 2.3 | ~~Symbol-level shared cache~~ **done 2026-09-03** — `market_quotes` (0023, applied) plus a background sweep on the job-worker timer. 52 symbols, one spawn every 5 min, shared across every user and surviving a restart. The board and strip read Postgres, so no request pays the ~14s fetch. Not covered: a user's individual holdings, which fall through to the live tiers | `app/lib/market/quote-sweep.ts`, `quote-cache.ts` | §2.7 |
| 2.4 | Confirm snapshot rows are landing — the free tier auto-pauses and a paused day records nothing | `app/lib/portfolio/snapshots.ts`, runbook 5 | §13 |
| 2.5 | Migration runner + `schema_migrations` — nothing records what is applied, so a restore can silently roll the schema behind the code | `db/migrations/` | §13 |
| 2.6 | Uptime + synthetic check: `/api/market/indices` plus one authenticated route | — | §2.6 |
| 2.7 | Ops dashboard read once daily: WAP, signups, activation, errors, job failure rate, external-API failure rate | — | §2.6 |
| 2.8 | **W1 — instrument the market source.** *Half done 2026-09-03.* The counter exists: every sweep logs `market.sweep.completed` with requested/resolved/unresolved and a fallback rate, and crosses to `market.sweep.degraded` at a third. So the number to alert on is now recorded. **What is still missing is the alert** — it is a log line, and nothing pages a human. Blocked on 1.4 for the sink, and that is the whole remainder | `app/lib/market/quote-sweep.ts` | 0001 W1 |

| 2.9 | **Re-read decision 0001 against what shipped.** It was signed on the understanding that Yahoo priced equities and indices. It now also prices commodities, FX, crypto and every instrument page's fundamentals, news and analyst data — the same single point of failure carrying several times the load, and the expiry (2026-11-30) did not move | `docs/decisions/0001-market-data-source.md` | 0001 |
| 2.10 | Split the instrument-detail cache TTL. One hour is chosen for the fastest-moving section (news); financials and analyst estimates are re-fetched hourly for no reason | `app/lib/market/instrument-cache.ts` | — |

### 3 — Infra / deploy (gated on 1.3)

- [ ] Deploy config committed, documented in `docs/deployment-policy.md` — §2.5
- [ ] Set both `*_MOCK_FALLBACK_MODE=never` on the production host — the gate exists, the host does not
- [ ] Staging environment with its own secrets — §2.5
- [ ] Automated DB backups verified by an **actual restore test** — §2.5

### 4 — Design / frontend

The friction inventory of §9.8. Six rows are pure code.

| # | Item | Where |
|---|---|---|
| 4.1 | Rewrite B2B copy ("work email", "request demo") for consumers | `app/i18n/en.json` |
| 4.2 | First-run card + demo data for the empty post-signup dashboard | `app/dashboard/page.tsx` |
| 4.3 | Reorder the activation ladder — broker connect is shown before manual add | `app/portfolio/page.tsx:747` |
| 4.4 | Promote manual add out from behind a toggle to primary | `app/portfolio/page.tsx:1054` |
| 4.5 | Make average cost optional, prompt later | add-position form |
| 4.6 | ~~Open ticker pages to signed-out visitors~~ **done 2026-09-03** for instrument pages: `/instrument/*` and `/api/tickers/search` are public, and `/api/instruments` redacts by session rather than returning 401 (`app/lib/market/instrument-visibility.ts`). What a company *is* — description, sector, employees, chart, headlines — is public; valuation, financials and analyst coverage need an account. Enforced before serialisation, since hiding fields in a component still ships them in the JSON. **Still open:** `/learn` is already public, but primers now live as an asset tab behind auth | `middleware.ts` matcher |
| 4.7 | Logged-out value: public primers + a locally saved portfolio | landing page |
| 4.8 | Label market data — **regressed 2026-09-03**, the strip's provenance badge was removed and it now reads no `source`/`stale`/`asOf` at all, so nine index levels render with no indication of whether they are current or retained. Note the wording constraint: "delayed 15 min" is contractual language belonging to a licensed feed, so the label cannot name a figure until D2 is signed. Needs a home — tooltip, `aria-label`, or the market page | market strip |
| 4.9 | Full mobile pass | deferred to M2 |

### 5 — Housekeeping

- [x] Triage the uncommitted tree *(done 2026-09-03 — 16 commits on
      `feature/product-surface-rework`, verified green in an isolated worktree. Shelved rather
      than merged: §2.9 cuts new pages and new modules from M0, and all of it is that.
      `db/migrations/0022_trading_accounts.sql` is committed and still **unapplied**.)*
- [ ] `tsconfig.tsbuildinfo` is tracked but is a build artifact — gitignore it and untrack it,
      or it conflicts on every branch switch.
- [ ] **Add `next build` to `npm run ci`.** On 2026-09-03 a client component imported a module
      that reached `node:fs`, and the build failed with `UnhandledSchemeError` while
      `npm run ci` stayed green — `tsc --noEmit` cannot see a bundling error, and `ci` is
      `lint → typecheck → test:unit → test:smoke → check:delivery` with no build in it. So
      "CI green" and "the app does not build" were true at the same time. An eleventh delivery
      gate now walks every `"use client"` import graph and fails on any edge reaching
      `node:*`/`fs`/`child_process`, which catches that specific class in a second — but only a
      real build catches the class generally. Roughly doubles CI time; the call is yours.
- [ ] Decide whether the branch merges to `main` or waits for M0. It is 22 commits and growing,
      and the longer it runs the less "shelved deliberately" it is.

### Locked

M6 trading, gated by §8.3 and `docs/trading-platform.md`. `0022_trading_accounts.sql` is written
and **must not be applied** until that gate is met. Deeplinking (path 1) ships at M4/M5 first; if
it proves sufficient, not building the rest is the correct outcome.

---

## 0. How to use this document

1. **One gate at a time.** Do not start M2 work while M1 exit criteria are open. As one
   person, parallel milestones are how you end up with five half-features and no users.
2. **Every gate has a "Definition of Done" that is measurable.** "Onboarding improved" is
   not a criterion. "Median time from landing page to first holding visible < 90s, measured
   over the last 50 signups" is.
3. **Work the queue at the top; update the tracker in §13 weekly.** Tick boxes, write the actual number next to the
   target. Do not delete missed targets — the miss is the signal.
4. **The "Cut list" in each gate is binding.** It records what you decided *not* to build.
   Re-adding something from a cut list requires writing down what changed.
5. **Anything that is a legal or trust gate is marked 🔴 and blocks the milestone**, no
   exceptions, no "we'll do it before launch".

---

## 1. Strategy frame

### 1.1 What DISU is

A **calm, plain-language investment understanding layer** for ordinary people in the
Nordics. Not a broker, not a screener, not a Bloomberg terminal for hobbyists. The product
answers four questions a lay investor actually asks:

| Question | Surface today |
|---|---|
| *What do I own, and what is it worth?* | `/portfolio`, `/dashboard` |
| *What is the mood around it?* | `/sentiment`, `/placera`, `/api/news/feed` |
| *What is this company, in plain words?* | `/primers`, `/filings-primers` |
| *What could happen next, honestly?* | `/quant` |

That set is already coherent and unusually well-chosen. **Do not add a fifth question
before 10k users.** The existing four, executed beautifully, is the whole product.

### 1.2 What DISU is *not* (until M6)

- Not a place where money moves. No orders, no custody, no cash.
- Not an advice service. Projections are illustrations, never recommendations (see §7.2 —
  this is a real regulatory line, and `/quant` sits close to it).
- Not a social network. Community exists only as the feature-request board and Placera
  read-through.

### 1.3 The wedge

Incumbents in this market (Avanza, Nordnet, Placera) are **transactional and dense**. Their
UI assumes you already know what P/E means. The surge in retail interest brought in millions
of people who *don't*, and who currently bounce between a broker app, a forum, and Google.

DISU's wedge is **comprehension, not execution**: "you already own this — here is what it
actually is, in words you use." The compound calculator on the landing page is the single
best expression of the brand you have. Everything should feel like that.

Strategic consequence: **broker connectivity is the moat, not a feature.** Once a user's
holdings live in DISU with cost basis and history, DISU is the only place that can tell them
their true return. That is data gravity, and it is what makes 10k users defensible enough to
sell to advertisers.

### 1.4 Why a solo founder can win here

- The hard parts (Tink OAuth + token vault, job queue, SEC filings bridge, quant bridge)
  **are already built** — see `architecture.md`. Most competitors at this stage have a
  landing page.
- The market is small enough (Sweden ≈ 3M retail investors) that incumbents won't build a
  comprehension layer for it, but large enough that 10k users is ~0.3% penetration.
- Content-driven acquisition (primers, education, compound calculator) compounds without
  headcount.

### 1.5 North Star metric

**Weekly Active Portfolios (WAP)** — distinct users who (a) have ≥1 holding tracked and
(b) opened any authenticated page in the trailing 7 days.

Why this and not signups or MAU: advertisers and affiliates pay for *engaged users with
declared holdings*. A signup with no portfolio is worth ~nothing commercially and will churn.
WAP is the only number that simultaneously measures product value, retention, and revenue
readiness.

**Target ladder:** 25 (M1) → 300 (M2) → 1,000 (M3) → 2,500 (M4) → 6,000 (M5).

Note the gap: 10,000 *registered users* ≈ 6,000 WAP at a healthy 60% portfolio-connect rate.
Plan the funnel for 10k signups; sell the 6k.

### 1.6 Supporting metric set

| Metric | Definition | Why it matters |
|---|---|---|
| **TTFV** | Median seconds from landing-page arrival to first own holding rendered | The single best predictor of activation |
| **Activation rate** | % of signups with ≥1 holding within 24h | Gate on 60% |
| **W1 / W4 retention** | % of activated users active in week 1 / week 4 | Gate on 40% / 25% |
| **Connect rate** | % of activated users with a broker/bank connection | Drives moat + affiliate revenue |
| **Primer completion** | % of started primers read to end | Content quality proxy |
| **Cost per WAP** | monthly infra + data + LLM ÷ WAP | Must be < ad/affiliate ARPU by M5 |
| **Trust incidents** | count of wrong/fabricated numbers shown to users | Must be **0**. See M0. |

---

## 2. M0 — Foundation hardening 🔴 *(pre-launch, blocks everything)*

**Goal:** the app is safe, legal, honest, and observable enough to put in front of strangers.
Nothing in M0 is a feature. All of it is ship-blocking.

**Estimated effort:** 3–5 focused weeks. **§2.1 and §2.4 are closed**; §2.2 is down to
documents and the entity, and §2.3 to identity work. The remaining blockers are §2.2
(privacy policy, Terms, consent notice, entity), §2.3 (email verification, password floor,
Google), §2.5 (hosting), §2.7 (market data).

### 2.1 Trust: remove all fabricated user-facing numbers ✅ *(done 2026-08-20)*

**Was:** `app/dashboard/page.tsx:32` defined `stableDayMovePct()` — a hash of `symbol + date`
producing a deterministic pseudo-random daily move between -2.8% and +2.79%, rendered as
**"Daily Move"** with a currency amount and used to rank **"Best assets"** and **"Worst
assets"**. The same page also interpolated a monthly series between cost basis and current
value and drew it as portfolio history.

This was the highest-severity issue in the repo. A mass-market finance product that displays
invented performance figures as fact is not a bug — it is the one mistake you cannot recover
from reputationally, and in a consumer-finance context it is arguably misleading commercial
practice.

**Now:** the day move is real previous-close-vs-last (`previousClose` from Yahoo v7
`regularMarketPreviousClose` / v8 `chartPreviousClose`), carried through `QuoteSnapshot` →
`PortfolioPosition` → the positions routes. `computeDayChange()` returns `null` rather than a
number when the input is synthetic or has no previous close, and the dashboard renders an
explicit "Not available yet" panel instead. The fabricated sparkline is gone; real value
history starts when daily snapshots do (see the M0 checklist).

The wider find was that `PlaceholderMarketProvider` fabricates prices from a symbol hash and
`source: "placeholder"` was being **dropped at every API boundary** — a hash-derived price
rendered as a real quote with nothing marking it. The flag now survives to the UI.

- [x] Delete `stableDayMovePct` and every consumer of it.
- [x] Replace with real previous-close-vs-last data, or render an explicit "not available yet"
      state. An honest empty state beats a beautiful lie.
- [x] Audit every other surface for placeholder data paths reaching the UI. `architecture.md`
      notes market quotes fall back to "static placeholder" — that fallback must be **visibly
      labelled** or suppressed, never silently rendered as a price.
- [x] Set `QUANT_MOCK_FALLBACK_MODE=never` and `PRIMER_MOCK_FALLBACK_MODE=never` in prod, and
      make `check:delivery:strict` fail the deploy otherwise (policy exists in
      `docs/deployment-policy.md` — verify it is actually enforced). *Enforced via the
      `prestart` script; the prod env vars themselves still need setting on the host.*
- [x] Add a repo-wide rule: **any synthetic value that can reach a user must carry a
      `synthetic: true` flag through the API layer, and the UI must render it differently.**
      *Documented in `docs/synthetic-data-policy.md`, guarded by `check:delivery` and
      `tests/synthetic-data-policy.test.ts`.*

**Where it is enforced.** `QuoteSnapshot.synthetic` + `PortfolioPosition.synthetic` /
`priceSource` carry provenance; the dashboard shows a banner, the portfolio table a red
`placeholder` badge per row and a note on the total. `check:delivery` fails on `charCodeAt(`
under `app/dashboard`, `app/portfolio`, `app/quant`, `app/filings-primers`.
`check:delivery:strict` runs via `prestart`, so `npm start` refuses to boot a production
process with a non-compliant env.

**Residual — not closeable in code:**

- [ ] Set `QUANT_MOCK_FALLBACK_MODE=never` and `PRIMER_MOCK_FALLBACK_MODE=never` on the
      production host. The gate exists and fails closed; the host config does not exist yet
      because there is no host yet (§2.5).

### 2.2 Legal & compliance 🔴

You are processing financial holdings data of EU residents. This must be closed before a
single non-friend user signs up.

**Decision, 2026-08-27: DISU will run analytics and cross-site advertising** (GA4, Google Ads,
Meta Pixel, LinkedIn Insight). That closes the consent-free option §2.2 previously protected —
a real onboarding advantage, traded deliberately for measurement and paid acquisition. The
consequence is a genuine consent gate, built and enforced: `app/lib/legal/consent.ts` is the
model, `consent-tags.tsx` renders no vendor script until the visitor agrees *and* the
deployment configures an id, and refusal, withdrawal and expiry are covered by
`tests/consent.test.ts` plus a `check:delivery` guard. Accept and Reject are one click each at
equal prominence — that symmetry is a legal requirement, not a style choice, so a redesign
that makes one louder fails the build.

Nothing is live yet: no measurement ids are configured, and a blank id is a hard off switch.

- [x] **GDPR mechanics**: data export endpoint and account deletion that actually cascades.
      *Done 2026-08-25.* `app/lib/account/personal-data.ts` is the register — every table
      holding personal data, the column that links it to the person, and an erasure policy
      (`erase` / `anonymise` / `blocks`) with the reasoning written next to it. Export
      (`GET /api/account/export`) and erasure (`POST /api/account/delete`) both walk that
      register and never name a table themselves, so a table added there is covered by both
      automatically. `scripts/check-delivery-readiness.mjs` cross-references it against every
      `references users(id)` in `db/migrations/`, so **adding a table and forgetting the
      register is a build failure**, not a row that survives an erasure request.

      Three findings worth recording:
      - `release_notes.created_by` is `on delete restrict`, so an admin who authored a
        release note **cannot** be erased until authorship is reassigned. Previously this
        would have failed at the database mid-erasure; it is now detected up front and
        reported (`409` with the blocking table), and `GET /api/account/delete` lets a UI
        warn before the user commits.
      - Public board content (`feature_requests`, `feature_request_comments`) is anonymised
        rather than deleted — other people are reading and replying to those threads. Votes
        carry no content, so they are erased.
      - The export withholds credentials: password hashes, encrypted broker access tokens and
        reset-token hashes are keys to the account, not facts about the person. Metadata
        around them (provider, scope, expiry) is exported so nothing is hidden.

      Erasure asks for the password again — a borrowed laptop or a stolen cookie should not
      be able to destroy an account — and verifies afterwards that nothing survived.
- [ ] Register the entity and clarify whether the current activity is unregulated
      information provision (it should be, pre-M6 — see §7.2). 🔴 **This is now the only thing
      standing between the published `/legal` pages and them being in force** — the controller
      is `PENDING` in `app/lib/legal/controller.ts`, and `check:delivery:strict` refuses a
      production boot until it is named.
- [ ] **Data Processing Agreements for the advertising stack** 🔴 *(new, 2026-08-27)* — the
      consent gate is built and enforced (below), but a signed DPA with Google, Meta and
      LinkedIn is a separate obligation that consent does not substitute for. Meta's controller
      /joint-controller position on pixel data is the one to read carefully before launch.

### 2.3 Auth hardening 🔴

`app/api/auth/register/route.ts` creates a user and mints a session **with no email
verification**.

- [x] Rate-limit `/api/auth/login`, `/register`, `/forgot-password` (IP + email keyed).
      *Done 2026-08-25.* `app/lib/security/rate-limit.ts` is a sliding-window counter;
      `auth-rate-limit.ts` holds the per-route policy and applies it twice — once per client
      IP, once per email — because IP-only loses to credential stuffing and email-only loses
      to distributed spray. A successful sign-in clears the email bucket, and an exhausted IP
      bucket deliberately does **not** spend the email bucket, so a blocked attacker cannot
      lock a victim out for free. `/reset-password` is IP-keyed too (it presents a token, not
      an email). Covered by `tests/auth-rate-limit.test.ts` (13 cases, runs in `test:unit`).
      **Caveat:** counters are per-process. This is correct for one long-lived Node instance
      (D1 option A) and must move to a shared store before running more than one — the call
      sites do not change, only `rate-limit.ts` does.
- [ ] Email verification — but **do not block first use on it** (see §8.5). Verify
      asynchronously; gate only sensitive actions (broker connect, email change).
- [x] Breached-password check (k-anonymity range API) **and** a 10-char floor + blocklist.
      *Done 2026-08-27.* Both, because neither alone is enough: the range API is the broad net
      but needs the network, and length alone accepts `password12`.
      `app/lib/auth/password-policy.ts` is the local half — a 10-char floor, a 200-char
      ceiling (scryptSync on unbounded input is a CPU-burn primitive), a blocklist of common
      base words matched *after* folding the disguises people actually use (trailing digits,
      leetspeak, punctuation: `password2024`, `P@ssw0rd!!`, `Passw0rd2024` all resolve to
      `password`), and structural rejects for too-few-distinct-characters, straight keyboard
      runs, short all-digit strings (dates, personal numbers) and anything built out of the
      user's own email address. It is synchronous and dependency-free, so both forms import it
      and give the same verdict as the server before a round trip.
      `app/lib/security/pwned-passwords.ts` is the network half: SHA-1 the candidate, send the
      first **five** hex characters, match the suffix locally, `Add-Padding: true` so response
      size leaks nothing either. The plaintext and the full hash never leave the process.
      `app/lib/auth/password-guard.ts` combines them and is called by `createUser()` and
      `resetPasswordWithToken()`; rejections carry a stable code, so the forms render the
      reason in Swedish or English from one source of truth.
      **Fails open by design.** If the range API is down, the local half still applies and
      sign-up proceeds — a login page that breaks when a third party does is the worse
      failure. Every fail-open is logged (`auth.password_breach_check.failed`) so the rate is
      measurable rather than assumed. Switchable off with `PASSWORD_BREACH_CHECK=off`; off by
      default under `NODE_ENV=test`.
      **Existing accounts are unaffected** — nothing validates a password on sign-in, so an
      8-char password from the old rule keeps working and only meets the new floor on reset.
      The reset path checks the token *before* the breach lookup, so an anonymous POST cannot
      use us to make outbound calls. Covered by `tests/auth-password-policy.test.ts`
      (13 cases, runs in `test:unit`).
- [x] Session: confirm rotation on privilege change and add server-side revocation.
      *Done 2026-08-25; migration applied to production 2026-08-28.*
      `db/migrations/0019_user_sessions.sql` adds a session row per sign-in; the cookie now carries `sid` naming it. The signature still gates cheaply, but
      a valid signature is no longer sufficient — a row that is missing, revoked or expired
      kills the token. Consequences: **logout actually ends the session** rather than only
      clearing the browser's copy of a token good for another seven days; **a password reset
      revokes every existing session**, which is the whole point of resetting a password when
      you think you are compromised; and one device can be signed out without touching the
      others.

      Two things worth knowing. It cost no extra query on the API path —
      `getAuthenticatedSession()` already read the user row on every request. It *does* add
      one query per page render, because `app/layout.tsx` now performs the authoritative
      check rather than a signature check, so a revoked session cannot render the signed-in
      shell and only discover it is dead on the first API call. Signed-out visitors pay
      nothing. Middleware stays signature-only (Edge runtime, no database), but now rejects a
      token with no `sid`, so the two layers agree.

      **The client-side half of this, fixed 2026-08-28.** Moving the authoritative check into
      `app/layout.tsx` made `signedIn` a *server-rendered* value, and the App Router caches the
      RSC payload for shared layouts across a client-side navigation. `router.replace()` after
      a successful sign-in therefore rendered the layout computed *before* the cookie existed:
      the app landed on `/dashboard` wearing the signed-out chrome — "Skapa konto" in the nav,
      no module rail — while the page's own fetches returned real data, because the cookie was
      perfectly good. Sign-out already called `router.refresh()`; sign-in never did.
      `tests/auth-session-revocation.test.ts` now asserts that every client-side session
      transition refreshes as many times as it navigates, so the two halves cannot drift apart
      again. The general lesson is worth keeping: **a server-resolved auth flag is only as
      fresh as the last RSC fetch**, so any transition that changes who you are has to
      invalidate that cache explicitly.

      Expired session rows are pruned by the existing retention sweep. Sessions record *why*
      they ended (`signed_out`, `password_reset`), and deliberately store no IP, user agent or
      device label — that would be new personal data to declare, retain and erase for no
      benefit the revoke button does not already provide.
- [x] Close the two Google gaps flagged in `architecture.md`: no unlink UI, and a Google-only
      user must go through password reset to add a password.
      *Done 2026-08-27.* Both were the same missing thing — the app had no account-settings
      page at all — so the settings page is new, gated by middleware, and backed by
      `GET /api/account/security` (booleans only: does a password exist, is Google linked;
      never the hash, salt or `sub`). It shipped at `/account` as a link in the market strip
      next to Sign out; it is now **`/profile`, the "My Profile" module** in the sidebar rail,
      with `/account` kept as a redirect so a bookmark — or a Google OAuth round-trip whose
      signed `state` still carries the old `nextPath` — does not land on a 404. The API routes
      are unchanged and stay under `/api/account/*`.

      **Adding a password no longer routes through a reset email.**
      `POST /api/account/password` sets one in-session. For a Google-only account the
      Google-issued session *is* the authorisation — there is no current password to demand —
      and an account that already has one must prove it, because a borrowed laptop should not
      be able to change a password silently. Either way it runs the same
      `assertAcceptablePassword()` gate as registration, so the settings page is not a way
      around the 10-char floor and the blocklist. It then revokes every session and issues
      this browser a fresh one: a password change is what someone does when they suspect a
      leak, so leaving the other cookies alive would defeat it, while signing the current
      browser out as collateral would be a poor way to confirm success.

      **Unlink is `DELETE /api/account/google`, and is refused while it is the only way in.**
      An account with no password and no `google_sub` still has its email, so it is not lost
      forever — but its only route back would be the reset email, which is the indirection
      this page exists to remove. The UI shows *why* the button is unavailable rather than
      hiding it.

      **Linking is a first-class flow, not a re-run of sign-in.** The signed OAuth state now
      carries a mode: `/api/auth/google/start?mode=link` bakes the current user id into it,
      and the callback links only if the live session is still that same user, so a
      sign-out/sign-in mid-flow is refused rather than attaching Google to the wrong account.
      An unrecognised mode degrades to `signin`, the weaker flow. Because the session is the
      authorisation, an explicit link may attach a Google address that differs from the
      account email — but it refuses a `sub` another account owns, and refuses a Google
      address another account is registered under: `sub` is matched before email, so that
      second case would otherwise send the address's real owner into *this* account the first
      time they pressed "Sign in with Google".

      Covered by `tests/account-identity.test.ts` (8 cases, `test:unit`) plus link-mode state
      cases in `tests/auth-google.test.ts`. Account erasure still requires a password, but
      that is now two steps rather than a dead end.
- [ ] Provision the Google OAuth client and set `GOOGLE_OAUTH_CLIENT_ID` /
      `GOOGLE_OAUTH_CLIENT_SECRET`. The code is done and the button self-hides until both
      exist — this is the single cheapest onboarding win available and it is currently inert.

### 2.4 Data-access blast radius ✅ *(done 2026-08-25)*

**Was:** `architecture.md` §Security — RLS is enabled but every handler uses the service-role
key and therefore bypasses it. Authorization was *"every handler must scope queries by
`user_id` itself"*, which is one forgotten `.eq('user_id', …)` away from a cross-user leak.

**Now:** the filter is structural. `app/lib/db/user-scope.ts` exposes `userScoped(userId,
table, options)`, which injects `user_id=eq.<id>` into every read, update and delete and
stamps `user_id` onto every insert. You cannot express a query without it: passing your own
`user_id` filter throws, an empty user id throws (rather than rendering `user_id=eq.` and
quietly matching nothing), and an insert that names a *different* owner throws.

Genuinely cross-tenant work — the worker draining the queue, orphan recovery, retention
pruning — goes through `systemRequest(table, { reason, … })`, which is loud on purpose and
will not run without a written reason. That splits the job store cleanly: `updateJob()` stays
unscoped for the worker, and the new `updateJobForUser()` is what the cancel/retry/dismiss
routes call, so a guessed job id cannot be mutated even in the window between the read and
the write.

- [x] Write one integration test per user-scoped route that asserts user A cannot read user
      B's row. *Two layers.* `tests/cross-tenant-isolation.test.ts` drives the real store
      modules against an in-memory PostgREST stand-in (`tests/support/fake-supabase.ts`) and
      covers all nine user-owned tables — it runs in `npm run ci` on every commit, and
      removing the scoping from either code path (filter injection or insert stamping) fails
      it, which was verified by mutation rather than assumed.
      `tests/cross-tenant-routes.integration.test.ts` walks all thirteen routes that take a
      resource id in their path with Bob's id in Alice's session and asserts a non-2xx plus
      an unchanged row; it skips without a live app + Supabase, like the rest of `test:smoke`.
- [x] Introduce a typed helper (`userScoped(session, table, query)`) that makes the
      `user_id` filter structurally impossible to omit, and migrate handlers onto it.
      *All ~40 call sites across `brokers/store.ts`, `tokenVault.ts`, `jobs/store.ts`,
      `portfolio/manual-store.ts`, `db/events.ts` and `admin/access.ts` are migrated.*
- [x] Add a lint rule or CI grep that fails when a handler in `app/api/**` calls
      `supabaseRequest` on a user-owned table without the scoping helper.
      *`scripts/check-delivery-readiness.mjs` reads `USER_OWNED_TABLES` straight out of
      `user-scope.ts` so the two cannot drift, then fails the build on any raw
      `supabaseRequest("<user-owned table>")` under `app/`. Verified to exit 1 on a planted
      violation.*

**Deliberately out of scope, and still true:** `users`, `password_reset_tokens`,
`release_notes` and the `feature_requests` board are not user-scoped tables — the board is
public by design and the auth tables are read by anonymous callers before a session exists.
They are listed as exclusions in `user-scope.ts` rather than left unexamined.

**Residual:** `/api/filings-primers/pdf` serves any file in `python/primers` to any
authenticated user. Those are public SEC filings rather than user data, so this is not a
tenant leak — but if that directory ever holds per-user output it becomes one.

### 2.5 Hosting decision 🔴

**This is an architectural fork you must resolve before launch.** `architecture.md`:
the job queue is *"processed in the Next.js server process"* with *"module-level singleton
state scheduled with setTimeout/setInterval"*.

That model **cannot run on Vercel or any serverless host** — functions are frozen between
requests, so `setInterval` workers, orphan-job recovery, and retention pruning will not fire.
There is no `vercel.json`, `Dockerfile`, or any deploy config in the repo yet, so nothing is
committed either way.

Choose one:

| Option | Fit | Cost |
|---|---|---|
| **A. Long-lived Node host** (Fly.io / Railway / Render), 1 instance | Works today with zero code change. Vertical scaling to ~10k users is fine. | ~$20–50/mo |
| **B. Vercel + extracted worker** (separate always-on process or Supabase pg_cron/Edge Function) | Better DX and edge caching; requires pulling `processor.ts` out of the web process | ~$20/mo + worker |

**Recommendation: A now, B later.** Option A is one afternoon and unblocks launch. Revisit at
M4 when broker sync volume makes queue throughput a real constraint. Record the decision and
the revisit trigger.

- [ ] Decide, commit deploy config, document in `docs/deployment-policy.md`.
- [ ] Staging environment with its own secrets, per existing policy.
- [ ] Automated DB backups verified by an actual restore test — not just "backups are on".

### 2.6 Observability

You cannot improve a funnel you cannot see, and you have an `events` table plus
`recordEvent()` already — most of the pipeline exists.

- [x] **Product analytics**: done, and *not* by extending `recordEvent()` — that turned out to be
      impossible rather than merely awkward. `recordEvent()` writes through `userScoped()`, which
      cannot express a row without a user id, so `landing_view` and `signup_start` — the two
      numbers that tell you whether the funnel works — had nowhere to go. The fix is a second
      stream: `analytics_events` with a nullable `user_id`, a closed event taxonomy
      (`app/lib/analytics/funnel.ts`), a rate-limited client endpoint that accepts only the two
      pre-account events, and server-side recording for the seven that decide the metric. The
      full minimum set is live: `landing_view`, `signup_start`, `signup_complete`,
      `holding_added` (with `method`), `broker_connect_start`, `broker_connect_complete`,
      `primer_run`, `quant_run`, `session_start`. See `docs/funnel-events.md`.

      This intersects the consent work of §2.2 and inherits its rule rather than arguing with
      it: the privacy policy says consent is the *only* basis DISU uses for analytics, so no
      funnel row is written without it, on the server as well as the client, and
      `CONSENT_VERSION` is bumped to 2 because `analytics` now covers first-party measurement
      as well as Google's. The price is that the funnel only sees visitors who agreed — read it
      as a ratio between steps, never as a count of people.
- [ ] **Error monitoring**: client-side capture now exists — `app/error.tsx`,
      `app/global-error.tsx` and the global `error`/`unhandledrejection` listeners in
      `app/components/client-error-capture.tsx` post to `/api/observability/client-error`,
      which sanitises, fingerprints and puts them through `log.error()` and therefore
      `ERROR_REPORT_WEBHOOK_URL`. See runbook 7.
- [ ] **Pick an alerting vendor** — the remaining half of error monitoring, and the reason the
      row above is still open. `ERROR_REPORT_WEBHOOK_URL` points at nothing, so an error is
      today captured, sanitised and grouped, and then lands in a log nobody reads. What is
      missing is a destination that notifies a person and keeps history. The reports already
      carry a stable `fingerprint` to group on, so this is a procurement decision, not a code
      one. Prefer free or low-cost — at launch volume this is a €0–25/mo problem.

      | Option | Fit | Cost |
      |---|---|---|
      | **Slack/Discord incoming webhook** | Works today with zero code — the sink already POSTs JSON. But no history, no de-duplication over time, and it degrades into a channel people mute. | €0 |
      | **GlitchTip** (open source, Sentry-compatible API) | Real grouping and alert rules. Self-hostable beside the app under §2.5 option A, so no new processor and no user data leaving the host. Hosted plans exist if you would rather not run it. | €0 self-hosted / ~€15 hosted |
      | **Sentry, EU region** | Best grouping, release tracking and alerting. The free Developer tier (~5k errors/mo, one user) is plausibly enough at launch volume, and EU residency keeps §2.2 simple. | €0 → ~€25/mo |
      | **Better Stack** | Free tier, ingests plain webhooks, and would also cover the uptime check below — one vendor for two rows of this section. Log-shaped grouping, weaker than Sentry's. | €0 → ~€25/mo |

      **Recommendation:** a Discord or Slack webhook this week so errors are at least *seen*,
      then GlitchTip or Sentry EU once the volume makes grouping worth the setup. The trigger
      to revisit is the day you stop reading the channel.

      Two constraints on whichever is picked:

      - It processes user data (stack traces, and `userId` on signed-in reports), so it must be
        added to `app/lib/legal/subprocessors.ts` and the privacy notice **before**
        `ERROR_REPORT_WEBHOOK_URL` is pointed at it, not after.
      - Sentry and GlitchTip ingest their own envelope format rather than an arbitrary webhook.
        That is a small adapter in `app/lib/observability/log.ts` — it is **not** a reason to
        install their browser SDK, which would duplicate the capture that already exists and
        add ~30KB to every page.
- [ ] **Uptime + synthetic check** hitting `/api/market/indices` and one authenticated route.
- [ ] **A single ops dashboard** you look at once a day: WAP, signups, activation, errors,
      job failure rate, external-API failure rate.

### 2.7 Market-data reality 🔴

`docs/market-live-feed.md` documents a **confirmed blocker**, now measured rather than
assumed. Probed against the live Finnhub API on 2026-08-27 with the configured key:
`/quote AAPL` returns 200 with real data; `/quote EVO.ST`, `/quote VOLV-B.ST` and
`/forex/rates` all return **403 — not included in the plan**.

So the blocker is wider than recorded: the free tier serves neither OMXS30/DJI/NASDAQ **nor
Nordic single names nor any FX rate**. Finnhub is a failover for US equities only. Yahoo's
*unofficial, undocumented, rate-limited* endpoints remain the sole source for most of a
Swedish portfolio and for every SEK conversion — which is the entire basis of the display
total. That table is the specification a paid tier has to meet (D2).

Shipping a consumer product to 10k users on scraped endpoints will fail in one of three ways:
rate limiting, silent schema change, or a ToS complaint. All three break the core promise.

**Update 2026-09-03 — the coverage problem is solved; the licensing problem is not, and the
exposure grew.** `yfinance` maintains Yahoo's crumb/cookie handshake as its whole job, which is
the part the hand-rolled TypeScript client kept losing. Measured against the live feed, it
resolves **52 of 52** sweep symbols: US and Nordic equities, `^OMX`, `GC=F`, `SEKUSD=X`,
`BTC-USD` — including everything Finnhub 403s above. It also supplies the fundamentals, news and
analyst estimates behind the instrument pages.

Read that carefully, because it is easy to read as good news only. **Nothing about the three
failure modes changed.** They are the same unofficial endpoints, reached through a library that
tracks them; a client that keeps working is not a licence. What did change is the blast radius:
Yahoo now prices commodities, FX and crypto too, and carries four tabs of company data, so the
single point of failure went from "most of a Swedish portfolio" to "most of the product". The
budget argument for a paid tier is weaker; the licensing argument is unchanged and the
concentration argument is stronger. D2 is still open, 0001 still expires 2026-11-30, and queue
item 2.9 is to re-read that record against what actually shipped.

> **ACCEPTED 2026-08-30:** `docs/decisions/0001-market-data-source.md` — launch M0 on
> Yahoo deliberately, expiring **2026-11-30** or at the first external paying user,
> whichever comes first. Companion: `docs/market-data-providers.md` (priced comparison
> of the five candidates below). The decision buys €0/mo through M0 and costs three
> obligations, W1–W3: W3 is done, W2 is the "delayed" label, and **W1 — counting source
> outcomes and alerting on the fallback rate — is not built, which leaves tripwires T1
> and T2 undetected.** Until W1 ships, this decision is watched by nobody.

- [x] Price out a licensed provider for the coverage you actually need: Nordic equities +
      a few indices + FX. Candidates: EOD Historical Data, Twelve Data, Marketstack,
      Finnhub paid, Börsdata (Nordic-specific). Budget €50–200/mo.
      *Done 2026-08-27 — `docs/market-data-providers.md`. Findings: **Börsdata is out**
      (REST API is end-of-day only, prices land after ~20:00 UTC, and REST moved to Pro+
      €59/mo) — revisit it as a fundamentals source, not a price feed. **EODHD** fits best
      technically but every listed tier is personal-use, so the real number needs a B2B
      quote. **Twelve Data** puts real-time EU behind Pro at $229/mo, over budget.
      **Marketstack** is the cheapest with commercial use from $9.99/mo and lists index
      data on every tier — unverified, and its index data may be EOD-only, which would
      disqualify it the same way Börsdata was. **Finnhub paid** is cheapest to wire since
      the code path exists, but the tier that unlocks `^OMX` is unconfirmed.
      No provider is contracted; none is ruled in.*
- [ ] Answer the three open questions in `docs/market-data-providers.md` before contracting
      anything: (1) does Marketstack's index endpoint actually return OMXS30, and is it
      fresh or yesterday's close — `scripts/marketstack-omxs30-test.py`, needs a free key;
      (2) what does EODHD's commercial licence cost at ~10k users; (3) which Finnhub tier
      returns `^OMX`. Cheapest first — (1) is ten minutes and may collapse the price range
      from $229/mo to $10/mo.
- [ ] Delayed data (15-min) is licensed far cheaper than real-time and is **completely
      adequate** for this audience. Say "delayed 15 min" in the UI and stop paying for
      real-time. Only M6 needs real-time.
- [ ] Cache aggressively at the symbol level; you have ~10k users watching maybe 800 distinct
      symbols. One fetch per symbol per interval, shared across all users.
- [x] **`FALLBACK_ITEMS` in `app/api/market/indices/route.ts`** *(closed 2026-08-28, and the
      finding was partly wrong: it never held invented values.* `FALLBACK_ITEMS` — now
      `UNKNOWN_ITEMS` — was `price: "--"`, `value: "--"`, `time: "--:--"`, which is the honest
      rendering. What was true is the second half: `MARKET_MOCK_FALLBACK_MODE` could not reach
      the strip, so the honesty rested on a literal nobody was stopping a future edit from
      changing. It now rests on a return type — see the row below.*)*
- [x] **Index quotes are behind `MarketProvider`** *(done 2026-08-28.* Upstream reads moved to
      `app/lib/market/index-quotes.ts` and the interface gained `getIndexQuotes(indices)` plus
      `getIndexQuote(index)`. Batch-shaped deliberately: nine indices through `getQuote()`
      would be nine calls per refresh, and Yahoo's rate limiter is the documented failure mode.
      The route kept what is genuinely its own — cache TTL, failure cooldown, per-index
      retention, chart pacing, formatting — and dropped from 575 lines to 277 with no network
      code left in it.

      **Indices have no placeholder at all, in any mode.** A synthetic share price arrives
      labelled beside the holding it belongs to and `computeDayChange()` refuses to derive a
      change from it; a synthetic index level is an unlabelled claim about a whole market in a
      one-line strip with nowhere to put the caveat. So `PlaceholderMarketProvider` returns
      `null` for indices even under `MARKET_MOCK_FALLBACK_MODE=always`. That is stricter than
      the rule for holdings, on purpose.

      The chain is also **inverted for indices** — Finnhub first, then Yahoo. Finnhub's index
      data is keyed and documented; Yahoo's is the unofficial endpoint that answers a
      nine-symbol batch with 401 and rate-limits the retry. For single quotes Yahoo has the
      better coverage and still goes first.

      Extracted `app/lib/market/finnhub-client.ts` on the way, so `index-quotes.ts` can share
      the token handling without a cycle back through the provider.)*
- [ ] **No live smoke test.** Every market test mocks the network, so nothing catches Yahoo
      changing its JSON shape — one of the three failure modes named above.

**Closed 2026-08-27/28.** Provider chain (Yahoo → Finnhub → policy-gated placeholder) with
two live implementations behind the interface; `MARKET_MOCK_FALLBACK_MODE` so production
refuses invented prices and fails closed when unset; typed `MarketDataUnavailableError` plus
a null-returning variant, with unavailability rendered honestly on the portfolio page and
dashboard; D5 settled — one display currency (SEK), FX applied server-side, unconvertible and
unpriced holdings excluded from the total and disclosed; the `getQuote()` relabel trap removed
by construction. `tests/market-provider-strict.test.ts` and `tests/portfolio-currency.test.ts`
hold the line — though `market-provider-strict` was never in the `test:unit` list and so had
never run in CI; wired in 2026-08-28, along with `NODE_ENV=test` on `test:unit` and
`test:smoke`, without which `npm run ci` failed on a clean checkout.

### 2.8 M0 exit criteria

- [x] Zero synthetic values render as fact anywhere in the UI (manual audit + test) — §2.1;
      holds while `check:delivery` and `tests/synthetic-data-policy.test.ts` stay green
- [ ] Privacy policy, Terms, consent notice live; export + delete work end-to-end
      — *all done except naming a controller, which needs the company to exist (§2.2)*
- [ ] Auth rate-limited; Google sign-in live; server-side session revocation works
      — *rate limiting and session revocation done (§2.3); the Google OAuth client is still
      unprovisioned and is the only thing left on this line*
- [x] Cross-tenant isolation test passing for every user-scoped route — §2.4; holds while
      `tests/cross-tenant-isolation.test.ts` and the `check:delivery` scoping guard stay green
- [ ] Production + staging deployed; restore-from-backup rehearsed once
- [ ] Funnel events flowing; error alerts reaching your phone
      — *funnel events done (§2.6): the stream, the nine events and the retention sweep are
      live. Error alerting is what is left on this line*
- [x] Licensed market-data provider contracted **or** an explicit, written, time-boxed
      decision to launch on Yahoo with a documented switch plan
      — *closed 2026-08-30 by signing `docs/decisions/0001-market-data-source.md`
      (ACCEPTED, expires 2026-11-30 or first external paying user). Note what the
      signature does **not** buy: W1 is unbuilt, so tripwires T1 and T2 fire against
      nothing. The line is closed; the risk is transferred to queue item 2.8*

### 2.9 Cut list for M0

Mobile app. Payments. Push notifications. Any new module. Any new page. Localisation beyond
en/sv. Dark/light theming work. Redesigns.

---

## 3. M1 — Private beta: first 100 users

**Goal:** prove that a stranger can understand the product without you explaining it.

**Target:** 100 signups · 25 WAP · activation ≥ 50% · at least 15 users returning in week 2.

### 3.1 Scope

- [ ] **Ship the onboarding flow in §8 in full.** This is the milestone's centre of gravity.
- [ ] **Recruit deliberately, not broadly.** 100 users from Swedish investing subreddits,
      Placera forum, Shareville, a few Facebook groups, and personal network. Invite-based so
      you control volume.
- [ ] **Talk to 15 of them.** 20-minute calls. Watch them sign up on a screenshare. Do not
      help them. Write down every hesitation. This is the highest-value activity in the
      entire roadmap and no dashboard replaces it.
- [ ] **In-app feedback**: you already have a feature-request board with voting and comments
      (`app/lib/feature-requests/`). Surface it prominently in beta; it doubles as your
      qualitative backlog and makes early users feel like co-owners.
- [ ] **Fix the top 5 friction points** found in the calls before opening the doors.

### 3.2 Exit criteria

- [ ] Activation ≥ 50% (holding added within 24h)
- [ ] TTFV median < 120s
- [ ] W2 retention ≥ 30% of activated users
- [ ] ≥ 8 of 15 interviewed users can state, unprompted, what DISU is for
- [ ] Zero P1 bugs open; zero trust incidents
- [ ] Infra cost per WAP known and written down

### 3.3 Cut list

Growth spend. SEO. Content marketing at scale. Referrals. Any new module.

---

## 4. M2 — Public launch: 1,000 users

**Goal:** a repeatable acquisition channel and a product that survives unattended traffic.

**Target:** 1,000 signups · 300 WAP · activation ≥ 60% · W4 ≥ 20%.

### 4.1 Acquisition — pick two channels, ignore the rest

1. **Content/SEO, Swedish-first.** You have a filings-primer engine. Publish primers as
   *public, indexable pages* for the 200 most-searched Nordic tickers: "Volvo B — vad gör
   bolaget, i klartext". This is your unfair advantage: the content generation is already
   automated. Every page ends in the same CTA: *see this in your own portfolio*.
   - Requires: public primer routes, sitemap, structured data, canonical URLs, OG images.
   - 🔴 Guardrail: automated content must be reviewed before publishing. Wrong facts about a
     real listed company is both a trust and a legal problem.
2. **Community presence, not community spam.** Answer questions on Placera/Reddit/Facebook
   with genuinely useful analysis, linking only when relevant. Slow, compounding, and it is
   exactly where your audience already is.

Third channel to test cheaply once the first two work: the **compound calculator as a
standalone viral tool**. It is already the best thing on the landing page. Give it its own
shareable URL, let people share a result image, no signup required.

### 4.2 Product

- [ ] Full mobile-web quality pass. Assume 70%+ of traffic is phone. Non-negotiable.
- [ ] Public primer pages (logged-out) with a soft signup wall *after* value.
- [ ] Watchlist — the zero-friction alternative to owning something.
- [ ] Weekly digest email (see §6.2 — reintroduce the loop that migration `0017` dropped).
- [ ] Performance budget: LCP < 2.0s on 4G for landing + dashboard.
- [ ] Accessibility pass: keyboard nav, contrast, screen-reader labels. The nav dropdowns in
      `top-nav.tsx` already have `aria-haspopup`/`aria-expanded` — extend that standard.

### 4.3 Exit criteria

- [ ] 1,000 cumulative signups from ≥ 1 channel that works without your daily effort
- [ ] 300 WAP · activation ≥ 60% · W4 ≥ 20%
- [ ] Mobile activation within 10pp of desktop
- [ ] p95 dashboard load < 2.5s
- [ ] 30 consecutive days with no unplanned downtime > 15 min

---

## 5. M3 — Habit: 2,500 users

**Goal:** DISU becomes a weekly ritual rather than a tool you remember existing.

**Target:** 2,500 signups · 1,000 WAP · W4 ≥ 25% · 40% of WAP opening the weekly digest.

### 5.1 Retention mechanics (see §6 for the full playbook)

- [ ] **Portfolio history** — daily snapshots so you can show true time-weighted return.
      This is the thing no broker gives them cleanly, and it needs to start recording *now*
      because history cannot be backfilled. **Start snapshotting in M0 even if you don't
      display it until M3.**
- [ ] **Price + news alerts** on holdings and watchlist, email first, push later.
- [ ] **"While you were away"** — a summary on every return visit: what moved, what news
      broke, what filing dropped. Rewards coming back.
- [ ] **Annual/quarterly portfolio review** — a shareable, beautiful "your year in
      investing". High share rate, near-zero marginal cost, uses data only you have.
- [ ] **Onboarding checklist** that persists until complete (§8.8).

### 5.2 Exit criteria

- [ ] W4 ≥ 25% · median sessions/week ≥ 2.5 for activated users
- [ ] Digest open rate ≥ 40%, click ≥ 10%
- [ ] ≥ 90 days of continuous portfolio-history data recorded
- [ ] Churn reasons instrumented (exit survey on delete)

---

## 6. M4 — Consolidation at scale: 5,000 users

**Goal:** broker/bank connection becomes the default path, not the advanced one.

**Target:** 5,000 signups · 2,500 WAP · connect rate ≥ 35%.

### 6.1 Scope

- [ ] **Tink production enablement.** `architecture.md`: *"Tink is sandbox-verified only;
      production enablement is pending."* This is a contractual and compliance process
      (agreement, data-use review, possibly an AISP dependency) — **start it at M2, not M4**,
      because the lead time is measured in months, not sprints.
- [ ] 🔴 **Model the unit economics before you scale connections.** Aggregator pricing is
      typically *per connected user per month*. At 2,500 connected users even €0.30/user/month
      is €750/mo — potentially your largest single cost line, and it grows with exactly the
      metric you're optimising. Know this number before you promote the feature. If it is
      punitive, CSV import + manual entry must stay first-class forever.
- [ ] Broaden coverage: Nordnet direct API (currently listed but "onboarding is pending"),
      more CSV importers (Nordnet, Degiro, IBK). **A good CSV importer is 5% of the cost of an
      API integration and covers most of the need.** Do these first.
- [ ] Sync reliability: scheduled background sync, re-consent handling (the UI already has a
      re-consent message path), per-connection health surfaced honestly to the user.
- [ ] Reconciliation UX: when broker data and manual entries disagree, the user must be able
      to see and resolve it. This is where trust is won or lost.
- [ ] Job queue: if sync volume outgrows one process, extract the worker (M0 option B).

### 6.2 Exit criteria

- [ ] Connect rate ≥ 35% of activated users
- [ ] Sync success rate ≥ 98% over 30 days
- [ ] Aggregator cost per connected user documented and < 25% of projected ARPU
- [ ] ≥ 4 CSV importers live
- [ ] Zero incidents of positions attributed to the wrong user or account

---

## 7. M5 — Revenue readiness: 10,000 users

**Goal:** be *sellable* — to advertisers, affiliates, and (recommended) to your own users.

**Target:** 10,000 signups · 6,000 WAP · first revenue booked.

### 7.1 Revenue order of operations

Deliberately ordered by margin and trust cost:

**1. Affiliate / referral (do this first).** Broker and ISK-account referrals are the natural
fit: your user is *by definition* someone who invests, and you know they lack a connected
broker. Payouts per funded account in this market are meaningful, and it requires no ad tech,
no tracking, no privacy tradeoff.
- 🔴 Sponsored/affiliate placements must be **clearly labelled** as advertising. Swedish
  marketing law requires advertising to be identifiable as such, and financial promotion has
  additional expectations. Never let a recommendation look like a neutral product suggestion.
- 🔴 Never rank or filter *analysis* by who pays you. The instant that happens, the product's
  only asset is gone.

**2. Premium subscription (strongly recommended before ads).** €5–8/mo for unlimited primers,
deeper quant runs, alerts, multi-portfolio, export. Why before ads: 300 subscribers ≈ €2k/mo
gross at ~90% margin, versus roughly 6,000 engaged users needed for comparable display-ad
revenue. It also aligns you with users instead of advertisers, and — importantly — it puts a
real price on your two biggest variable costs (LLM primer generation, market data), which are
per-use and currently unbounded.

**3. Display / native advertising (last).** Requires the audience scale you're targeting and
imposes consent, tracking, and layout costs on a product whose whole brand is *calm*. Enter
here only when 1 and 2 are working.

### 7.2 🔴 Regulatory posture — read this before M5, not after

Two lines you must not drift across while unlicensed:

1. **Personal investment advice.** `/quant` shows "the paths a share could take". Presented as
   *general, non-personalised illustration with methodology and limitations disclosed*, this
   is information provision. Presented as *"based on your portfolio, consider X"*, it becomes
   personal investment advice, which in the EU requires MiFID II authorisation. The line is
   crossed by **personalisation and recommendation**, not by showing numbers. Every
   growth-hacky "recommended for you" feature idea will push you toward it — hold the line.
2. **Financial promotion.** Once you take money from brokers to promote products, additional
   marketing rules apply.

Actions:
- [ ] Get a written opinion from a Swedish financial-regulatory lawyer at M2 (a few hours of
      time, and it de-risks every subsequent product decision).
- [ ] Standing disclaimer + methodology page for `/quant`, with explicit limitations.
- [ ] A written internal rule: **no output that is both personalised and directive.**

### 7.3 What a media kit needs (build the instrumentation at M3)

Advertisers will ask for: MAU/WAP, demographic and geographic split, session frequency and
duration, holdings-category distribution (aggregate only), device split, viewability, and
brand-safety posture. You cannot retrofit this. Ensure the analytics from M0 can produce it
in aggregate, with **no per-user data ever leaving your systems**.

### 7.4 Exit criteria

- [ ] 10,000 signups · 6,000 WAP
- [ ] Revenue > infra + data + LLM cost (ramen-profitable on the product itself)
- [ ] Legal opinion on file; disclaimers live; labelling verified
- [ ] Media kit producible from the dashboard in under an hour
- [ ] Cost per WAP trending down as WAP grows

---

## 8. M6 — Trading platform *(different company, treat it as such)*

**Do not treat M6 as the next milestone.** Moving from information to execution changes the
business, the legal entity, the capital requirements, the insurance, the audit burden, and the
bus factor. A one-person company cannot hold client assets.

Realistic paths, cheapest first:

| Path | What it means | Feasibility solo |
|---|---|---|
| **Deep broker integration** | Read-only becomes read + "trade at your broker" deeplink | High — do this at M4/M5 and capture most of the value |
| **Introducing broker / white-label** | A licensed partner does execution, custody, and KYC; DISU is the interface | Medium — the only realistic route to "real trading" for one person |
| **Own MiFID II investment firm licence** | Finansinspektionen authorisation: capital requirements, fit-and-proper management, compliance, risk, audit, reporting | Not solo. Requires funding and hires. |
| **Market-maker connectivity** | Only relevant after the above | N/A pre-licence |

**Trigger to even open this file:** ≥ 6,000 WAP, positive revenue, and either external funding
or a signed partner LOI. Until then, the honest strategy is path 1, which delivers most of the
user benefit for none of the regulatory cost.

### 8.1 On "do we need a market maker?" — no

Asked directly, so answered directly. A market maker quotes two-sided prices to provide
liquidity **on a venue**. You would only need one if DISU operated its own trading venue (an
MTF), which is several regulatory orders of magnitude beyond executing customer orders and is
on no realistic path here.

What actually stands between DISU and a buy button is heavier than a market maker, and all of
it belongs to the regulated entity: authorisation to receive and transmit orders, custody of
client assets, client-money segregation, a KYC/AML programme with sanctions and PEP screening,
capital and professional indemnity, and MiFIR transaction reporting. **A one-person company
holds none of these.** The design conclusion is unchanged from the table above: DISU does not
become the regulated entity — a licensed partner does execution, custody and KYC, and DISU is
the interface.

The full technical plan is `docs/trading-platform.md`. Its headline points:

- **Ship the deeplink first (path 1, at M4/M5).** A "Trade" button that opens a pre-filled
  order ticket at the user's own broker. No licence, no custody, no client money, no KYC —
  and most of the user benefit. Everything below waits behind it, and if deeplinking turns
  out to be enough, *not building the rest is the correct outcome.*
- **Multi-account is a new table, not a column.** `trading_accounts` is distinct from
  `broker_connection_accounts`, which is a read-only projection of an account someone else
  holds. Both coexist. ISK / KF / AF is a first-class column from day one because it decides
  tax treatment, and retrofitting it across live positions is a migration over real money.
- **The ledger is the source of truth.** Double-entry rows; balances derived, never stored.
  Money is `NUMERIC`, never a float. `external_ref UNIQUE` makes a retried partner webhook
  safe to replay — a fill delivered twice must not book twice.
- **Client money never touches a DISU account.** Deposits move from the customer's bank to
  the partner's segregated client account. Name-matched accounts only; withdrawals return to
  the account the deposit came from; buying power exists on settlement, not on initiation.
- **Security is a step up, not the current floor.** Re-authentication on every order and
  withdrawal, mandatory MFA, server-side limits, idempotency keys on every mutating endpoint,
  and an append-only audit log in a separate store. The trading service is its own deployable
  with its own credentials, so a bug in the primer generator cannot reach the ledger.

### 8.2 Scaffolding that exists today

Written, tested, and deliberately **not wired to any route**:

| File | What it is |
|---|---|
| `docs/trading-platform.md` | The plan: regulatory shape, accounts, orders, deposits, security, and the gate |
| `app/lib/trading/types.ts` | Domain model — accounts, orders, fills, ledger entries. Money is a decimal string, never a `number` |
| `app/lib/trading/order-state.ts` | The order state machine, pure and side-effect free |
| `tests/trading-order-state.test.ts` | 12 tests pinning the rules: terminal is terminal, fills accumulate and never over-fill, weighted average fill price, exact decimal arithmetic |
| `db/migrations/0022_trading_accounts.sql` | The schema. **Written, not applied** — and it must not be until §8.3 is met |

The state machine was written first on purpose: it is the only part that can be made correct
before a partner exists, and it is where the expensive mistakes live.

Note that `trading_accounts` is registered in `app/lib/account/personal-data.ts` with the
`blocks` erasure policy, not `erase`. A financial record cannot be deleted on request —
bokföringslag requires seven years, MiFID II five on order records, and GDPR Art. 17(3)(b) is
the exemption. The delete is refused and escalated to a human rather than silently cascading
away a statutory record.

### 8.3 🔴 The gate — what must be true before any trading code runs

- [ ] **M0 closed. All of it.** Trading on an unhardened foundation is a liability, not a product
- [ ] Company entity registered, capitalised, insured (D7)
- [ ] Hosting decision settled and *not* an auto-pausing tier (§2.5 — the snapshot job already suffers from this)
- [ ] Error alerting reaching a human (§2.6)
- [ ] A signed partner agreement, with the regulated-perimeter line explicit
- [ ] Written legal opinion: appointed representative, or technology supplier?
- [ ] A compliance function that is a named person, not a document
- [ ] ≥ 6,000 WAP and positive revenue
- [ ] **Broker deeplinking shipped, measured, and demonstrably insufficient**

---

## 9. Signup & onboarding — the friction-removal plan

Highest-leverage section in this document. Current state: the landing page CTA sends users to
`/auth/login?mode=register`, they enter email + password, and land on `/dashboard` — which,
with no holdings, renders `0 kr` panels and an empty chart. Meanwhile `/portfolio` leads with
**"Connect bank or broker"** (the highest-friction action, requiring BankID and financial
trust), and the zero-friction **"Add Position"** form is hidden behind a toggle ~1,000 lines
down the page (`app/portfolio/page.tsx:1054`).

**That ordering is inverted.** Fix it and activation moves more than any feature will.

### 9.1 Principle: value before account

The best signup form is the one that appears *after* the user already wants in. Make these
work fully logged-out:

- Ticker search and company profile (`/api/tickers/search`, `/profile`, `/history` — already built)
- One free primer, complete, no wall
- The compound calculator (already public — good)
- Market strip and index data (already public)
- A **read-only demo portfolio** so the dashboard is never empty for a visitor

Then: *"Save this portfolio — takes 10 seconds."* Now the account has a purpose.

### 9.2 Let people build a portfolio *before* they have an account

The strongest single change available: allow holdings to be added to `localStorage` while
logged out, then migrate them into `manual_positions` on signup. The user has already invested
effort; abandoning now costs them something. This converts far better than any form
optimisation, and it inverts the entire funnel — signup becomes *saving your work*, not
*gaining access*.

### 9.3 Signup: two fields maximum, ideally zero passwords

- **Google sign-in as the primary CTA.** Code is complete (`app/lib/auth/google.ts`,
  PKCE + nonce). It is inert only because the OAuth client isn't provisioned. **Provision it
  in M0** — a one-hour task that removes the biggest single step from the funnel.
- **Magic link as the email path.** Email → link → in. No password to invent, remember, or
  reset; kills the "password must be 8 characters" bounce and the entire reset-flow surface.
  You already have single-use hashed tokens (`password_reset_tokens`) and email delivery —
  a magic-link flow is a small extension of code that exists.
- If you keep passwords: never ask for confirm-password, show a reveal toggle, allow paste,
  and validate live.
- **Never ask for name, phone, birth date, or "work email" at signup.** Note the landing copy
  currently contains `"workEmail": "Work email"` and `"requestDemo": "Request demo"` in
  `app/i18n/en.json` — B2B SaaS language that is wrong for this audience. Purge it.
- No email verification wall. Send the verification, let them in immediately, gate only
  broker-connect and email-change on verified status.

### 9.4 The activation ladder — order paths by friction, ascending

Present holdings entry as three clearly ranked options. Today the page presents them in
reverse.

1. **Search & add (10 seconds, zero trust required).** Ticker autocomplete already exists
   (`app/components/ticker-autocomplete.tsx`). Ask for symbol + quantity. **Make average cost
   optional** — it is the #1 field people abandon on because they don't know it. Compute what
   you can without it, and prompt later.
2. **Upload a file (1 minute).** Avanza CSV import exists. Add Nordnet next. Accept drag-drop
   anywhere on the page, auto-detect the broker from the header row, and show a preview before
   commit. Never fail a whole file for one bad row.
3. **Connect your bank (2 minutes, high trust).** Present *after* the user has value, framed
   as an upgrade: *"Keep this updated automatically."* Before the BankID redirect, state
   plainly: read-only, we cannot move your money, you can disconnect anytime, here's what we
   store. Trust copy at the moment of hesitation converts better than any button colour.

### 9.5 Time-to-first-value target: under 60 seconds

Instrument and defend it: landing → Google sign-in → "add your first holding" → autocomplete →
quantity → **dashboard with real data**. Every added field, screen, or modal is measured
against this number.

### 9.6 First-run experience

- [ ] Never render an empty dashboard. If no holdings: a single focused "add your first
      holding" card plus the demo portfolio, not zeroed-out panels.
- [ ] Skip the tour. Use one contextual tooltip per surface, on first visit only, dismissible.
- [ ] Ask for **nothing** in the first session that isn't required to show value.
- [ ] Progressive profiling: collect experience level, currency, goals *later*, in context,
      and only when the answer changes what you show.
- [ ] Default currency SEK, default language from browser `Accept-Language` (the language
      context already reads a stored preference — extend it to detect on first visit).

### 9.7 The onboarding checklist (gentle lock-in, done right)

A persistent, dismissible card on the dashboard until complete:

- [x] Add your first holding
- [ ] Add the rest of your portfolio *(shows "3 of ~8 typical")*
- [ ] Read a primer on one of your companies
- [ ] See the market mood for your holdings
- [ ] Connect your broker to keep it updated

Each step must deliver actual value, not just completion. A checklist that rewards you for
handing over data is dark-pattern; a checklist that walks you through the product's four
questions is genuinely helpful. Stay on the right side of that.

### 9.8 Friction inventory — audit and fix in M0/M1

| Friction | Where | Fix |
|---|---|---|
| Password required | `/auth/login` | Google primary + magic link |
| Google button absent | env not set | Provision OAuth client |
| B2B copy ("work email", "request demo") | `app/i18n/en.json` | Rewrite for consumers |
| Empty dashboard after signup | `app/dashboard/page.tsx` | First-run card + demo data |
| Broker connect shown first | `app/portfolio/page.tsx:747` | Reorder ladder |
| Manual add buried behind a toggle | `app/portfolio/page.tsx:1054` | Promote to primary |
| Average cost feels mandatory | add-position form | Make optional, prompt later |
| Everything gated by `middleware.ts` | `middleware.ts` matcher | Open primers, ticker pages, learn |
| No logged-out value | landing page | Public primers + saved local portfolio |
| Mobile untested | all | Full pass in M2 |

---

## 10. Retention & ethical lock-in

Lock-in that survives is lock-in the user would *choose*. Sort your ideas by this test: *if
the user understood exactly what this does, would they thank you?*

**Build these (data gravity and genuine value):**
- **Cost basis + full history.** Once DISU knows what they paid and when, it is the only place
  that knows their true return. Brokers export this badly. Highest-value moat you have.
- **Cross-broker consolidation.** Nobody with two brokers can see one number anywhere else.
- **Weekly digest.** Migration `0017` dropped the weekly-updates tables. That was right for
  code hygiene and wrong for retention — a digest is the single most reliable re-engagement
  loop in consumer finance. Reintroduce it at M2, leaner: what moved, one primer, one mood
  read. Personalised to *their* holdings.
- **Alerts.** The only legitimate reason to interrupt someone. Keep them rare and relevant.
- **Annual review.** Shareable, delightful, uses data only you have. Acquisition *and*
  retention in one artefact.
- **Notes on holdings.** Let users write why they bought. Nobody else stores that, it's
  emotionally sticky, and it makes them better investors.
- **Frictionless export.** Counter-intuitively increases retention: knowing you can leave
  removes the anxiety that makes people leave. It's also a GDPR requirement (§2.2).

**Do not build:**
- Streaks and daily-engagement mechanics. Daily portfolio-checking makes people *worse*
  investors and directly contradicts the brand ("ride out the swings"). Optimise for *weekly*
  intentional use.
- Gamified trading nudges, confetti on gains, leaderboards.
- Hostage-taking: no export, hard-to-find delete, dark-pattern cancellation. In a trust
  business these are net-negative even ignoring the legal exposure.

---

## 11. Risk register

| # | Risk | Severity | Mitigation | Gate |
|---|---|---|---|---|
| R1 | Fabricated numbers shown as fact | **Critical** | §2.1 — **mitigated**; guard + test hold the line | M0 ✅ |
| R2 | Cross-user data leak (service-role key bypasses RLS) | **Critical** | §2.4 — **mitigated**; `userScoped()` + CI guard + isolation suite hold the line | M0 ✅ |
| R3 | No privacy policy / GDPR mechanics while holding EU financial data | **Critical** | §2.2 — mechanics **done** (export, erasure, register + build guard); the policy documents remain | M0 |
| R4 | Market data via unofficial Yahoo endpoints | High | §2.7 licensed provider | M0 |
| R5 | Job queue can't run on serverless | High | §2.5 hosting decision | M0 |
| R6 | Aggregator per-user cost exceeds ARPU | High | §6.1 model before scaling | M2 |
| R7 | `/quant` drifts into regulated advice | High | §7.2 legal opinion + no personalised directives | M2 |
| R8 | Bus factor of 1 | High | Docs current, IaC, runbooks, someone holds a break-glass credential | M2 |
| R9 | LLM cost per primer unbounded | Medium | Cache (exists), per-user quotas, premium gating | M3 |
| R10 | Incumbent ships the same comprehension layer | Medium | Speed + cross-broker consolidation they can't offer | ongoing |
| R11 | Session revocation requires rotating the global secret | Medium | §2.3 — **mitigated**; per-session rows, logout and password reset both revoke. `0019` applied to production 2026-08-28, so `user_sessions` exists and sign-in works | M0 ✅ |
| R15 | Rate-limit counters are per-process, so N instances give N× the budget | Medium | §2.3 — move to a shared store before scaling past one instance (tied to D1) | M4 |
| R12 | Automated public primers publish a factual error about a listed company | Medium | Human review before publish | M2 |
| R13 | Solo burnout | High | §12 cadence, hard cut lists, one gate at a time | ongoing |
| R14 | Multi-currency totals add unconverted amounts | Medium | §2.7 base-currency decision (D5) | M0 |
| R16 | An admin who authored a release note cannot be erased (`on delete restrict`) | Low | §2.2 — detected and reported up front; needs an authorship-reassignment path before an admin ever leaves | M2 |

---

## 12. Operating cadence for one person

**Weekly loop (protect this):**
- *Mon* — read the ops dashboard, pick **one** thing from the current gate. One.
- *Tue–Thu* — build. No new scope. Ideas go to the feature-request board, not into the week.
- *Fri* — ship, update §13, write two sentences on what you learned.
- *Continuous* — one user conversation per week, minimum, forever.

**Rules that keep a solo founder alive:**
1. The current gate's exit criteria are the only valid definition of "important".
2. Anything not in the current gate goes on the board. The board is not a promise.
3. `npm run ci` stays green. You have no one to catch your regressions.
   *It was not, and nobody noticed — found 2026-08-28.* Two failures of exactly the kind this
   rule exists to catch: `tests/auth-password-policy.test.ts` asserts `NODE_ENV === "test"`
   and nothing set it, so `npm run ci` failed on a clean checkout **and in GitHub Actions**,
   while the breach check quietly made real network calls on every test run; and
   `tests/market-provider-strict.test.ts` — cited in §2.7 as holding the synthetic-data line —
   was never in the `test:unit` list, so it had never run in CI at all. Both fixed in
   `package.json`. The lesson to carry: a green CI badge proves the tests **that are wired up**
   pass. Adding a test file is two steps, and the second one is silent when you skip it.
4. Buy instead of build for anything not core (email, analytics, error tracking, market data).
   Your core is the four questions in §1.1 and nothing else.
5. Every gate closes with the docs updated. `architecture.md` is unusually good — that is an
   asset; keep it accurate.

---

## 13. Milestone tracker

*Update weekly. Write actual numbers next to targets. Keep misses visible.*

| Gate | Focus | Key metric | Target | Actual | Status |
|---|---|---|---|---|---|
| **M0** | Foundation hardening | trust incidents | 0 | 0 | 🟡 10/16 — see the queue. 2026-09-03 moved 2.3 (done) and half of 2.8; the six blocking items are unchanged, and four of them are yours, not code |
| **M1** | Private beta | WAP | 25 | — | ⬜ |
| **M2** | Public launch | WAP | 300 | — | ⬜ |
| **M3** | Habit | W4 retention | 25% | — | ⬜ |
| **M4** | Consolidation | connect rate | 35% | — | ⬜ |
| **M5** | Revenue readiness | WAP / revenue > cost | 6,000 / yes | — | ⬜ |
| **M6** | Trading platform | *gated on funding or partner* | — | — | 🔒 locked |

### M0 — closed, and what each one taught

*The record. Open M0 work is in the queue at the top of this document, not here —
one item, one place.*


- [x] Market-data provider decision written down 🔴 *(done 2026-08-30 — `docs/decisions/0001-market-data-source.md` is ACCEPTED: launch M0 on Yahoo, expiring
      2026-11-30 or at the first external paying user. Two things are worth knowing. **W3 turned out to be already done** —
      the record was drafted 2026-08-27 and the indices route moved behind `MarketProvider` on 2026-08-28, so an
      obligation was signed that no longer existed; a decision record drafted days before it is signed must be re-read
      against the code, not just signed. **And a signature is not a safety net:** W1 is unbuilt, so T1 (rate limiting) and
      T2 (schema change) fire against nothing. The exit criterion asked for a written decision and now has one — but
      Yahoo is still watched only by a human noticing.)*
- [x] Remove `stableDayMovePct` and all fabricated user-facing data 🔴 *(§2.1 done)*
- [x] GDPR export + cascading delete 🔴 *(§2.2 done 2026-08-25 — register-driven, with a build
      guard that fails when a new table is not declared)*
- [x] Rate-limit auth routes 🔴 *(§2.3 done 2026-08-25 — IP + email keyed, `test:unit` covers it)*
- [x] Password floor + breach check 🔴 *(§2.3 done 2026-08-27 — 10 chars, blocklist, and the
      Pwned Passwords range API; `password1` and its disguises are now rejected)*
- [x] Cross-tenant isolation tests for all user-scoped routes 🔴 *(§2.4 done 2026-08-25 — plus a
      `userScoped()` helper and a CI guard so it cannot regress)*
- [x] Start recording daily portfolio snapshots (history cannot be backfilled) *(done 2026-08-27 —
      `0021_portfolio_snapshots.sql` **applied to production**, plus `app/lib/portfolio/snapshots.ts`
      swept off the job worker's timer. Unblocked 2026-08-28 when `0019` went live — the sweep starts
      from `/api/portfolio/positions`, which needs a signed-in user. Confirm rows are actually
      landing before treating history as safe; the project auto-pauses on the free tier, and a
      paused day records nothing.)*
- [x] Read the stored history back — the value chart *(done 2026-08-28 —
      `/api/portfolio/history`, `app/lib/portfolio/history-series.ts` and the dashboard chart.
      Two rules are worth knowing because both are easy to "fix" into dishonesty. **Gaps stay
      gaps:** a day with no row is a day nothing could be observed, so the line breaks rather
      than interpolating across it. **A currency change breaks the series:** rows carry their
      own currency because `PORTFOLIO_DISPLAY_CURRENCY` is configuration and configuration
      changes, so a reader gets only the trailing run in the newest currency and is told how
      many older rows were cut, rather than having units silently mixed into a jump the
      portfolio never made. `toComparableSeries()` is a pure function so both rules are pinned
      by `tests/portfolio-snapshots.test.ts`.)*
- [x] Session revocation server-side *(§2.3 done 2026-08-25 — logout and password reset both
      revoke)*
- [x] **Apply the pending migrations to production** 🔴 *(done 2026-08-28 — `ymvptljuivjulrxpokla`
      is now in sync with `db/migrations/` through `0021`. `0019_user_sessions.sql` was the urgent
      one: without it no token could be minted, so **every sign-in failed**, and it surfaced
      confusingly as a password-reset error because `resetPasswordWithToken()` ends with
      `revokeAllSessionsForUser()` — the password write and token burn complete before the revoke
      throws, so a reset that showed an error had still changed the password.
      `0017_drop_weekly_updates.sql` dropped six empty, unreferenced tables from the deleted Quant
      Updates feature; never a bug, but the stale rows actively misled debugging. There is still no
      migration runner and no `schema_migrations` table, so nothing records what has been applied —
      the only check is diffing `db/migrations/` against `pg_tables`, and a restore can silently roll
      the schema back behind the code. `scripts/apply-0017.mjs` is the template to copy for a
      destructive migration: it prints row counts and refuses to drop a non-empty table.)*

---

## 14. Open decisions

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| D1 | Hosting: long-lived Node vs Vercel + extracted worker | M0 | Long-lived Node now; revisit at M4 |
| D2 | Market data provider | M0 | License 15-min delayed Nordic + FX; keep Yahoo as fallback |
| D3 | Auth: keep passwords or go magic-link only | M0 | Google + magic link; retire passwords |
| D4 | Analytics tool | **Decided** | Own stream, no vendor. Extending `events` was impossible, not just awkward — `userScoped()` cannot write a row without a user id, and the top of the funnel has no account. A sibling table with a nullable `user_id` instead: `docs/funnel-events.md` |
| D5 | Base/display currency for portfolio totals | **Decided** | SEK, implemented 2026-08-28. Converted server-side next to the rows it totals, source currency shown per row, and holdings that cannot be converted or priced are excluded and disclosed rather than summed. Overridable per deployment via `PORTFOLIO_DISPLAY_CURRENCY`, not per user |
| D6 | Sweden-only or Nordics at launch | M2 | Sweden-only through M3; Nordics at M4 |
| D7 | Company entity + insurance | M2 | With the legal opinion in §7.2 |
| D8 | First revenue line | M5 | Affiliate first, premium second, ads last. *(Was a second row numbered D5 — renumbered to the next free id rather than shifting D6/D7, since `docs/` cites D5 as the currency decision)* |
