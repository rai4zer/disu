import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MarketDataUnavailableError,
  __clearFxCacheForTests,
  getMarketProvider,
  marketFallbackMode,
  syntheticFallbackAllowed,
  tryGetQuoteInCurrency
} from "../app/lib/market/market-provider.ts";

// Guards ROADMAP §2.7: market data is the third synthetic-fallback path, and it
// was the one with no production kill-switch. A Yahoo rate-limit used to turn
// every holding into a hash of its ticker.

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production refuses synthetic prices even with the variable unset", () => {
  withEnv({ NODE_ENV: "production", MARKET_MOCK_FALLBACK_MODE: undefined }, () => {
    assert.strictEqual(marketFallbackMode(), "never", "missing config must fail closed in production");
    assert.strictEqual(syntheticFallbackAllowed(), false);
  });
});

test("the mode is honoured explicitly, in every environment", () => {
  for (const nodeEnv of ["production", "development", "test"]) {
    withEnv({ NODE_ENV: nodeEnv, MARKET_MOCK_FALLBACK_MODE: "never" }, () => {
      assert.strictEqual(syntheticFallbackAllowed(), false, `never ignored under NODE_ENV=${nodeEnv}`);
    });
    withEnv({ NODE_ENV: nodeEnv, MARKET_MOCK_FALLBACK_MODE: "always" }, () => {
      assert.strictEqual(marketFallbackMode(), "always", `always ignored under NODE_ENV=${nodeEnv}`);
    });
  }
});

test("outside production the default still allows an offline placeholder", () => {
  withEnv({ NODE_ENV: "development", MARKET_MOCK_FALLBACK_MODE: undefined }, () => {
    assert.strictEqual(marketFallbackMode(), "offline");
    assert.strictEqual(syntheticFallbackAllowed(), true, "local dev should not need the network");
  });
});

test("an unrecognised mode falls back to the safe default, never to always", () => {
  for (const junk of ["", "  ", "yes", "true", "mock", "1"]) {
    withEnv({ NODE_ENV: "production", MARKET_MOCK_FALLBACK_MODE: junk }, () => {
      assert.strictEqual(marketFallbackMode(), "never", `"${junk}" must not enable synthetic prices in production`);
    });
  }
});

// The behaviour that matters: with both live sources dead and fallback off, the
// provider must fail rather than invent. Both hosts are blocked by pointing the
// process at a fetch that always rejects.
test("with every live source down and fallback off, no number is invented", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network disabled for test");
  }) as typeof fetch;
  __clearFxCacheForTests();

  try {
    process.env.MARKET_MOCK_FALLBACK_MODE = "never";
    const provider = getMarketProvider();

    await assert.rejects(
      () => provider.getQuote("EVO.ST"),
      (error: unknown) => {
        assert.ok(
          error instanceof MarketDataUnavailableError,
          `expected MarketDataUnavailableError, got ${String(error)}`
        );
        assert.strictEqual((error as MarketDataUnavailableError).symbol, "EVO.ST");
        return true;
      },
      "the provider produced a quote with no live source and fallback disabled"
    );
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MARKET_MOCK_FALLBACK_MODE;
    __clearFxCacheForTests();
  }
});

test("the null-returning variant reports unavailable instead of throwing", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network disabled for test");
  }) as typeof fetch;
  __clearFxCacheForTests();

  try {
    process.env.MARKET_MOCK_FALLBACK_MODE = "never";
    const quote = await tryGetQuoteInCurrency("EVO.ST", "SEK");
    assert.strictEqual(quote, null, "one dead ticker must not throw the whole portfolio away");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MARKET_MOCK_FALLBACK_MODE;
    __clearFxCacheForTests();
  }
});

test("with fallback permitted the placeholder is produced, and flagged", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network disabled for test");
  }) as typeof fetch;
  __clearFxCacheForTests();

  try {
    process.env.MARKET_MOCK_FALLBACK_MODE = "offline";
    const quote = await getMarketProvider().getQuote("EVO.ST", "SEK");
    assert.strictEqual(quote.synthetic, true, "a placeholder that is not flagged is a lie");
    assert.strictEqual(quote.source, "placeholder");
    assert.strictEqual(quote.previousClose, null, "a placeholder must not imply a day change");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MARKET_MOCK_FALLBACK_MODE;
    __clearFxCacheForTests();
  }
});

test("mode always short-circuits the network entirely", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("should not be reached");
  }) as typeof fetch;

  try {
    process.env.MARKET_MOCK_FALLBACK_MODE = "always";
    const quote = await getMarketProvider().getQuote("EVO.ST", "SEK");
    assert.strictEqual(quote.synthetic, true);
    assert.strictEqual(called, false, "`always` still hit the network — the mode misdescribes what the process did");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MARKET_MOCK_FALLBACK_MODE;
  }
});

