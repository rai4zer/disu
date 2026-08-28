import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  summarisePortfolio,
  type PortfolioPosition,
  type PortfolioTotals
} from "../app/lib/portfolio/portfolio-positions.ts";

// Guards ROADMAP §2.7 and decision D5. The portfolio total used to be
// `positions.reduce((sum, row) => sum + row.positionValue, 0)` labelled with
// `positions[0].currency` — it added SEK to USD and named the result after
// whichever holding sorted first. These tests pin the properties that made that
// wrong, not the shape of the fix.

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function position(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    id: "p1",
    source: "manual",
    ticker: "EVO.ST",
    symbol: "EVO.ST",
    name: "Evolution AB",
    shares: 10,
    quantity: 10,
    avgCost: null,
    currentPrice: 100,
    positionValue: 1000,
    marketValue: 1000,
    unrealizedPnl: null,
    accountType: null,
    broker: null,
    currency: "SEK",
    asOf: "2026-08-27T10:00:00.000Z",
    connectionId: null,
    previousClose: null,
    dayChangePct: null,
    dayChangeAmount: null,
    priceSource: "yahoo",
    synthetic: false,
    valueInDisplayCurrency: 1000,
    ...overrides
  };
}

test("a total sums only converted values, in one stated currency", () => {
  const totals = summarisePortfolio(
    [
      position({ id: "a", currency: "SEK", positionValue: 1000, valueInDisplayCurrency: 1000 }),
      position({ id: "b", currency: "USD", positionValue: 200, valueInDisplayCurrency: 2100 })
    ],
    "SEK"
  );

  assert.strictEqual(totals.displayCurrency, "SEK");
  assert.strictEqual(totals.total, 3100, "the USD holding must be converted, not added at face value");
  assert.strictEqual(totals.convertedCount, 2);
  assert.strictEqual(totals.unconvertedCount, 0);
});

// The original bug, stated as a property: the answer must not depend on order.
test("the total does not depend on the order of the holdings", () => {
  const sek = position({ id: "a", currency: "SEK", positionValue: 1000, valueInDisplayCurrency: 1000 });
  const usd = position({ id: "b", currency: "USD", positionValue: 200, valueInDisplayCurrency: 2100 });

  const forwards = summarisePortfolio([sek, usd], "SEK");
  const backwards = summarisePortfolio([usd, sek], "SEK");

  assert.strictEqual(forwards.total, backwards.total, "re-sorting the rows changed the total");
  assert.strictEqual(
    forwards.displayCurrency,
    backwards.displayCurrency,
    "re-sorting the rows changed which currency the total claims to be in"
  );
});

test("an unconvertible holding is excluded and reported, never added raw", () => {
  const totals = summarisePortfolio(
    [
      position({ id: "a", currency: "SEK", positionValue: 1000, valueInDisplayCurrency: 1000 }),
      position({ id: "b", currency: "JPY", positionValue: 50000, valueInDisplayCurrency: null })
    ],
    "SEK"
  );

  assert.strictEqual(totals.total, 1000, "an unconverted holding leaked into the total");
  assert.notStrictEqual(totals.total, 51000, "the raw JPY figure was added to a SEK total");
  assert.strictEqual(totals.convertedCount, 1);
  assert.strictEqual(totals.unconvertedCount, 1);
  assert.deepStrictEqual(totals.unconvertedCurrencies, ["JPY"]);
  assert.strictEqual(totals.positionCount, 2, "the user must still be told how many holdings they have");
});

test("an empty portfolio totals zero, not NaN", () => {
  const totals = summarisePortfolio([], "SEK");
  assert.strictEqual(totals.total, 0);
  assert.strictEqual(totals.positionCount, 0);
  assert.strictEqual(totals.unconvertedCount, 0);
  assert.deepStrictEqual(totals.unconvertedCurrencies, []);
});

test("placeholder-priced holdings are counted so the total can disclose them", () => {
  const totals = summarisePortfolio(
    [
      position({ id: "a", synthetic: false }),
      position({ id: "b", synthetic: true }),
      position({ id: "c", synthetic: true })
    ],
    "SEK"
  );
  assert.strictEqual(totals.syntheticCount, 2);
});

test("every currency present is reported exactly once, sorted", () => {
  const totals = summarisePortfolio(
    [
      position({ id: "a", currency: "JPY", valueInDisplayCurrency: null }),
      position({ id: "b", currency: "jpy", valueInDisplayCurrency: null }),
      position({ id: "c", currency: "AUD", valueInDisplayCurrency: null })
    ],
    "SEK"
  );
  assert.deepStrictEqual(totals.unconvertedCurrencies, ["AUD", "JPY"], "duplicates or casing leaked into the disclosure");
});

