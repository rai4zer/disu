# Market-data provider comparison

Priced 2026-08-27 from public pricing pages. **Verify before contracting** — pricing
pages change, and the two things that decide this (does the plan carry `^OMX`, and does
the licence permit a consumer app) are usually not on the pricing page at all.

Companion to [decisions/0001-market-data-source.md](decisions/0001-market-data-source.md).

## What the product actually needs

From `app/api/market/indices/route.ts` and `app/lib/market/market-provider.ts`:

| Need | Detail | Negotiable? |
|------|--------|-------------|
| **Indices** | OMXS30 (`^OMX`), DJI, NASDAQ, S&P 500, N225, FTSE, DAX, SSE, HSI | OMXS30 is the one that must work — it is the Nordic hook |
| **Nordic equities** | Stockholm `.ST`, plus `.CO` / `.OL` / `.HE` | No |
| **Global equities** | US, plus `.AS` `.PA` `.DE` `.SW` `.L` (see `CURATED_TICKERS`) | No |
| **FX** | SEK/USD/EUR/DKK/NOK/CHF/GBP — needed for the §2.7 (D5) base-currency fix. **Finnhub free returns 403 here**, so Yahoo currently underpins every converted total | No |
| **Ticker search** | `searchTickers()` — currently Yahoo's search endpoint | Could stay local/curated |
| **Freshness** | 15-min delayed is adequate until M6 | Yes — and this is where the money is |
| **Licence** | Consumer-facing web app, display use, ~10k users | No |
| **Volume** | ~800 distinct symbols, shared cache, 45–60s poll ≈ 1–2M calls/mo uncached; far less cached per symbol | — |

## Candidates

### Börsdata — €59/mo (Pro+) — ❌ disqualified for the strip
Nordic-native and the best fundamentals coverage of the set. But the REST API is
**end-of-day only** — prices land after ~20:00 UTC — and REST access is being moved to
the Pro+ tier (€59/mo; Premium €10, Pro €25 do not include it). Rate limit 100 calls /
10s, ~10k/day.

**Verdict:** cannot serve a live-ish market strip at any price. Worth revisiting later
as a *fundamentals* source for primers, which is a different requirement.

### EODHD — $19.99–$99.99/mo listed — ⚠️ licence blocker
- EOD All-World $19.99/mo · EOD+Intraday All-World Extended $29.99/mo · Fundamentals
  $59.99/mo · **All-In-One $99.99/mo** (the only tier with live 15-min delayed data +
  real-time websockets). 100k calls/day, 1k/min.
- Procures European data via Cboe, UK via LSE, US via Nasdaq Cloud — Stockholm `.ST`
  symbols are served (`ENITY.ST` has a public data page).
- **Every listed plan is "personal use".** Commercial use requires B2B pricing via
  `eodhd.com/commercial-pricing`. So the $19.99 headline is not the number you would pay.
- Index coverage is not stated on the pricing page — must be confirmed for `^OMX`.

**Verdict:** technically the closest fit; the real cost is unknown until you talk to
sales. Best first call to make.

### Twelve Data — $79–$229/mo — ⚠️ expensive at the tier you need
- Basic free (8 credits/min, 800/day, US only) · **Grow $79/mo** (55 credits/min, 20+
  markets, real-time US + **EOD** global) · **Pro $229/mo** (610/min, 70+ markets,
  real-time EU) · Ultra $999/mo.
- Real-time EU — which is where Stockholm lives — starts at **Pro, $229/mo**. Grow gives
  you global equities only at end-of-day.
- Index access is not broken out per tier; needs confirming.

**Verdict:** clean API and generous limits, but ~$229/mo for Nordic freshness is over
the §2.7 €50–200 budget for a pre-revenue product.

### Marketstack — $9.99–$149.99/mo — 💰 cheapest commercial-use option
- Free $0 (100 req/mo, no commercial use) · **Basic $9.99/mo** (10k req/mo, EOD +
  IEX US intraday, **commercial use allowed**) · **Professional $49.99/mo** (100k
  req/mo, real-time) · Business $149.99/mo (500k req/mo).
