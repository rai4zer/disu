/**
 * The background sweep: the one place that spawns the Python market bridge.
 *
 * This exists so that no request ever pays for it. The bridge costs ~1.9s
 * before its first symbol and ~0.2s per symbol after, so a request that fetched
 * its own quotes would hand a real person a multi-second wait, and N concurrent
 * requests would start N interpreters. Instead one timer fetches the whole
 * board, writes it to `market_quotes`, and every route reads a table
 * (`app/lib/market/quote-cache.ts`).
 *
 * It also settles ROADMAP §2.7 item 2.3 — one fetch per symbol per interval
 * across all users — because the sweep's universe is a fixed list rather than
 * anything derived from who is signed in.
 *
 * Failure is contained on purpose. A sweep that throws would take the job
 * worker's timer down with it and quietly stop every other chore on that
 * timer, so everything here is caught and logged. The cost of a failed sweep is
 * that quotes go stale and the live provider tiers answer instead — which is
 * the behaviour the app had before this file existed.
 */

import { sweepUniverse } from "./board-catalogue.ts";
import { fetchQuotesViaBridge, isMarketBridgeConfigured } from "./quote-bridge.ts";
import { writeCachedQuotes } from "./quote-cache.ts";
import { marketFallbackMode } from "./market-provider.ts";
import { log } from "../observability/log.ts";

export type SweepOutcome = {
  requested: number;
  resolved: number;
  written: number;
  skipped?: string;
};

/**
 * Fetch the sweep universe and cache it.
 *
 * Returns rather than throws: the caller is a timer, and a rejected promise
 * there is an unhandled rejection.
 */
export async function runMarketQuoteSweep(): Promise<SweepOutcome> {
  // `always` means "never touch the network", and it is the mode tests and
  // offline demos run in. Spawning Python to fetch live prices under it would
  // make the switch a lie about what the process did — the same reasoning that
  // short-circuits HybridMarketProvider.getQuote().
  if (marketFallbackMode() === "always") {
    return { requested: 0, resolved: 0, written: 0, skipped: "MARKET_MOCK_FALLBACK_MODE=always" };
  }

  if (!isMarketBridgeConfigured()) {
    // Not an error: a deployment without a Python interpreter is a supported
    // configuration, and the live provider tiers cover it. Logged at info so it
    // is visible without paging anyone.
    log.info("market.sweep.skipped", { reason: "no Python interpreter configured" });
    return { requested: 0, resolved: 0, written: 0, skipped: "no interpreter" };
  }

  const symbols = sweepUniverse();
  if (symbols.length === 0) {
    return { requested: 0, resolved: 0, written: 0, skipped: "empty universe" };
  }

  try {
    const result = await fetchQuotesViaBridge(symbols);
    const written = await writeCachedQuotes(result.quotes);

    // The per-source outcome count behind decision 0001's tripwire W1. Until
    // an alerting sink exists (ROADMAP queue 1.4) this is a log line rather
    // than a page, but the number now exists to alert on — before this, "Yahoo
    // started refusing us" was something a human had to notice.
    const unresolved = result.requested - result.resolved;
    const fallbackRate = result.requested > 0 ? unresolved / result.requested : 0;
    const fields = {
      requested: result.requested,
      resolved: result.resolved,
      unresolved,
      written,
      fallbackRatePct: Math.round(fallbackRate * 1000) / 10,
      bridgeMs: result.elapsedMs
    };

    // A third of the board failing is not a bad symbol, it is a source problem.
    if (fallbackRate >= 0.34) {
      log.warn("market.sweep.degraded", fields);
    } else {
      log.info("market.sweep.completed", fields);
    }

    return { requested: result.requested, resolved: result.resolved, written };
  } catch (error) {
    log.error("market.sweep.failed", {
      symbols: symbols.length,
      error: error instanceof Error ? error.message : String(error)
    });
    return { requested: symbols.length, resolved: 0, written: 0, skipped: "bridge failed" };
  }
}

/**
 * How often to refresh.
 *
 * Floored at one minute so a misconfigured value cannot turn the sweep into a
 * spawn loop — each run starts an interpreter, and a 5-second interval would
 * leave several alive at once.
 */
export function marketSweepIntervalMs(): number {
  const raw = Number(process.env.MARKET_QUOTE_SWEEP_INTERVAL_MS ?? String(5 * 60 * 1000));
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 5 * 60 * 1000;
}