// --- The trap in the provider (ROADMAP §2.7) -----------------------------

test("getQuote never relabels an observed price with another currency", () => {
  const provider = readRepoFile("app/lib/market/market-provider.ts");
  const hybrid = provider.slice(provider.indexOf("class HybridMarketProvider"));
  const getQuote = hybrid.slice(hybrid.indexOf("async getQuote"), hybrid.indexOf("}\n}"));

  assert.ok(
    !/currency:\s*(currency|fallbackCurrency)/.test(getQuote),
    "HybridMarketProvider.getQuote assigns a caller-supplied currency onto a fetched quote. " +
      "That renames the unit without converting the number — use getQuoteInCurrency() instead (ROADMAP §2.7)."
  );
});

test("conversion is the only path that changes a quote's currency", () => {
  const provider = readRepoFile("app/lib/market/market-provider.ts");
  const convert = provider.slice(provider.indexOf("export async function getQuoteInCurrency"));
  // Where the currency is reassigned, the price must be scaled in the same object.
  assert.match(convert, /currency:\s*desiredCurrency/, "getQuoteInCurrency no longer sets the target currency");
  assert.match(convert, /price:\s*Math\.round\(snapshot\.price \* fxRate/, "the price is not converted alongside the label");
});

test("the display currency is a real ISO-shaped code and defaults to SEK", async () => {
  const { getDisplayCurrency } = await import("../app/lib/market/market-provider.ts");
  const previous = process.env.PORTFOLIO_DISPLAY_CURRENCY;

  delete process.env.PORTFOLIO_DISPLAY_CURRENCY;
  assert.strictEqual(getDisplayCurrency(), "SEK", "D5 picked SEK as the default display currency");

  process.env.PORTFOLIO_DISPLAY_CURRENCY = "eur";
  assert.strictEqual(getDisplayCurrency(), "EUR", "a configured currency should be normalised, not rejected");

  for (const junk of ["", "   ", "kronor", "S", "SEKK", "12"]) {
    process.env.PORTFOLIO_DISPLAY_CURRENCY = junk;
    assert.strictEqual(getDisplayCurrency(), "SEK", `"${junk}" should fall back to the default, not be used as a currency`);
  }

  if (previous === undefined) {
    delete process.env.PORTFOLIO_DISPLAY_CURRENCY;
  } else {
    process.env.PORTFOLIO_DISPLAY_CURRENCY = previous;
  }
});

// --- The page must not reintroduce the reduce ----------------------------

test("the portfolio page does not total across currencies itself", () => {
  const page = readRepoFile("app/portfolio/page.tsx");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(
    !/reduce\(\([^)]*\)\s*=>\s*[a-zA-Z]+\s*\+\s*row\.(positionValue|marketValue)/.test(code),
    "the page is summing positionValue across rows again — the server computes the total for a reason"
  );
  assert.ok(
    !/positions\[0\]\??\.currency/.test(code),
    "the page is naming a total after the first row's currency again (ROADMAP §2.7)"
  );
  assert.ok(code.includes("totals.displayCurrency"), "the total is not labelled with the display currency");
});

test("the page's totals type matches the server's", () => {
  const server = readRepoFile("app/lib/portfolio/portfolio-positions.ts");
  const page = readRepoFile("app/portfolio/page.tsx");

  const serverBlock = /export type PortfolioTotals = \{([\s\S]*?)\n\};/.exec(server);
  const pageBlock = /type PortfolioTotals = \{([\s\S]*?)\n\};/.exec(page);
  assert.ok(serverBlock && pageBlock, "could not find both PortfolioTotals declarations");

  const fields = (block: string) =>
    [...block.matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((match) => match[1]).sort();

  assert.deepStrictEqual(
    fields(pageBlock[1]),
    fields(serverBlock[1]),
    "the page's PortfolioTotals has drifted from the server's"
  );
});

// Type-level pin: PortfolioTotals must keep carrying the coverage counts, or the
// UI has no way to say "this total covers 3 of your 5 holdings".
test("the totals type still carries its disclosure fields", () => {
  const totals: PortfolioTotals = summarisePortfolio([], "SEK");
  for (const field of ["displayCurrency", "total", "positionCount", "convertedCount", "unconvertedCount", "unconvertedCurrencies", "syntheticCount"] as const) {
    assert.ok(field in totals, `PortfolioTotals lost ${field}`);
  }
});
