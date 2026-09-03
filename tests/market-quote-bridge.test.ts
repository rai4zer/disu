import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { fetchQuotesViaBridge, isMarketBridgeConfigured } from "../app/lib/market/quote-bridge.ts";
import { sweepUniverse } from "../app/lib/market/board-catalogue.ts";
import { marketSweepIntervalMs, runMarketQuoteSweep } from "../app/lib/market/quote-sweep.ts";

// The market bridge is a new synthetic-fallback surface, and the rule it has to
// obey is the one in docs/synthetic-data-policy.md: a price we could not observe
// is an absence, never a number. These tests pin the places where "fill it in"
// would be the easy change to make.

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

test("an empty symbol list never spawns an interpreter", async () => {
  // Cheap to get wrong and expensive in production: the sweep runs on a timer,
  // and a spawn per tick for zero symbols is a process leak that shows up as
  // memory rather than as an error.
  const result = await fetchQuotesViaBridge([]);
  assert.equal(result.quotes.length, 0);
  assert.equal(result.requested, 0);
});

test("the bridge is skipped, not failed, when no interpreter is configured", async () => {
  await withEnvAsync({ MARKET_PYTHON_BIN: "", QUANT_PYTHON_BIN: "" }, async () => {
    assert.equal(isMarketBridgeConfigured(), false);
    // A deployment with no Python is a supported configuration — the live
    // Yahoo/Finnhub tiers cover it — so the sweep must report a skip rather
    // than throw into the job worker's timer.
    const outcome = await runMarketQuoteSweep();
    assert.equal(outcome.written, 0);
    assert.ok(outcome.skipped, "a sweep with no interpreter must say why it did nothing");
  });
});

test("MARKET_MOCK_FALLBACK_MODE=always keeps the sweep off the network", async () => {
  // `always` means "never touch the network". A sweep that spawned Python
  // anyway would make the switch a lie about what the process did, which is the
  // same reason HybridMarketProvider.getQuote() short-circuits on it.
  await withEnvAsync(
    { MARKET_MOCK_FALLBACK_MODE: "always", MARKET_PYTHON_BIN: "/nonexistent/python" },
    async () => {
      const outcome = await runMarketQuoteSweep();
      assert.equal(outcome.requested, 0);
      assert.equal(outcome.written, 0);
      assert.match(String(outcome.skipped), /always/);
    }
  );
});

test("a failed bridge degrades the sweep instead of throwing", async () => {
  // The sweep runs on the job worker's shared timer. A throw here would take
  // every other chore on that timer down with it.
  await withEnvAsync(
    { MARKET_MOCK_FALLBACK_MODE: "never", MARKET_PYTHON_BIN: "/nonexistent/python-binary" },
    async () => {
      const outcome = await runMarketQuoteSweep();
      assert.equal(outcome.resolved, 0);
      assert.equal(outcome.written, 0);
      assert.ok(outcome.skipped, "a broken interpreter must be reported, not thrown");
    }
  );
});

test("the sweep universe covers every symbol the board and strip render", () => {
  // The failure this prevents: a card renders a symbol the sweep does not
  // fetch, so it is permanently cold and silently slower than the rest.
  const universe = new Set(sweepUniverse());
  const source = readRepoFile("app/lib/market/board-catalogue.ts");

  for (const symbol of ["^OMX", "^GSPC", "GC=F", "BTC-USD", "USDSEK=X", "VOLV-B.ST"]) {
    assert.ok(universe.has(symbol), `sweep universe is missing ${symbol}`);
  }
  assert.ok(universe.size > 40, `expected the board + strip + movers, got ${universe.size}`);
  assert.ok(!source.includes("Math.random"), "the catalogue must not generate symbols");
});

test("the sweep interval cannot be configured into a spawn loop", () => {
  // Each run starts an interpreter. A 5-second interval would leave several
  // alive at once, so the floor is a safety property rather than a preference.
  withEnv({ MARKET_QUOTE_SWEEP_INTERVAL_MS: "1000" }, () => {
    assert.ok(marketSweepIntervalMs() >= 60_000);
  });
  withEnv({ MARKET_QUOTE_SWEEP_INTERVAL_MS: "not-a-number" }, () => {
    assert.ok(marketSweepIntervalMs() >= 60_000);
  });
  withEnv({ MARKET_QUOTE_SWEEP_INTERVAL_MS: "600000" }, () => {
    assert.equal(marketSweepIntervalMs(), 600_000);
  });
});

test("the python bridge has no synthetic mode to enable", () => {
  // MARKET_MOCK_FALLBACK_MODE governs invented prices everywhere else. The
  // reason it needs no representation inside the bridge is that the bridge
  // cannot invent one — and that is a property worth pinning, because "return a
  // sensible default" is the natural thing to write in a fetcher.
  const source = readRepoFile("python/src/market/fetcher.py");
  assert.ok(!/random/i.test(source), "the fetcher must never generate a value");
  assert.ok(
    source.includes('"price": None'),
    "an unpriceable symbol must be reported with a null price, not omitted or defaulted"
  );
  // A non-positive price is a broken read, not a cheap instrument: Yahoo
  // answers 0.0 for a delisted or mistyped ticker rather than erroring.
  assert.ok(source.includes("out if out > 0 else None"), "non-positive prices must be rejected");
});

test("the cache refuses to store a reading it cannot account for", () => {
  const migration = readRepoFile("db/migrations/0023_market_quotes.sql");
  // The constraint does the work the code would otherwise have to remember:
  // there is no 'placeholder' source, so a fabricated price has no
  // representation in the table at all.
  assert.ok(migration.includes("check (price > 0)"), "price must be constrained positive");
  assert.ok(
    migration.includes("source in ('yfinance', 'finnhub')"),
    "the source check must exclude any synthetic value"
  );
  // Comments stripped before asserting, the way the delivery gate scans for
  // hosts: the prose here deliberately *discusses* placeholders in order to
  // explain their absence, and a test that cannot tell the explanation from the
  // schema would forbid documenting the decision.
  const sql = migration.replace(/^\s*--.*$/gm, "");
  assert.ok(!/placeholder/i.test(sql), "no placeholder source may be storable");
  // Two timestamps, because conflating them is how a stale reading gets
  // presented as current.
  assert.ok(migration.includes("as_of") && migration.includes("fetched_at"), "both timestamps are required");
});

async function withEnvAsync(overrides: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined || value === "") delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
