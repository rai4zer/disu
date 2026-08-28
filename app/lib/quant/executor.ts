import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { killChildProcessTree } from "../jobs/subprocess.ts";

export type QuantJobResult =
  | {
      ok: true;
      ticker: string;
      rows: Array<{
        date: string;
        ticker: string;
        horizon: number;
        adj_close: number;
        pred_return: number;
        p_up_raw: number;
        p_up: number;
        implied_price: number;
        model_path: string;
      }>;
      history: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        adj_close: number;
        dividends: number;
      }>;
      reports: Array<{
        filedAt: string;
        form: "10-K" | "10-Q";
        quarter: "Q1" | "Q2" | "Q3" | "Q4" | null;
      }>;
      meta?: {
        modelVersion: string;
        bridgeVersion: string;
        fallbackMode: "none" | "offline";
        cached?: boolean;
      };
    }
  | {
      ok: false;
      error: string;
      traceback?: string;
    };

let tickerCikMapPromise: Promise<Map<string, string>> | null = null;

const QUANT_BRIDGE_VERSION = "quant-bridge-v1";

function asObj(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseQuantRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Quant bridge payload invalid: rows must be an array.");
  }
  return value.map((row, idx) => {
    const o = asObj(row);
    if (!o) {
      throw new Error(`Quant bridge payload invalid: rows[${idx}] must be an object.`);
    }
    const date = asStr(o.date);
    const ticker = asStr(o.ticker);
    const horizon = asNum(o.horizon);
    const adjClose = asNum(o.adj_close);
    const predReturn = asNum(o.pred_return);
    const pUpRaw = asNum(o.p_up_raw);
    const pUp = asNum(o.p_up);
    const impliedPrice = asNum(o.implied_price);
    const modelPath = asStr(o.model_path);
    if (
      !date ||
      !ticker ||
      horizon === null ||
      adjClose === null ||
      predReturn === null ||
      pUpRaw === null ||
      pUp === null ||
      impliedPrice === null ||
      !modelPath
    ) {
      throw new Error(`Quant bridge payload invalid: rows[${idx}] has invalid fields.`);
    }
    return {
      date,
      ticker,
      horizon,
      adj_close: adjClose,
      pred_return: predReturn,
      p_up_raw: pUpRaw,
      p_up: pUp,
      implied_price: impliedPrice,
      model_path: modelPath
    };
  });
}

function parseHistory(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Quant bridge payload invalid: history must be an array.");
  }
  return value.map((point, idx) => {
    const o = asObj(point);
    if (!o) {
      throw new Error(`Quant bridge payload invalid: history[${idx}] must be an object.`);
    }
    const date = asStr(o.date);
    const open = asNum(o.open);
    const high = asNum(o.high);
    const low = asNum(o.low);
    const close = asNum(o.close);
    const adjClose = asNum(o.adj_close);
    const dividends = asNum(o.dividends);
    if (
      !date ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      adjClose === null ||
      dividends === null
    ) {
      throw new Error(`Quant bridge payload invalid: history[${idx}] has invalid fields.`);
    }
    return {
      date,
      open,
      high,
      low,
      close,
      adj_close: adjClose,
      dividends
    };
  });
}

function parseReports(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((report) => {
      const o = asObj(report);
      if (!o) {
        return null;
      }
      const filedAt = asStr(o.filedAt);
      const form = asStr(o.form);
      const quarterRaw = o.quarter;
      if (!filedAt || (form !== "10-K" && form !== "10-Q")) {
        return null;
      }
      const quarter =
        quarterRaw === null || quarterRaw === "Q1" || quarterRaw === "Q2" || quarterRaw === "Q3" || quarterRaw === "Q4"
          ? quarterRaw
          : null;
      return { filedAt, form, quarter };
    })
    .filter((value): value is { filedAt: string; form: "10-K" | "10-Q"; quarter: "Q1" | "Q2" | "Q3" | "Q4" | null } => Boolean(value));
}

function validateQuantBridgePayload(payload: unknown): QuantJobResult {
  const obj = asObj(payload);
  if (!obj) {
    throw new Error("Quant bridge payload invalid: expected JSON object.");
  }
  const ok = asBool(obj.ok);
  if (ok === false) {
    const error = asStr(obj.error) ?? "Quant bridge failed.";
    const traceback = asStr(obj.traceback) ?? undefined;
    return { ok: false, error, traceback };
  }
  if (ok !== true) {
    throw new Error("Quant bridge payload invalid: missing ok flag.");
  }

  const ticker = asStr(obj.ticker);
  if (!ticker) {
    throw new Error("Quant bridge payload invalid: missing ticker.");
  }

  return {
    ok: true,
    ticker,
    rows: parseQuantRows(obj.rows),
    history: parseHistory(obj.history),
    reports: parseReports(obj.reports)
  };
}

