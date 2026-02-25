import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type PrimerJobResult =
  | {
      ok: true;
      ticker: string;
      pdf_path: string;
      pdf_abspath: string;
      form: string | null;
      filing_date: string | null;
      cache_dir: string;
      primer_text: string;
      cached?: boolean;
    }
  | {
      ok: false;
      error: string;
      traceback?: string;
    };

function mockEnabled(): boolean {
  const raw = (process.env.PRIMER_ALLOW_MOCK_FALLBACK ?? "").trim().toLowerCase();
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
    text.includes("timed out") ||
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("could not resolve host") ||
    text.includes("dnserror") ||
    text.includes("sec")
  );
}

function createMockPrimerText(ticker: string): string {
  return [
    `Company Snapshot`,
    `${ticker} mock primer generated in offline mode.`,
    ``,
    `Business Model`,
    `This is a deterministic placeholder so the Primers workflow remains testable without external SEC or LLM connectivity.`,
    ``,
    `Financial Picture`,
    `Key filing metrics are unavailable offline. Use this as UI/queue validation only, not investment analysis.`,
    ``,
    `Watchlist`,
    `When connectivity is restored, rerun Primers to replace this placeholder with filing-backed output.`
  ].join("\n");
}

function createMockPrimerResult(ticker: string): PrimerJobResult {
  const cacheDir = path.join(process.cwd(), "python", "filings_cache", ticker, "offline-mock");
  return {
    ok: true,
    ticker,
    pdf_path: "",
    pdf_abspath: "",
    form: null,
    filing_date: null,
    cache_dir: cacheDir,
    primer_text: createMockPrimerText(ticker),
    cached: true
  };
}

function parsePdfMeta(fileName: string, ticker: string): { form: string | null; filingDate: string | null } {
  const escapedTicker = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedTicker}_(.+)_(\\d{4}-\\d{2}-\\d{2})\\.pdf$`);
  const match = fileName.match(regex);
  if (!match) {
    return { form: null, filingDate: null };
  }
  return {
    form: match[1] ?? null,
    filingDate: match[2] ?? null
  };
}

async function newestFile(paths: string[]): Promise<string | null> {
  const existing: Array<{ filePath: string; mtimeMs: number }> = [];

  for (const filePath of paths) {
    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        existing.push({ filePath, mtimeMs: s.mtimeMs });
      }
    } catch {
      // Ignore missing files
    }
  }

  if (!existing.length) {
    return null;
  }

  existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return existing[0].filePath;
}

async function getCachedPrimerResult(ticker: string): Promise<PrimerJobResult | null> {
  const primersDir = path.join(process.cwd(), "python", "primers");
  const cacheDir = path.join(process.cwd(), "python", "filings_cache", ticker);

  let entries: string[] = [];
  try {
    entries = await readdir(primersDir);
  } catch {
    return null;
  }

  const pdfCandidates = entries
    .filter((name) => name.startsWith(`${ticker}_`) && name.endsWith(".pdf"))
    .map((name) => path.join(primersDir, name));

  const latestPdf = await newestFile(pdfCandidates);
  if (!latestPdf) {
    return null;
  }

  try {
    const [pdfStat, pdfReportStat, cliStat] = await Promise.all([
      stat(latestPdf),
      stat(path.join(process.cwd(), "python", "src", "filings", "pdf_report.py")),
      stat(path.join(process.cwd(), "python", "src", "filings", "cli.py"))
    ]);

    const latestCodeMtime = Math.max(pdfReportStat.mtimeMs, cliStat.mtimeMs);
    if (pdfStat.mtimeMs < latestCodeMtime) {
      return null;
    }
  } catch {
    return null;
  }

  let primerText = "";
  try {
    const accessions = await readdir(cacheDir);
    const primerCandidates: string[] = [];
    for (const accession of accessions) {
      primerCandidates.push(path.join(cacheDir, accession, "primer_web.txt"));
      primerCandidates.push(path.join(cacheDir, accession, "primer.txt"));
    }

    const latestPrimer = await newestFile(primerCandidates);
    if (latestPrimer) {
      primerText = (await readFile(latestPrimer, "utf8")).trim();
    }
  } catch {
    // Ignore cache read failures.
  }

  if (!primerText) {
    return null;
  }

  const fileName = path.basename(latestPdf);
  const meta = parsePdfMeta(fileName, ticker);

  return {
    ok: true,
    ticker,
    pdf_path: latestPdf,
    pdf_abspath: path.resolve(latestPdf),
    form: meta.form,
    filing_date: meta.filingDate,
    cache_dir: path.resolve(cacheDir),
    primer_text: primerText,
    cached: true
  };
}

function runPrimerJob(ticker: string, llmProvider: string, signal?: AbortSignal): Promise<PrimerJobResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Job cancelled by user."));
      return;
    }

    const pythonRoot = path.join(process.cwd(), "python");
    const pythonBin = (process.env.PRIMER_PYTHON_BIN ?? process.env.QUANT_PYTHON_BIN ?? "python3").trim();
    const timeoutMsRaw = Number(process.env.PRIMER_JOB_TIMEOUT_MS ?? "600000");
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 600_000;
    const userAgent = process.env.SEC_USER_AGENT ?? process.env.PRIMER_USER_AGENT ?? process.env.REDDIT_USER_AGENT;
    const mplConfigDir = path.join(pythonRoot, ".mplconfig");

    const args = ["-m", "src.filings.web_primer", "--ticker", ticker, "--llm-provider", llmProvider];
    if (userAgent) {
      args.push("--user-agent", userAgent);
    }

    const child = spawn(pythonBin, args, {
      cwd: pythonRoot,
      env: {
        ...process.env,
        MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? mplConfigDir,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
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
        reject(new Error(`Primer job timed out after ${(timeoutMs / 1000).toFixed(0)} seconds.`));
        return;
      }

      const trimmed = stdout.trim();
      const lastLine = trimmed.split("\n").filter(Boolean).at(-1);

      if (!lastLine) {
        reject(new Error(`Primer job produced no output. stderr: ${stderr.slice(0, 500)}`));
        return;
      }

      let payload: PrimerJobResult;
      try {
        payload = JSON.parse(lastLine) as PrimerJobResult;
      } catch {
        reject(
          new Error(
            `Primer job returned non-JSON output. stdout: ${trimmed.slice(0, 500)} stderr: ${stderr.slice(0, 500)}`
          )
        );
        return;
      }

      if (code !== 0) {
        if ("ok" in payload && payload.ok === false) {
          resolve(payload);
          return;
        }
        reject(new Error(`Primer job failed (exit ${code}). stderr: ${stderr.slice(0, 500)}`));
        return;
      }

      resolve(payload);
    });
  });
}

export async function executePrimerJob(input: {
  ticker: string;
  llmProvider: "openai_compatible" | "none";
  signal?: AbortSignal;
}): Promise<PrimerJobResult> {
  const bridgePath = path.join(process.cwd(), "python", "src", "filings", "web_primer.py");
  await access(bridgePath);

  const useCache = process.env.PRIMER_DISABLE_RESULT_CACHE !== "1";
  if (useCache) {
    const cached = await getCachedPrimerResult(input.ticker);
    if (cached) {
      return cached;
    }
  }

  try {
    const result = await runPrimerJob(input.ticker, input.llmProvider, input.signal);
    if (result.ok === false && mockEnabled() && looksLikeOfflineFailure(result.error ?? "")) {
      return createMockPrimerResult(input.ticker);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mockEnabled() && looksLikeOfflineFailure(message)) {
      return createMockPrimerResult(input.ticker);
    }
    throw error;
  }
}