- Index data ("Stock Market Index") is listed as included on **every** tier, free
  included — the only provider here that says so plainly.
- 2,700+ exchanges claimed; no per-region breakdown, so Stockholm and `^OMX` coverage
  must be tested, not assumed.
- 10k req/mo on Basic is tight for a 60s poll across many symbols; the symbol-level
  shared cache in the switch plan is what makes it viable.

**Verdict:** best price-to-fit *if* the free tier's index endpoint actually returns
OMXS30. That is a 10-minute test with a free key and should be step one.

### Finnhub paid — ~$12–$100/mo — 🔁 the incumbent, already tested and failing
Premium tiers reported in the $11.99–$99.99/mo range; 60+ exchanges, but international
coverage requires a paid plan. Two tests of your own key established the gap: indices are
gated (2026-07-25, `docs/market-live-feed.md`), and `EVO.ST`, `VOLV-B.ST` and
`/forex/rates` all return `403 — not included in the plan` (2026-08-27, ROADMAP §2.7).
So the paid tier must clear **three** bars, not one: indices, Nordic single names, and
FX. The pricing page is JS-rendered, so which tier clears all three is unconfirmed from
public pages.

**Verdict:** cheapest *migration* — the code path already exists in
`app/api/market/indices/route.ts` and would light up on an upgrade. But do not buy on
hope: ask support, in writing, whether the tier you are quoted returns `^OMX` from
`/quote` and `/index/candle`. That exact question is what the free tier answered "no" to.

## Summary

| Provider | Entry price for what we need | Nordic freshness | Indices | Commercial licence | Verdict |
|----------|------------------------------|------------------|---------|--------------------|---------|
| Börsdata | €59/mo (Pro+) | EOD only, after 20:00 UTC | via prices | Personal/pro tiers | ❌ Not for a live strip |
| EODHD | $99.99/mo listed, B2B quote required | 15-min delayed | Unconfirmed | ⚠️ Paid tiers are personal-use | ⚠️ Best fit, unknown price |
| Twelve Data | $229/mo (Pro) | Real-time EU | Unconfirmed | Business plans exist | ⚠️ Over budget |
| Marketstack | $9.99–$49.99/mo | Real-time from $49.99 | ✅ All tiers | ✅ From $9.99 | 💰 Test first |
| Finnhub paid | ~$12–$100/mo | Paid intl. coverage | Paid-only, tier unclear | Check | 🔁 Cheapest to wire, ask support |

## Test log — Marketstack / OMXS30 (2026-08-27)

Question 1 below was probed as far as it can go without an account. Confirmed:

- The index endpoints exist and are v2: **`GET /v2/indexlist`** ("List Market Indices")
  and **`GET /v2/indexinfo`** ("Market Index Information"), per the OpenAPI schema
  embedded in the apilayer docs page.
- Both answer over **HTTPS** at `api.marketstack.com` — an unauthenticated call returns
  `401 invalid_access_key`, not `404`, so the routes are real. HTTPS-on-free-tier is
  still unproven: key validation happens before any plan check, so a free key could
  still come back `https_access_restricted`.
