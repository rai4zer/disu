/**
 * Runs the instrument detail bridge and parses its payload.
 *
 * Same spawn economics as `quote-bridge.ts` (~1.9s interpreter + import), but a
 * different access pattern: this is per *symbol*, driven by someone opening a
 * page, and the symbol is whatever they typed. It cannot be swept in advance —
 * there are ~800 distinct held symbols plus anything searchable — so the first
 * viewer of a symbol pays the spawn and `instrument-cache.ts` makes sure the
 * next one does not.
 *
 * Every section is optional and `sections` decides what the page renders. Only
 * equities carry financials and analyst coverage; an index carries neither and
 * no news either (measured 2026-09-03). Nothing here fills those gaps in.
 *
 * Contract: `docs/contracts/instrument-profile.schema.json`.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { killChildProcessTree } from "../jobs/subprocess.ts";
import { log } from "../observability/log.ts";
import type {
  InstrumentAnalysts,
  InstrumentDetail,
  InstrumentNews,
  InstrumentProfile,
  InstrumentSections,
  StatementPeriod
} from "./instrument-types.ts";

export type {
  InstrumentAnalysts,
  InstrumentDetail,
  InstrumentNews,
  InstrumentProfile,
  InstrumentSections,
  StatementPeriod
};

export class InstrumentBridgeError extends Error {}

const BRIDGE_TIMEOUT_MS = 45_000;

/** Symbols reach a shell-free `spawn`, but they also key a cache and a URL. */
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,20}$/;

export function normaliseSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function pythonBin(): string | null {
  const explicit = (process.env.MARKET_PYTHON_BIN ?? "").trim();
  if (explicit) return explicit;
  return (process.env.QUANT_PYTHON_BIN ?? "").trim() || null;
}

