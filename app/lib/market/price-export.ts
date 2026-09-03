/**
 * Price history for download: the observed OHLC series for one symbol over an
 * arbitrary period, optionally with its dividends.
 *
 * Only what the upstream actually returned ends up in a row. Gaps stay gaps —
 * no carry-forward, no interpolation (docs/synthetic-data-policy.md), because a
 * spreadsheet is the last place anyone would notice an invented close.
 */

export type ExportInterval = "1d" | "1wk" | "1mo";

export type PriceExportRow = {
  /** Bar timestamp in ms. For weekly/monthly bars this is the period start. */
  t: number;
  /** Period start as a calendar date (YYYY-MM-DD) in the exchange's own timezone. */
  day: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  /** Split- and dividend-adjusted close, as reported upstream. */
  adjClose: number | null;
  volume: number | null;
  /** Cash dividend that went ex within this bar, if any. */
  dividend: number | null;
};

export type PriceExportResult = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  timezone: string | null;
  interval: ExportInterval;
  rows: PriceExportRow[];
};

export class PriceExportUnavailableError extends Error {}

const TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;

function num(value: unknown): number | null {
  // Number(null) is 0, which would turn an unreported bar into a zero close.
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

/** Yahoo returns float32 noise (123.45999908447266); nobody wants that in a cell. */
function round(value: number | null, decimals: number): number | null {
  if (value === null) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Bar timestamps are the exchange's local period start, so a Stockholm monthly
 * bar arrives as 23:00 UTC on the last day of the previous month. Reading the
 * date in UTC would put every such row one day early, which is why the calendar
 * date is derived in the exchange's own timezone.
 */
function dayFormatter(timezone: string | null): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timezone ?? "UTC" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
}

/** Days between two YYYY-MM-DD dates, free of timezone and DST arithmetic. */
function dayGap(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;
}

/** Whether an ex-date falls inside the period a bar covers. */
function coversDay(barDay: string, exDay: string, interval: ExportInterval): boolean {
  if (interval === "1mo") {
    return barDay.slice(0, 7) === exDay.slice(0, 7);
  }
  const gap = dayGap(barDay, exDay);
  return gap >= 0 && gap < (interval === "1wk" ? 7 : 1);
}

type ChartResult = {
  meta?: Record<string, unknown>;
  timestamp?: unknown[];
  events?: { dividends?: Record<string, { amount?: unknown; date?: unknown }> };
  indicators?: {
    quote?: Array<Record<string, unknown[]>>;
    adjclose?: Array<{ adjclose?: unknown[] }>;
  };
};

async function fetchChart(symbol: string, from: Date, to: Date, interval: ExportInterval): Promise<ChartResult> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(Math.floor(from.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(to.getTime() / 1000)));
  url.searchParams.set("interval", interval);
  url.searchParams.set("events", "div,split");
  url.searchParams.set("includeAdjustedClose", "true");
  url.searchParams.set("includePrePost", "false");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "FinanceAutomation/1.0" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new PriceExportUnavailableError(`Upstream responded ${response.status}`);
    }
    const json = (await response.json()) as { chart?: { result?: ChartResult[] } };
    const result = json.chart?.result?.[0];
    if (!result) {
      throw new PriceExportUnavailableError("Upstream returned no series");
    }
    return result;
  } catch (error) {
    if (error instanceof PriceExportUnavailableError) {
      throw error;
    }
    throw new PriceExportUnavailableError((error as Error).message || "History unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPriceExport(input: {
  symbol: string;
  from: Date;
  to: Date;
  interval: ExportInterval;
  dividends: boolean;
}): Promise<PriceExportResult> {
  const result = await fetchChart(input.symbol, input.from, input.to, input.interval);

  const meta = result.meta ?? {};
  const timezone = str(meta.exchangeTimezoneName);
  const toDay = dayFormatter(timezone);

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const adjCloses = Array.isArray(result.indicators?.adjclose?.[0]?.adjclose)
    ? (result.indicators!.adjclose![0].adjclose as unknown[])
    : [];

  const rows: PriceExportRow[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const t = num(timestamps[index]);
    const close = num(closes[index]);
    // Yahoo pads non-trading slots with nulls; a bar without a close is not a bar.
    if (t === null || close === null) {
      continue;
    }
    rows.push({
      t: t * 1000,
      day: toDay.format(new Date(t * 1000)),
      open: round(num(Array.isArray(quote.open) ? quote.open[index] : null), 4),
      high: round(num(Array.isArray(quote.high) ? quote.high[index] : null), 4),
      low: round(num(Array.isArray(quote.low) ? quote.low[index] : null), 4),
      close: round(close, 4) as number,
      adjClose: round(num(adjCloses[index]), 4),
      volume: num(Array.isArray(quote.volume) ? quote.volume[index] : null),
      dividend: null
    });
  }

  if (rows.length === 0) {
    throw new PriceExportUnavailableError("No history for this symbol and period");
  }

  if (input.dividends) {
    for (const event of Object.values(result.events?.dividends ?? {})) {
      const at = num(event?.date);
      const amount = num(event?.amount);
      if (at === null || amount === null) {
        continue;
      }
      const ms = at * 1000;
      // A payment belongs to the bar whose own period covers the ex-date, not
      // merely to the nearest one: if that bar is missing from the series, the
      // payment has no date to sit on and is left out rather than misdated.
      const exDay = toDay.format(new Date(ms));
      const target = rows.find((row) => coversDay(row.day, exDay, input.interval));
      if (target) {
        target.dividend = round((target.dividend ?? 0) + amount, 6);
      }
    }
  }

  return {
    symbol: str(meta.symbol) ?? input.symbol,
    name: str(meta.longName) ?? str(meta.shortName),
    currency: str(meta.currency)?.toUpperCase() ?? null,
    exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName),
    timezone,
    interval: input.interval,
    rows
  };
}