- `indexinfo` returns, per schema: benchmark name, benchmark code, **price** ("Current
  index price"), **date** ("Date of the quote"), country, region. `indexlist` returns
  benchmark codes — that is where OMXS30's exact spelling would come from.
- Marketstack also exposes `/v2/stockprice` ("Real-Time Stock Price") and
  `/v2/exchanges/{mic}/...` routes, so `XSTO` coverage is testable directly.
- **No published list of supported indices.** The "750+ indices from 50+ countries"
  claim appears only in marketing copy; neither the docs nor any public page enumerates
  them, so OMXS30 coverage cannot be confirmed from documentation alone.

**Blocked on:** a free API key (signup at `marketstack.com`). A ready-to-run test is
staged — it checks the index list, five OMXS30 spellings, XSTO exchange coverage, a
Nordic equity, and the age of the returned datapoint:

```
MARKETSTACK_KEY=xxxx python3 marketstack-omxs30-test.py
```

**Watch for the second trap:** the marketing page describes index data as end-of-day
for 750+ indices, while real-time is listed as a Professional-tier feature for *stocks*.
If `indexinfo` returns a stale `date` even on a paid tier, Marketstack cannot drive the
market strip regardless of price — the strip would render yesterday's close as current,
which `tests/synthetic-data-policy.test.ts` exists to prevent. Section 5 of the test
script answers this.

## The three questions that decide this

Ordered by cost to answer. Do not contract anything before all three are answered.

1. **Does Marketstack's index endpoint return OMXS30?** Free key, one curl, 10 minutes.
   If yes, this is a $10–50/mo problem, not a $229/mo one.
2. **What does EODHD's commercial licence cost for a consumer app at ~10k users?** One
   email. Their listed prices are personal-use only, so this number is currently unknown.
3. **Which Finnhub tier returns `^OMX`?** One support ticket, referencing the exact
   error you already have on record.

## Measured: corporate-event coverage on the current Finnhub key (2026-08-30)

Added when the Calendar tab was built, because it needs *future* dates rather than
prices and turned out to be a sharper test of the plan than quotes were. Probed
directly against the live key:

| Endpoint | Result |
|---|---|
| `calendar/earnings?symbol=AAPL` | **200.** Confirmed date, fiscal quarter, EPS estimate. |
| `calendar/earnings?symbol=MSFT` | **200.** |
| `calendar/earnings` (whole market, no symbol) | **200.** |
| `calendar/earnings?symbol=VOLV-B.ST` | **403** — "You don't have access to this resource." |
| `calendar/earnings?symbol=ERIC-B.ST` / `EVO.ST` / `HM-B.ST` | **403**, all of them. |
| `stock/dividend?symbol=AAPL` | **403**, US included. |

So the shape of the gap is the same one the quote endpoints show (§ above), but it
bites harder here: the Calendar's entire reason to exist is the Nordic holdings, and
those are exactly the symbols refused. There is **no AGM feed at all** on any tier
reviewed, from any provider — those dates come from company IR pages and would need
scraping or manual curation whichever feed gets licensed.

`app/api/portfolio/calendar/route.ts` reports its own per-symbol coverage to the page
rather than rendering an empty month, because an empty calendar reads as "nothing is
scheduled" — a worse falsehood than "we cannot see this yet". Whatever replaces
Finnhub must be checked against **earnings dates and dividend dates for `.ST`
symbols**, not just against quotes.

## Not evaluated

Direct Nasdaq Nordic licensing (has a published European market-data price list, but
exchange-direct licensing carries per-user display fees and reporting obligations that
do not suit a small consumer product), Alpha Vantage, Financial Modeling Prep,
Polygon.io (thin non-US coverage), and broker-sourced data via the existing Avanza
integration — the last is worth a thought, since a connected user's own broker already
returns prices for the positions they hold.

## Sources

- [Börsdata API](https://borsdata.se/en/info/api/api_page) · [Börsdata API wiki](https://github.com/Borsdata-Sweden/API/wiki) · [Börsdata review 2026](https://www.findmymoat.com/tools/b-rsdata)
- [EODHD pricing](https://eodhd.com/pricing) · [EODHD commercial pricing](https://eodhd.com/commercial-pricing) · [EODHD exchange list](https://eodhd.com/list-of-stock-markets)
- [Twelve Data individual pricing](https://twelvedata.com/pricing) · [Twelve Data business pricing](https://twelvedata.com/pricing-business) · [Twelve Data exchanges](https://twelvedata.com/exchanges)
- [Marketstack product/pricing](https://marketstack.com/product)
- [Finnhub pricing](https://finnhub.io/pricing) · [Finnhub API cost summary 2026](https://apicostcalc.com/finnhub.html)
- [Nasdaq European market data price list, Jan 2026](https://www.nasdaq.com/docs/Nasdaq_European_Market_Other_Data_Products_Price_List_Jan_2026_REDLINE)