function quantFallbackMode(): "never" | "offline" | "always" {
  const raw = (process.env.QUANT_MOCK_FALLBACK_MODE ?? "").trim().toLowerCase();
  if (raw === "never") return "never";
  if (raw === "always") return "always";
  if (raw === "offline") return "offline";
  return process.env.NODE_ENV !== "production" ? "offline" : "never";
}

function mockEnabled(): boolean {
  const mode = quantFallbackMode();
  if (mode === "always") {
    return true;
  }
  if (mode === "never") {
    return false;
  }
  const raw = (process.env.QUANT_ALLOW_MOCK_FALLBACK ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false;
  }
  return process.env.NODE_ENV !== "production";
}

function looksLikeOfflineFailure(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("no price data returned") ||
    text.includes("dnserror") ||
    text.includes("could not resolve host") ||
    text.includes("failed to perform, curl: (6)")
  );
}

function hashTickerSeed(ticker: string): number {
  let h = 2166136261;
  for (const ch of ticker) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let v = Math.imul(t ^ (t >>> 15), 1 | t);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function createMockQuantResult(ticker: string): QuantJobResult {
  const seed = hashTickerSeed(ticker);
  const random = seededRandom(seed);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points = 120;
  const history: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    adj_close: number;
    dividends: number;
  }> = [];
  const basePrice = 40 + random() * 320;
  let close = basePrice;
  for (let i = points - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) {
      continue;
    }
    const drift = (random() - 0.49) * 0.02;
    const open = close * (1 + (random() - 0.5) * 0.006);
    const nextClose = Math.max(1, close * (1 + drift));
    const high = Math.max(open, nextClose) * (1 + random() * 0.008);
    const low = Math.min(open, nextClose) * (1 - random() * 0.008);
    const dividends = random() > 0.985 ? Number((random() * 0.6).toFixed(2)) : 0;
    close = nextClose;
    history.push({
      date: toIsoDate(date),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(nextClose.toFixed(2)),
      adj_close: Number(nextClose.toFixed(2)),
      dividends
    });
  }

  const latest = history[history.length - 1];
  const horizons = [1, 5, 20, 60];
  const rows: Array<{
    date: string;
    ticker: string;
    horizon: number;
    adj_close: number;
    pred_return: number;
    p_up_raw: number;
    p_up: number;
    implied_price: number;
    model_path: string;
  }> = horizons.map((h, idx) => {
    const noise = (random() - 0.5) * 0.06;
    const signal = (idx + 1) * 0.0035;
    const predReturn = Number((noise + signal).toFixed(4));
    const pUpRaw = Math.min(0.94, Math.max(0.06, 0.5 + predReturn * 2.1));
    const pUp = Math.min(0.94, Math.max(0.06, pUpRaw * 0.95 + 0.025));
    return {
      date: latest?.date ?? toIsoDate(today),
      ticker,
      horizon: h,
      adj_close: latest?.adj_close ?? Number(basePrice.toFixed(2)),
      pred_return: predReturn,
      p_up_raw: Number(pUpRaw.toFixed(4)),
      p_up: Number(pUp.toFixed(4)),
      implied_price: Number(((latest?.adj_close ?? basePrice) * (1 + predReturn)).toFixed(2)),
      model_path: "mock://quant/offline"
    };
  });

  return {
    ok: true,
    ticker,
    rows,
    history,
    reports: [],
    meta: {
      modelVersion: process.env.QUANT_MODEL_VERSION ?? "quant-v1",
      bridgeVersion: QUANT_BRIDGE_VERSION,
      fallbackMode: "offline",
      cached: false
    }
  };
}

function quarterFromDate(dateIso: string): "Q1" | "Q2" | "Q3" | "Q4" | null {
  const ts = Date.parse(dateIso);
  if (!Number.isFinite(ts)) {
    return null;
  }
  const month = new Date(ts).getUTCMonth() + 1;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

async function getTickerCikMap(): Promise<Map<string, string>> {
  if (!tickerCikMapPromise) {
    tickerCikMapPromise = fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: {
        "User-Agent": process.env.SEC_USER_AGENT ?? "FinanceAutomation/1.0 (contact: dev@example.com)",
        Accept: "application/json"
      },
      cache: "force-cache"
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`SEC ticker map failed with status ${response.status}`);
        }
        const json = (await response.json()) as Record<string, { ticker?: string; cik_str?: number }>;
        const map = new Map<string, string>();
        for (const row of Object.values(json)) {
          const ticker = String(row?.ticker ?? "").trim().toUpperCase();
          const cikNum = Number(row?.cik_str ?? 0);
          if (!ticker || !Number.isFinite(cikNum) || cikNum <= 0) {
            continue;
          }
          map.set(ticker, String(Math.trunc(cikNum)).padStart(10, "0"));
        }
        return map;
      })
      .catch(() => new Map<string, string>());
  }
  return tickerCikMapPromise;
}

