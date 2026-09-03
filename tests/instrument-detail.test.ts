import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isInstrumentBridgeConfigured, normaliseSymbol } from "../app/lib/market/instrument-bridge.ts";
import { tabsFor } from "../app/lib/market/instrument-cache.ts";

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