// --- Structure: the chain, and where synthesis is allowed to happen ------

const PROVIDER = readRepoFile("app/lib/market/market-provider.ts");

test("the chain is Yahoo, then Finnhub, then policy", () => {
  const hybrid = PROVIDER.slice(PROVIDER.indexOf("class HybridMarketProvider"));
  const getQuote = hybrid.slice(hybrid.indexOf("async getQuote"));
  const yahooAt = getQuote.indexOf("this.yahoo.getQuote");
  const finnhubAt = getQuote.indexOf("this.finnhub.getQuote");
  const placeholderAt = getQuote.indexOf("syntheticFallbackAllowed");

  assert.ok(yahooAt !== -1, "Yahoo is not in the chain");
  assert.ok(finnhubAt !== -1, "Finnhub is not in the chain");
  assert.ok(yahooAt < finnhubAt, "Finnhub is tried before Yahoo");
  assert.ok(finnhubAt < placeholderAt, "the synthetic gate is checked before the live sources are exhausted");
});

test("only the placeholder provider can produce a synthetic quote", () => {
  // createPlaceholderQuote is the single source of invented numbers. If it is
  // called anywhere other than PlaceholderMarketProvider, the fallback gate can
  // be bypassed without anyone noticing.
  const calls = [...PROVIDER.matchAll(/createPlaceholderQuote\(/g)];
  assert.strictEqual(calls.length, 1, "createPlaceholderQuote is called more than once — the gate is bypassable");

  const placeholderClass = PROVIDER.slice(
    PROVIDER.indexOf("class PlaceholderMarketProvider"),
    PROVIDER.indexOf("class HybridMarketProvider")
  );
  assert.ok(placeholderClass.includes("createPlaceholderQuote("), "the one call is not inside PlaceholderMarketProvider");
});

test("FX rates are never synthesised", () => {
  const fx = PROVIDER.slice(PROVIDER.indexOf("async function getFxRate"), PROVIDER.indexOf("__clearFxCacheForTests"));
  assert.ok(!/createPlaceholderQuote|synthetic/.test(fx), "an FX rate is being invented; there is no honest placeholder for a rate");
  assert.ok(fx.includes("fetchFinnhubFxRate"), "FX does not fail over to Finnhub");
  assert.ok(/throw new Error\(`FX rate unavailable/.test(fx), "a missing FX rate does not fail loudly");
});

test("Finnhub treats a zero price as a failure, not a quote", () => {
  const fn = PROVIDER.slice(PROVIDER.indexOf("async function fetchFinnhubQuote"));
  assert.ok(
    /price <= 0/.test(fn.slice(0, fn.indexOf("return {"))),
    "Finnhub answers unknown symbols with 200 and c=0; that must not become a zero-valued holding"
  );
});

test("the indices route no longer speaks to Finnhub directly", () => {
  const route = readRepoFile("app/api/market/indices/route.ts");
  assert.ok(
    !route.includes("finnhub.io/api"),
    "the indices route still builds its own Finnhub URLs — token handling and JSON validation should be shared"
  );
  assert.ok(route.includes("finnhubFetch"), "the indices route does not use the shared Finnhub client");
});

test("an unpriced holding is excluded from the total and counted", async () => {
  const { summarisePortfolio } = await import("../app/lib/portfolio/portfolio-positions.ts");
  const base = {
    id: "a", source: "manual" as const, ticker: "EVO.ST", symbol: "EVO.ST", name: "EVO.ST",
    shares: 10, quantity: 10, avgCost: null, accountType: null, broker: null,
    currency: "SEK", asOf: "2026-08-27T10:00:00.000Z", connectionId: null,
    previousClose: null, dayChangePct: null, dayChangeAmount: null, unrealizedPnl: null
  };
  const totals = summarisePortfolio(
    [
      { ...base, id: "a", currentPrice: 100, positionValue: 1000, marketValue: 1000, priceSource: "yahoo", synthetic: false, valueInDisplayCurrency: 1000 },
      { ...base, id: "b", currentPrice: null, positionValue: null, marketValue: null, priceSource: "unavailable", synthetic: false, valueInDisplayCurrency: null }
    ],
    "SEK"
  );

  assert.strictEqual(totals.total, 1000, "an unpriced holding leaked into the total");
  assert.strictEqual(totals.unavailableCount, 1);
  assert.strictEqual(totals.positionCount, 2, "the user must still see they hold two things");
  assert.strictEqual(totals.syntheticCount, 0, "unavailable is not the same as synthetic");
});
