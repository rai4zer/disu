import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isInstrumentBridgeConfigured, normaliseSymbol } from "../app/lib/market/instrument-bridge.ts";
import { tabsFor } from "../app/lib/market/instrument-cache.ts";
import type { InstrumentDetail } from "../app/lib/market/instrument-types.ts";
import { fullDetail, redactForPublic } from "../app/lib/market/instrument-visibility.ts";
import { placeraQuery, toolsFor } from "../app/lib/market/instrument-tools.ts";
import type { InstrumentProfile } from "../app/lib/market/instrument-types.ts";

// The instrument page is the app's largest new synthetic-data surface: four
// tabs, most of which do not exist for most instrument types. These tests pin
// the places where "just show something" would be the easy change.

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/**
 * Source with comments removed.
 *
 * Every one of these files *documents* the rule it follows — "must not name a
 * node builtin", "is not user-owned data" — so a scanner that cannot tell the
 * explanation from the code forbids writing the explanation down. Handles TS,
 * Python and SQL comment forms, which is all this file reads.
 */
function readRepoCodeOnly(relative: string): string {
  return readRepoFile(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/^\s*(?:\/\/|#|--).*$/gm, "");
}

test("a tab only exists when its data does", () => {
  // The whole design rests on this. Measured 2026-09-03: only EQUITY carries
  // financials and analyst coverage, and ^OMX returns no news either. A fixed
  // four-tab layout would give gold an empty "KPI" tab.
  assert.deepEqual(tabsFor({ overview: true, kpi: true, news: true, analysts: true }), [
    "overview",
    "kpi",
    "news",
    "analysts"
  ]);
  // An index: overview only.
  assert.deepEqual(tabsFor({ overview: true, kpi: false, news: false, analysts: false }), ["overview"]);
  // A commodity: overview and news, no financials to report.
  assert.deepEqual(tabsFor({ overview: true, kpi: false, news: true, analysts: false }), ["overview", "news"]);
  // Nothing resolved at all yields no tabs, rather than four empty ones.
  assert.deepEqual(tabsFor({ overview: false, kpi: false, news: false, analysts: false }), []);
});

test("malformed symbols are refused before they reach a spawn or a cache key", () => {
  assert.equal(normaliseSymbol("volv-b.st"), "VOLV-B.ST");
  assert.equal(normaliseSymbol("^OMX"), "^OMX");
  assert.equal(normaliseSymbol("GC=F"), "GC=F");
  assert.equal(normaliseSymbol("BTC-USD"), "BTC-USD");

  // The symbol reaches a shell-free spawn, so this is defence in depth rather
  // than the only guard — but it is also a cache key and a URL segment.
  for (const bad of ["", "   ", "A B", "AAPL;rm -rf /", "../../etc/passwd", "A".repeat(21), "<script>"]) {
    assert.equal(normaliseSymbol(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test("the bridge reports absence rather than defaulting a financial line", () => {
  const source = readRepoFile("app/lib/market/instrument-bridge.ts");
  // A period missing a line must stay missing. On a bar chart a zero bar and a
  // missing bar look identical and mean opposite things.
  assert.ok(
    source.includes("if (n !== null) parsed[key] = n;"),
    "a statement line must be omitted when absent, never defaulted to 0"
  );
  // Half a price-target range would render as a bound no analyst gave.
  assert.ok(
    source.includes("if (target.low !== undefined && target.high !== undefined)"),
    "a price target needs both bounds or neither"
  );
});

test("the python bridge never generates a company description", () => {
  // The overview summary is the issuer's own text. A model-written description
  // of a company, sitting next to a live price, is precisely the plausible
  // unauditable text docs/synthetic-data-policy.md exists to keep out.
  const source = readRepoCodeOnly("python/src/market/instrument.py");
  assert.ok(!/random|lorem|faker/i.test(source), "the bridge must not generate prose");
  assert.ok(
    source.includes('_text(info.get("longBusinessSummary"))'),
    "the summary must be passed through from the feed unedited"
  );
  // Only equities have financials; asking anyway costs two always-empty
  // upstream calls per index and commodity view.
  assert.ok(source.includes('if quote_type == "EQUITY":'), "financials must be gated on quote type");
});

test("news links are restricted to http(s) before they become an href", () => {
  // These URLs come from an upstream feed and are rendered as anchors. A
  // javascript: or data: URL must never reach the DOM.
  const source = readRepoFile("app/lib/market/instrument-bridge.ts");
  assert.ok(source.includes("/^https?:\\/\\//i.test(link)"), "news links must be scheme-checked");
});

test("instrument types stay importable by a client component", () => {
  // The page and its tabs are "use client" and need these types, while the
  // bridge spawns Python. The types therefore live in a leaf with no imports —
  // type-only imports are erased so the bundle was never actually broken, but
  // this keeps the boundary from depending on the `type` keyword surviving a
  // refactor. The delivery gate enforces the general rule.
  const source = readRepoCodeOnly("app/lib/market/instrument-types.ts");
  assert.ok(!/^import\s/m.test(source), "instrument-types.ts must stay dependency-free");
  assert.ok(!/node:/.test(source), "instrument-types.ts must not name a node builtin");
});

test("the cache never stores an unresolved instrument", () => {
  const migration = readRepoCodeOnly("db/migrations/0024_instrument_profiles.sql");
  // `payload` and `sections` are not-null: a symbol nobody has data for writes
  // no row, so "we have nothing" is the absence of a row rather than a row of
  // nulls the UI would render as a real instrument.
  assert.ok(migration.includes("payload jsonb not null"), "payload must be not-null");
  assert.ok(migration.includes("sections jsonb not null"), "sections must be not-null");
  assert.ok(!/user_id/.test(migration), "a company profile is not user-owned data");
});

test("the bridge is skipped, not crashed, without an interpreter", () => {
  const before = { market: process.env.MARKET_PYTHON_BIN, quant: process.env.QUANT_PYTHON_BIN };
  delete process.env.MARKET_PYTHON_BIN;
  delete process.env.QUANT_PYTHON_BIN;
  try {
    assert.equal(isInstrumentBridgeConfigured(), false);
  } finally {
    if (before.market !== undefined) process.env.MARKET_PYTHON_BIN = before.market;
    if (before.quant !== undefined) process.env.QUANT_PYTHON_BIN = before.quant;
  }
});

test("a signed-out reader gets the description but not the valuation", () => {
  // The product line (ROADMAP §1.3, §4.6): "what is this company" is public and
  // is what earns a visit and a search ranking; "what is it worth, should I buy
  // it" is the reason to sign up. This test is the definition of that line.
  const full: InstrumentDetail = {
    symbol: "AAPL",
    profile: {
      name: "Apple Inc.",
      quoteType: "EQUITY",
      exchange: "NasdaqGS",
      currency: "USD",
      summary: "Apple designs and sells consumer electronics.",
      sector: "Technology",
      industry: "Consumer Electronics",
      website: "https://apple.com",
      country: "United States",
      employees: 150000,
      ceo: "A Person",
      marketCap: 4e12,
      sharesOutstanding: 1.4e10,
      peRatio: 37.1,
      forwardPe: 30,
      priceToBook: 44,
      eps: 8.76,
      dividendYield: 0.32,
      beta: 1.16,
      fiftyTwoWeekHigh: 340,
      fiftyTwoWeekLow: 200
    },
    financials: { income: [{ period: "2025-09-30", revenue: 4e11 }], balance: [{ period: "2025-09-30", assets: 3e11 }] },
    news: [{ title: "A headline", publisher: "Reuters", publishedAt: null, link: null }],
    analysts: { analystCount: 44, priceTarget: { low: 215, high: 400 } },
    sections: { overview: true, kpi: true, news: true, analysts: true }
  };

  const publicView = redactForPublic(full);

  // Kept: what the company is.
  assert.equal(publicView.profile.name, "Apple Inc.");
  assert.equal(publicView.profile.summary, "Apple designs and sells consumer electronics.");
  assert.equal(publicView.profile.sector, "Technology");
  assert.equal(publicView.profile.employees, 150000);
  assert.equal(publicView.news.length, 1, "headlines stay public");

  // Withheld: what a prospective buyer would act on.
  for (const field of ["marketCap", "peRatio", "forwardPe", "priceToBook", "eps", "dividendYield", "beta", "sharesOutstanding", "fiftyTwoWeekHigh", "fiftyTwoWeekLow"] as const) {
    assert.equal(publicView.profile[field], null, `${field} must not reach an anonymous reader`);
  }
  assert.equal(publicView.financials, null, "financial statements are gated");
  assert.equal(publicView.analysts, null, "analyst coverage is gated");

  // The gated tabs disappear rather than rendering locked and empty.
  assert.equal(publicView.sections.kpi, false);
  assert.equal(publicView.sections.analysts, false);
  assert.equal(publicView.sections.overview, true);
  assert.equal(publicView.sections.news, true);
  assert.deepEqual(publicView.gated, ["kpi", "analysts", "valuation"]);

  // Redaction must not mutate the cached object — the same detail is handed to
  // a signed-in reader on the next request.
  assert.equal(full.profile.marketCap, 4e12, "redaction must not mutate its input");
  assert.equal(fullDetail(full).profile.peRatio, 37.1, "a signed-in reader keeps everything");
});

test("nothing is offered for unlocking that does not exist", () => {
  // An index has no P/E to withhold. Claiming otherwise invites someone to
  // sign up for nothing, which is worse than inviting them for nothing at all.
  const index: InstrumentDetail = {
    symbol: "^OMX",
    profile: {
      name: "OMX Stockholm 30", quoteType: "INDEX", exchange: "STO", currency: "SEK",
      summary: null, sector: null, industry: null, website: null, country: null,
      employees: null, ceo: null, marketCap: null, sharesOutstanding: null, peRatio: null,
      forwardPe: null, priceToBook: null, eps: null, dividendYield: null, beta: null,
      fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null
    },
    financials: null,
    news: [],
    analysts: null,
    sections: { overview: true, kpi: false, news: false, analysts: false }
  };
  assert.deepEqual(redactForPublic(index).gated, [], "an index has nothing to unlock");
});

test("a new profile field is private until it is listed", () => {
  // The allowlist is the point. A blocklist would leak every field added to the
  // payload after it was written; this fails closed instead.
  const source = readRepoCodeOnly("app/lib/market/instrument-visibility.ts");
  assert.ok(source.includes("PUBLIC_PROFILE_FIELDS"), "the public set must be an explicit allowlist");
  assert.ok(
    source.includes("satisfies ReadonlyArray<keyof InstrumentProfile>"),
    "the allowlist must be checked against the profile type so a renamed field is a compile error"
  );
});

test("each analysis tool is offered only where it can reach", () => {
  // Measured 2026-09-03, and the reason the tab strip tops out at six:
  // quant runs off price history (everything), primers read SEC EDGAR (US
  // filers), sentiment reads Placera (Swedish board). Primers and sentiment are
  // therefore mutually exclusive by geography — no instrument shows both.
  const equity = (over: Partial<InstrumentProfile>): InstrumentProfile => ({
    name: "X", quoteType: "EQUITY", exchange: null, currency: null, summary: null,
    sector: null, industry: null, website: null, country: null, employees: null,
    ceo: null, marketCap: null, sharesOutstanding: null, peRatio: null, forwardPe: null,
    priceToBook: null, eps: null, dividendYield: null, beta: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, ...over
  });

  const us = toolsFor("AAPL", equity({ exchange: "NasdaqGS" }));
  assert.deepEqual(us, { quant: true, sentiment: false, primers: true }, "a US filer gets primers, not Placera");

  const se = toolsFor("VOLV-B.ST", equity({ exchange: "Stockholm" }));
  assert.deepEqual(se, { quant: true, sentiment: true, primers: false }, "a Stockholm listing gets Placera, not primers");

  // Never both — that is what caps the strip at six tabs rather than seven.
  assert.ok(!(us.primers && us.sentiment) && !(se.primers && se.sentiment));

  // Non-equities: quant only. There is no filing to read and no forum thread.
  const index = toolsFor("^OMX", equity({ quoteType: "INDEX", exchange: "STO" }));
  assert.deepEqual(index, { quant: true, sentiment: false, primers: false });
  const gold = toolsFor("GC=F", equity({ quoteType: "FUTURE", exchange: "CMX" }));
  assert.deepEqual(gold, { quant: true, sentiment: false, primers: false });
});

test("the Placera query strips the legal wrapper but not the name", () => {
  // Yahoo reports the legal name; Placera's search does not match it. Measured
  // against the live endpoint: "AB Volvo (publ)" 404s, "Volvo" resolves.
  assert.equal(placeraQuery("AB Volvo (publ)"), "Volvo");
  assert.equal(placeraQuery("Investor AB (publ)"), "Investor");
  assert.equal(placeraQuery("H & M Hennes & Mauritz AB"), "H & M Hennes & Mauritz");

  // Conservative on purpose. Over-trimming would match a *different* company's
  // forum and attribute strangers' posts to this instrument, which is worse
  // than returning nothing.
  assert.equal(
    placeraQuery("Telefonaktiebolaget LM Ericsson (publ)"),
    "Telefonaktiebolaget LM Ericsson",
    "a name with no corporate-form wrapper must survive intact"
  );
  // Never empties out, whatever it is handed.
  assert.equal(placeraQuery("AB"), "AB");
  assert.equal(placeraQuery("   Volvo   "), "Volvo");
});
