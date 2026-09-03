/**
 * Runs the Python market bridge and parses its payload.
 *
 * Why a subprocess for something the app already does in TypeScript: Yahoo's
 * quote endpoints sit behind a crumb/cookie handshake that changes without
 * notice, and the hand-rolled client in `market-provider.ts` 403s on exactly
 * the symbols a Swedish portfolio is made of (`docs/market-live-feed.md`).
 * Maintaining that handshake is `yfinance`'s entire job. Measured 2026-09-03,
 * it resolves `VOLV-B.ST`, `^OMX`, `GC=F`, `SEKUSD=X` and `BTC-USD` — three of
 * which Finnhub refuses on the current plan.
 *
 * **Batch, never per symbol.** Spawning costs ~1.9s before the first symbol
 * (interpreter start plus the yfinance import) and ~0.2s per symbol after it.
 * One spawn for 24 symbols is ~7s; 24 spawns is ~50s. Every caller here is
 * expected to hand over every symbol it wants at once, which is also why this
 * is driven by a background sweep rather than by a request
 * (`app/lib/market/quote-cache.ts`).
 *
 * This module deliberately does not decide *policy*. It reports what the feed
 * said, including "nothing"; whether a missing price may be replaced by an
 * invented one is `MARKET_MOCK_FALLBACK_MODE`'s business, enforced in
 * `market-provider.ts`. The bridge has no synthetic mode at all, so there is
 * nothing here for that switch to permit.
 *
 * Contract: `docs/contracts/market-quote.schema.json`.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { killChildProcessTree } from "../jobs/subprocess.ts";
import { log } from "../observability/log.ts";

/** One symbol's reading, exactly as the bridge reported it. */
export type BridgeQuote = {
  symbol: string;
  /** `null` means no live source could price it. Never a substituted number. */
  price: number | null;
  /** `null` means the feed supplied no previous close — never a derived one. */
  previousClose: number | null;
  /** `null` means the feed did not say. Do not infer one from the ticker. */
  currency: string | null;
  /** Feed timestamp, not our clock. `null` when the feed supplied none. */
  asOf: string | null;
  source: "yfinance" | "finnhub" | "none";
  reason?: string;
};

export type BridgeResult = {
  quotes: BridgeQuote[];
  resolved: number;
  requested: number;
  elapsedMs: number;
};

export class MarketBridgeError extends Error {}

const BRIDGE_TIMEOUT_MS = 60_000;

/**
 * Which interpreter runs the bridge.
 *
 * Falls back to `QUANT_PYTHON_BIN` rather than to a bare `python3`, because the
 * dependency that matters (`yfinance`) lives in the project venv and a system
 * interpreter would fail at import with a confusing traceback rather than an
 * obvious misconfiguration. `MARKET_PYTHON_BIN` exists for deployments that
 * want a separate, lighter venv without the quant stack.
 */
