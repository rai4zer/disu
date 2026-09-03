import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { buildCsv, buildXlsx, type XlsxCell } from "@/app/lib/export/xlsx";
import {
  PriceExportUnavailableError,
  fetchPriceExport,
  type ExportInterval,
  type PriceExportResult
} from "@/app/lib/market/price-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERVALS: ExportInterval[] = ["1d", "1wk", "1mo"];
const MS_PER_DAY = 86_400_000;
// Yahoo's own history starts in 1962; anything earlier is a typo in the form.
const EARLIEST = Date.UTC(1960, 0, 1);

type Format = "csv" | "xlsx";

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function columns(result: PriceExportResult, dividends: boolean, isSv: boolean) {
  const unit = result.currency ? ` (${result.currency})` : "";
  const header = isSv
    ? ["Datum", `Öppning${unit}`, `Högst${unit}`, `Lägst${unit}`, `Stängning${unit}`]
    : ["Date", `Open${unit}`, `High${unit}`, `Low${unit}`, `Close${unit}`];
  const widths = [12, 12, 12, 12, 12];

  if (dividends) {
    header.push(
      isSv ? `Justerad stängning${unit}` : `Adjusted close${unit}`,
      isSv ? `Utdelning${unit}` : `Dividend${unit}`
    );
    widths.push(20, 14);
  }

  header.push(isSv ? "Volym" : "Volume");
  widths.push(14);

  const rows: XlsxCell[][] = result.rows.map((row) => {
    // row.day is already the exchange's own calendar date; anchoring it at UTC
    // midnight keeps the spreadsheet cell on that day whatever the reader's zone.
    const cells: XlsxCell[] = [
      { date: new Date(`${row.day}T00:00:00.000Z`) },
      row.open,
      row.high,
      row.low,
      row.close
    ];
    if (dividends) {
      cells.push(row.adjClose, row.dividend);
    }
    cells.push(row.volume);
    return cells;
  });

  return { header, widths, rows };
}

function filename(symbol: string, from: string, to: string, interval: ExportInterval, dividends: boolean, format: Format) {
  const grain = interval === "1d" ? "daily" : interval === "1wk" ? "weekly" : "monthly";
  const slug = symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}-${grain}-${from}-${to}${dividends ? "-with-dividends" : ""}.${format}`;
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,16}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "Invalid symbol" }, { status: 400 });
  }

  const format: Format = params.get("format") === "xlsx" ? "xlsx" : "csv";
  const requestedInterval = (params.get("interval") ?? "1d") as ExportInterval;
  const interval = INTERVALS.includes(requestedInterval) ? requestedInterval : "1d";
  const dividends = params.get("dividends") === "1";
  const isSv = params.get("lang") === "sv";

  const from = parseDay(params.get("from"));
  // The upstream treats period2 as exclusive-ish, so today's bar needs tomorrow.
  const to = parseDay(params.get("to")) ?? new Date(Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY);
  if (!from || !to) {
    return NextResponse.json({ ok: false, error: "Invalid period" }, { status: 400 });
  }
  if (from.getTime() < EARLIEST || from.getTime() > to.getTime()) {
    return NextResponse.json({ ok: false, error: "Invalid period" }, { status: 400 });
  }
  if (to.getTime() > Date.now() + MS_PER_DAY) {
    return NextResponse.json({ ok: false, error: "The period ends in the future" }, { status: 400 });
  }

  let result: PriceExportResult;
  try {
    result = await fetchPriceExport({
      symbol,
      from,
      to: new Date(to.getTime() + MS_PER_DAY),
      interval,
      dividends
    });
  } catch (error) {
    const message = error instanceof PriceExportUnavailableError ? error.message : "History unavailable";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  const name = filename(symbol, fromDay, toDay, interval, dividends, format);
  const sheet = columns(result, dividends, isSv);

  const body =
    format === "xlsx"
      ? buildXlsx({ name: result.symbol || symbol, ...sheet })
      : Buffer.from(buildCsv(sheet), "utf8");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store"
    }
  });
}