export function isInstrumentBridgeConfigured(): boolean {
  return pythonBin() !== null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseProfile(value: unknown): InstrumentProfile {
  const o = (value ?? {}) as Record<string, unknown>;
  return {
    name: str(o.name),
    quoteType: str(o.quoteType)?.toUpperCase() ?? null,
    exchange: str(o.exchange),
    currency: str(o.currency)?.toUpperCase() ?? null,
    summary: str(o.summary),
    sector: str(o.sector),
    industry: str(o.industry),
    website: str(o.website),
    country: str(o.country),
    employees: num(o.employees),
    ceo: str(o.ceo),
    marketCap: num(o.marketCap),
    sharesOutstanding: num(o.sharesOutstanding),
    peRatio: num(o.peRatio),
    forwardPe: num(o.forwardPe),
    priceToBook: num(o.priceToBook),
    eps: num(o.eps),
    dividendYield: num(o.dividendYield),
    beta: num(o.beta),
    fiftyTwoWeekHigh: num(o.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(o.fiftyTwoWeekLow)
  };
}

const STATEMENT_KEYS = [
  "revenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "assets",
  "equity",
  "debt",
  "liabilities"
] as const;

function parseStatement(value: unknown): StatementPeriod[] {
  if (!Array.isArray(value)) return [];
  const out: StatementPeriod[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const period = str(row.period);
    if (!period) continue;
    const parsed: StatementPeriod = { period };
    for (const key of STATEMENT_KEYS) {
      const n = num(row[key]);
      // Absent stays absent. Defaulting to 0 here would draw a bar asserting
      // the company reported nothing, which is a different claim entirely.
      if (n !== null) parsed[key] = n;
    }
    out.push(parsed);
  }
  return out;
}

function parseNews(value: unknown): InstrumentNews[] {
  if (!Array.isArray(value)) return [];
  const out: InstrumentNews[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const title = str(row.title);
    if (!title) continue;
    const link = str(row.link);
    out.push({
      title,
      publisher: str(row.publisher),
      publishedAt: str(row.publishedAt),
      // Only http(s) survives. These links are rendered as anchors, and a
      // `javascript:` or `data:` URL arriving from an upstream feed must never
      // reach an href.
      link: link && /^https?:\/\//i.test(link) ? link : null
    });
  }
  return out;
}

function parseAnalysts(value: unknown): InstrumentAnalysts | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const out: InstrumentAnalysts = {};

  if (o.recommendations && typeof o.recommendations === "object") {
    const r = o.recommendations as Record<string, unknown>;
    const spread: InstrumentAnalysts["recommendations"] = {};
    let total = 0;
    for (const key of ["strongBuy", "buy", "hold", "sell", "strongSell"] as const) {
      const n = num(r[key]);
      if (n !== null && n >= 0) {
        spread[key] = Math.round(n);
        total += n;
      }
    }
    if (total > 0) {
      out.recommendations = spread;
      out.analystCount = num(o.analystCount) ?? total;
    }
  }

  if (o.priceTarget && typeof o.priceTarget === "object") {
    const t = o.priceTarget as Record<string, unknown>;
    const target: NonNullable<InstrumentAnalysts["priceTarget"]> = {};
    for (const key of ["current", "low", "high", "mean", "median"] as const) {
      const n = num(t[key]);
      if (n !== null && n > 0) target[key] = n;
    }
    // Both ends or nothing: half a range rendered as a range is a fabricated
    // bound.
    if (target.low !== undefined && target.high !== undefined) out.priceTarget = target;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function parsePayload(stdout: string, symbol: string): InstrumentDetail {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) throw new InstrumentBridgeError("Instrument bridge produced no output.");

  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    throw new InstrumentBridgeError(`Instrument bridge output was not JSON: ${line.slice(0, 200)}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new InstrumentBridgeError("Instrument bridge payload was not an object.");
  }

  const body = payload as Record<string, unknown>;
  if (body.ok !== true) {
    throw new InstrumentBridgeError(str(body.error) ?? "Instrument bridge reported failure.");
  }

  const profile = parseProfile(body.profile);
  const income = parseStatement((body.financials as Record<string, unknown> | null)?.income);
  const balance = parseStatement((body.financials as Record<string, unknown> | null)?.balance);
  const news = parseNews(body.news);
  const analysts = parseAnalysts(body.analysts);

  // `sections` is recomputed from what actually parsed rather than trusted from
  // the payload. The bridge and this parser can disagree — a news item dropped
  // here for a bad link, say — and the tab list must describe what the page
  // will really be able to render.
  return {
    symbol: str(body.symbol) ?? symbol,
    profile,
    financials: income.length > 0 || balance.length > 0 ? { income, balance } : null,
    news,
    analysts,
    sections: {
      overview: Boolean(profile.name),
      kpi: income.length > 0 || balance.length > 0,
      news: news.length > 0,
      analysts: analysts !== null
    }
  };
}

export async function fetchInstrumentViaBridge(symbol: string, signal?: AbortSignal): Promise<InstrumentDetail> {
  const normalized = normaliseSymbol(symbol);
  if (!normalized) {
    throw new InstrumentBridgeError(`Refusing to look up malformed symbol: ${symbol.slice(0, 32)}`);
  }

  const bin = pythonBin();
  if (!bin) {
    throw new InstrumentBridgeError("No Python interpreter configured (set MARKET_PYTHON_BIN or QUANT_PYTHON_BIN).");
  }

  const startedAt = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    // Symbol goes as an argv element to a shell-free spawn, so it is never
    // interpreted; SYMBOL_PATTERN above is belt-and-braces on top of that.
    const child = spawn(bin, ["-m", "src.market.instrument", normalized], {
      cwd: path.join(process.cwd(), "python"),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
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
      finish(() => reject(new InstrumentBridgeError("Instrument bridge aborted.")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", (error) => {
      finish(() => reject(new InstrumentBridgeError(`Instrument bridge failed to start: ${error.message}`)));
    });
    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(new InstrumentBridgeError(`Instrument bridge timed out after ${BRIDGE_TIMEOUT_MS}ms.`));
          return;
        }
        if (code !== 0) {
          reject(new InstrumentBridgeError(`Instrument bridge exited ${code}: ${err.trim().slice(0, 300)}`));
          return;
        }
        resolve(out);
      });
    });
  });

  const detail = parsePayload(stdout, normalized);

  log.info("market.instrument.fetched", {
    symbol: normalized,
    quoteType: detail.profile.quoteType,
    sections: Object.entries(detail.sections)
      .filter(([, on]) => on)
      .map(([name]) => name)
      .join(","),
    wallMs: Date.now() - startedAt
  });

  return detail;
}