function pythonBin(): string | null {
  const explicit = (process.env.MARKET_PYTHON_BIN ?? "").trim();
  if (explicit) return explicit;
  const shared = (process.env.QUANT_PYTHON_BIN ?? "").trim();
  return shared || null;
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStr(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Parse one entry, refusing anything that would put a fabricated number on a
 * screen. A non-positive price is treated as absent rather than as cheap: Yahoo
 * answers 0.0 for a delisted or mistyped ticker instead of erroring.
 */
function parseQuote(value: unknown, idx: number): BridgeQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketBridgeError(`Market bridge payload invalid: quotes[${idx}] must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const symbol = asStr(row.symbol);
  if (!symbol) {
    throw new MarketBridgeError(`Market bridge payload invalid: quotes[${idx}].symbol missing.`);
  }

  const source = asStr(row.source);
  if (source !== "yfinance" && source !== "finnhub" && source !== "none") {
    throw new MarketBridgeError(`Market bridge payload invalid: quotes[${idx}].source is "${String(row.source)}".`);
  }

  const rawPrice = asNum(row.price);
  const price = rawPrice !== null && rawPrice > 0 ? rawPrice : null;
  const rawPrevious = asNum(row.previousClose);
  const currency = asStr(row.currency);

  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose: rawPrevious !== null && rawPrevious > 0 ? rawPrevious : null,
    // A three-letter code or nothing. A malformed currency is dropped rather
    // than passed on, because it would be rendered next to a number as if
    // observed.
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null,
    asOf: asStr(row.asOf),
    // A price with no source, or a source with no price, is an inconsistent row
    // and the safe reading is the pessimistic one.
    source: price === null ? "none" : source === "none" ? "yfinance" : source,
    ...(asStr(row.reason) ? { reason: asStr(row.reason) as string } : {})
  };
}

function parsePayload(stdout: string): BridgeResult {
  // The bridge writes exactly one JSON object on stdout and everything
  // diagnostic on stderr, but a stray library print would still land here, so
  // the last non-empty line is the payload.
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();

  if (!line) {
    throw new MarketBridgeError("Market bridge produced no output.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    throw new MarketBridgeError(`Market bridge output was not JSON: ${line.slice(0, 200)}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new MarketBridgeError("Market bridge payload was not an object.");
  }
  const body = payload as Record<string, unknown>;

  if (body.ok !== true) {
    throw new MarketBridgeError(asStr(body.error) ?? "Market bridge reported failure.");
  }
  if (!Array.isArray(body.quotes)) {
    throw new MarketBridgeError("Market bridge payload invalid: quotes must be an array.");
  }

  const quotes = body.quotes.map(parseQuote);
  const meta = (body.meta ?? {}) as Record<string, unknown>;

  return {
    quotes,
    resolved: quotes.filter((q) => q.price !== null).length,
    requested: asNum(meta.requested) ?? quotes.length,
    elapsedMs: asNum(meta.elapsedMs) ?? 0
  };
}

/** True when an interpreter is configured. Callers skip the tier when it is not. */
export function isMarketBridgeConfigured(): boolean {
  return pythonBin() !== null;
}

/**
 * Fetch every symbol in one spawn.
 *
 * Symbols go in on stdin rather than argv: the dashboard board is 24 names, but
 * a user's holdings are not bounded, and a long argv is an OS limit waiting to
 * be hit in production and never in development.
 */
export async function fetchQuotesViaBridge(symbols: string[], signal?: AbortSignal): Promise<BridgeResult> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) {
    return { quotes: [], resolved: 0, requested: 0, elapsedMs: 0 };
  }

  const bin = pythonBin();
  if (!bin) {
    throw new MarketBridgeError("No Python interpreter configured (set MARKET_PYTHON_BIN or QUANT_PYTHON_BIN).");
  }

  const pythonRoot = path.join(process.cwd(), "python");
  const startedAt = Date.now();

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ["-m", "src.market.fetcher"], {
      cwd: pythonRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });

    let out = "";
    let err = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killChildProcessTree(child, "SIGKILL");
    }, BRIDGE_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      killChildProcessTree(child, "SIGKILL");
      finish(() => reject(new MarketBridgeError("Market bridge aborted.")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });

    child.on("error", (error) => {
      finish(() => reject(new MarketBridgeError(`Market bridge failed to start: ${error.message}`)));
    });

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(new MarketBridgeError(`Market bridge timed out after ${BRIDGE_TIMEOUT_MS}ms.`));
          return;
        }
        if (code !== 0) {
          reject(new MarketBridgeError(`Market bridge exited ${code}: ${err.trim().slice(0, 300)}`));
          return;
        }
        resolve(out);
      });
    });

    child.stdin.write(wanted.join("\n"));
    child.stdin.end();
  });

  const result = parsePayload(stdout);

  // The counter behind ROADMAP queue item 2.8 / decision 0001's tripwire W1:
  // without a per-source outcome count, "Yahoo started failing" is something a
  // human has to notice. This is the process-level record of every batch.
  log.info("market.bridge.batch", {
    requested: result.requested,
    resolved: result.resolved,
    unresolved: result.requested - result.resolved,
    bridgeMs: result.elapsedMs,
    wallMs: Date.now() - startedAt
  });

  return result;
}