async function fetchLatestReports(
  ticker: string
): Promise<Array<{ filedAt: string; form: "10-K" | "10-Q"; quarter: "Q1" | "Q2" | "Q3" | "Q4" | null }>> {
  try {
    const map = await getTickerCikMap();
    const cik = map.get(ticker);
    if (!cik) {
      return [];
    }

    const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: {
        "User-Agent": process.env.SEC_USER_AGENT ?? "FinanceAutomation/1.0 (contact: dev@example.com)",
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as {
      filings?: { recent?: { form?: string[]; filingDate?: string[]; reportDate?: string[] } };
    };
    const forms = json.filings?.recent?.form ?? [];
    const dates = json.filings?.recent?.filingDate ?? [];
    const reportDates = json.filings?.recent?.reportDate ?? [];

    const results: Array<{ filedAt: string; form: "10-K" | "10-Q"; quarter: "Q1" | "Q2" | "Q3" | "Q4" | null }> = [];
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i];
      const filingDate = dates[i];
      if ((form !== "10-K" && form !== "10-Q") || !filingDate) {
        continue;
      }
      results.push({
        filedAt: filingDate,
        form,
        quarter: form === "10-Q" ? quarterFromDate(reportDates[i] ?? filingDate) : null
      });
      if (results.length >= 8) {
        break;
      }
    }
    return results;
  } catch {
    return [];
  }
}

function runPythonInfer(ticker: string, retrain: boolean, signal?: AbortSignal): Promise<QuantJobResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Job cancelled by user."));
      return;
    }

    const pythonRoot = path.join(process.cwd(), "python");
    const pythonBin = (process.env.QUANT_PYTHON_BIN ?? process.env.PRIMER_PYTHON_BIN ?? "python3").trim();
    const timeoutMsRaw = Number(process.env.QUANT_JOB_TIMEOUT_MS ?? "600000");
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 600_000;
    const mplConfigDir = path.join(pythonRoot, ".mplconfig");
    const args = ["-m", "src.quant.web_infer", "--ticker", ticker];

    if (retrain) {
      args.push("--retrain");
    }

    const child = spawn(pythonBin, args, {
      cwd: pythonRoot,
      env: {
        ...process.env,
        MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? mplConfigDir,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killChildProcessTree(child, "SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      killChildProcessTree(child, "SIGKILL");
      reject(new Error("Job cancelled by user."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);

      if (timedOut) {
        reject(new Error(`Quant job timed out after ${(timeoutMs / 1000).toFixed(0)} seconds.`));
        return;
      }

      const trimmed = stdout.trim();
      const lastLine = trimmed.split("\n").filter(Boolean).at(-1);

      if (!lastLine) {
        reject(new Error(`Quant job produced no output. stderr: ${stderr.slice(0, 500)}`));
        return;
      }

      let payload: QuantJobResult;
      try {
        payload = validateQuantBridgePayload(JSON.parse(lastLine) as unknown);
      } catch {
        reject(
          new Error(
            `Quant job returned non-JSON output. stdout: ${trimmed.slice(0, 500)} stderr: ${stderr.slice(0, 500)}`
          )
        );
        return;
      }

      if (code !== 0) {
        if ("ok" in payload && payload.ok === false) {
          resolve(payload);
          return;
        }
        reject(new Error(`Quant job failed (exit ${code}). stderr: ${stderr.slice(0, 500)}`));
        return;
      }

      resolve(payload);
    });
  });
}

export async function executeQuantJob(input: {
  ticker: string;
  retrain: boolean;
  signal?: AbortSignal;
}): Promise<QuantJobResult> {
  const scriptPath = path.join(process.cwd(), "python", "src", "quant", "web_infer.py");
  await access(scriptPath);
  if (quantFallbackMode() === "always") {
    return createMockQuantResult(input.ticker);
  }

  let result: QuantJobResult;
  try {
    result = await runPythonInfer(input.ticker, input.retrain, input.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mockEnabled() && looksLikeOfflineFailure(message)) {
      return createMockQuantResult(input.ticker);
    }
    throw error;
  }

  if (result.ok === false && mockEnabled() && looksLikeOfflineFailure(result.error ?? "")) {
    return createMockQuantResult(input.ticker);
  }

  if (result.ok) {
    result.reports = await fetchLatestReports(input.ticker);
    result.meta = {
      modelVersion: process.env.QUANT_MODEL_VERSION ?? "quant-v1",
      bridgeVersion: QUANT_BRIDGE_VERSION,
      fallbackMode: "none",
      cached: false
    };
  }
  return result;
}
