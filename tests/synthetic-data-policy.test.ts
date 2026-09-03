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

test("the market desk reports observed readings, never hash-seeded ones", () => {
  // This page shipped with `stableChange()` and `stablePrice()`: a seed hashed
  // against the date, turned into a plausible percentage and a plausible level.
  // Every figure on the Nordic, commodity and currency tables was one of those.
  // It survived §2.1 only because that cleanup was tested against the dashboard
  // by name, so the guard is written per-surface from here on.
  const source = readRepoCode("app/sentiment/page.tsx");
  assert.ok(!source.includes("charCodeAt"), "no hash-seeded values on the market desk");
  assert.ok(!source.includes("stableChange"), "stableChange must stay deleted");
  assert.ok(!source.includes("stablePrice"), "stablePrice must stay deleted");
});

test("the market board and movers routes never invent a reading", () => {
  // Both routes rank and render upstream quotes. The rule they have to keep is
  // that an unread symbol stays unread: null to the client, "—" on the card,
  // and — for the movers ranking specifically — excluded rather than sorted as
  // if it were flat, which would put an unknown in the middle of a list whose
  // whole meaning is the ordering.
  const board = readRepoCode("app/api/market/board/route.ts");
  assert.ok(!board.includes('"0.00%"'), "the board must not render an unknown change as zero");
  assert.ok(
    board.includes("Number.isFinite(changePct) ? changePct : null"),
    "an unreadable change must reach the client as null, not as a zero"
  );
  assert.ok(
    board.includes("price: reading ? formatLevel"),
    "a level is only formatted when there is a reading behind it"
  );

  const movers = readRepoCode("app/api/market/movers/route.ts");
  assert.ok(
    movers.includes("Number.isFinite(changePct)"),
    "a name without a real change must be dropped from the ranking, not ranked at zero"
  );
});

test("the market strip says where its levels came from", () => {
  // Rule 3 of the policy: the flag has to survive every hop. The route has
  // always published `stale`, `source` and `asOf`; the strip read none of them
  // and rendered nine index levels with no provenance at all, which is the hop
  // where the flag was being dropped.
  const source = readRepoCode("app/components/market-strip.tsx");
  assert.ok(source.includes('data.source === "fallback"'), "the strip must branch on the route's source");
  assert.ok(source.includes("styles.provenanceStale"), "retained values must render differently from current ones");
  assert.ok(
    source.includes("copy.market.indicative"),
    "the badge text must come from the copy file so both languages carry the disclosure"
  );

  // A failed fetch leaves the previous numbers on screen. That is the right
  // call — they are real observations — but the badge must stop calling them
  // current, or the strip silently presents a frozen reading as a live one.
  assert.ok(source.includes("const degrade"), "an unreachable route must downgrade the badge");
});

test("the strip does not name a delay it cannot substantiate", () => {
  // ROADMAP §2.7 says to label market data "delayed 15 min". That wording is
  // correct for a *licensed* delayed feed, where 15 minutes is contractual.
  // The current source grants no such term, so a specific figure would be an
  // invented number on a user-facing surface — the exact thing this file
  // guards. "Indicative" is the honest label until a feed is contracted; at
  // that point this test should be updated deliberately, not deleted quietly.
  const copy = readRepoCode("app/i18n/ui-copy.ts");
  assert.ok(!/15\s*min/i.test(copy), "no contractual delay figure while the source grants none");
  for (const key of ["indicative:", "indicativeNote:", "lastKnown:", "lastKnownNote:"]) {
    assert.equal(
      copy.split(key).length - 1,
      2,
      `${key} must exist in both en and sv — a disclosure that only one language sees is not a disclosure`
    );
  }
});
