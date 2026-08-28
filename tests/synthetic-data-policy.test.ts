import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { computeDayChange, createPlaceholderQuote, type QuoteSnapshot } from "../app/lib/market/quote.ts";

// Guards the repo-wide rule in docs/synthetic-data-policy.md: synthetic values
// must be flagged all the way to the UI, and nothing derived from them may be
// presented as an observation.

function observedQuote(overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    symbol: "EVO.ST",
    currency: "SEK",
    price: 110,
    previousClose: 100,
    asOf: "2026-08-20T15:00:00.000Z",
    source: "yahoo",
    synthetic: false,
    ...overrides
  };
}

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

// Comments explaining the rule are not violations of it.
function readRepoCode(relative: string): string {
  return readRepoFile(relative)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

test("placeholder quotes are flagged synthetic and carry no previous close", () => {
  const quote = createPlaceholderQuote("EVO.ST", "SEK");
  assert.equal(quote.synthetic, true);
  assert.equal(quote.source, "placeholder");
  assert.equal(quote.previousClose, null);
});

test("computeDayChange refuses to derive a change from a synthetic quote", () => {
  const synthetic = observedQuote({ synthetic: true, source: "placeholder", previousClose: 100 });
  assert.equal(computeDayChange(synthetic, 10), null);
});

test("computeDayChange reports unavailable when there is no previous close", () => {
  assert.equal(computeDayChange(observedQuote({ previousClose: null }), 10), null);
  assert.equal(computeDayChange(observedQuote({ previousClose: 0 }), 10), null);
});

test("computeDayChange returns the real previous-close-vs-last change", () => {
  const change = computeDayChange(observedQuote(), 10);
  assert.ok(change);
  assert.equal(Math.round(change.pct * 100) / 100, 10);
  assert.equal(change.amount, 100);
});

test("dashboard renders no hash-derived numbers", () => {
  const source = readRepoFile("app/dashboard/page.tsx");
  assert.ok(!source.includes("stableDayMovePct"), "stableDayMovePct must stay deleted");
  assert.ok(!source.includes("charCodeAt"), "no hash-seeded values on the dashboard");
});

test("an empty dashboard stays empty rather than showing invented example figures", () => {
  // The old first-run screen filled its panels with made-up "this is what it
  // looks like once you hold something" numbers. A labelled fabrication is
  // still a fabrication sitting where the reader's own money goes, and a
  // screenshot of it is indistinguishable from the real thing.
  const source = readRepoFile("app/dashboard/page.tsx");
  for (const removed of ["EXAMPLE_DAILY_MOVE", "EXAMPLE_MARKET_VALUE", "EXAMPLE_MOVERS", "EXAMPLE_CURRENCY"]) {
    assert.ok(!source.includes(removed), `${removed} must stay deleted`);
  }
});

test("the portfolio chart never fabricates a day it was not given", () => {
  const source = readRepoFile("app/components/portfolio-chart.tsx");
  // A gap is broken into separate paths, never bridged by a carried-forward or
  // interpolated value (migration 0021, docs/synthetic-data-policy.md).
  assert.ok(source.includes("MAX_JOINABLE_GAP_DAYS"), "the chart must cut its line across an unobserved stretch");
  assert.ok(source.includes("segments.push"), "the line is drawn as segments, so a gap can stay a gap");
});

test("no user-facing surface reports an unknown change as a flat zero", () => {
  for (const file of ["app/api/market/indices/route.ts", "app/components/market-strip.tsx"]) {
    assert.ok(!readRepoCode(file).includes('"0.00%"'), `${file} must render "--" for a missing reading`);
  }
});

test("the portfolio table labels placeholder prices", () => {
  const source = readRepoFile("app/portfolio/page.tsx");
  assert.ok(source.includes("row.synthetic"), "price cell must branch on the synthetic flag");
});
