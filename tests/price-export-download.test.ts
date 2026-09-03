import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import { buildCsv, buildXlsx } from "../app/lib/export/xlsx.ts";
import { PriceExportUnavailableError, fetchPriceExport } from "../app/lib/market/price-export.ts";

// The download replaces the old "show table" toggle, so the spreadsheet is now
// the only place a reader sees the raw series. Guards two things: the file is a
// real .xlsx/CSV, and the series in it is the observed one — no invented bars.

function unzip(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(archive.subarray(start, start + compressedSize)).toString("utf8"));
    offset = start + compressedSize;
  }
  return files;
}

const SHEET = {
  name: "ERIC-B.ST",
  header: ["Date", "Close (SEK)", "Dividend (SEK)"],
  rows: [
    [{ date: new Date("2026-01-02T00:00:00.000Z") }, 82.5, null],
    [{ date: new Date("2026-01-05T00:00:00.000Z") }, 83.25, 2.7],
    [{ date: new Date("2026-01-06T00:00:00.000Z") }, 84, 'quote " and, comma']
  ]
};

test("the workbook is a readable zip with the parts Excel requires", () => {
  const files = unzip(buildXlsx(SHEET));
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml"
  ]) {
    assert.ok(files.has(part), `${part} missing from the workbook`);
  }
  assert.match(files.get("xl/workbook.xml")!, /name="ERIC-B.ST"/);
});

test("dates are real date cells, not text", () => {
  const sheet = unzip(buildXlsx(SHEET)).get("xl/worksheets/sheet1.xml")!;
  // 2026-01-02 is serial 46024 in Excel's 1900 date system.
  assert.match(sheet, /<c r="A2" s="2"><v>46024<\/v><\/c>/);
  assert.match(unzip(buildXlsx(SHEET)).get("xl/styles.xml")!, /formatCode="yyyy\\-mm\\-dd"/);
});

test("cell text is XML-escaped and empty cells are left empty", () => {
  const sheet = unzip(buildXlsx(SHEET)).get("xl/worksheets/sheet1.xml")!;
  assert.match(sheet, /quote &quot; and, comma/);
  // Row 2 has no dividend, so C2 must not exist rather than hold a zero.
  assert.ok(!sheet.includes('r="C2"'), "a missing dividend must not become a value");
});

test("sheet names are trimmed to what Excel accepts", () => {
  const workbook = unzip(buildXlsx({ ...SHEET, name: "a/b[c]:d*e?f" })).get("xl/workbook.xml")!;
  assert.match(workbook, /name="a b c  d e f"/);
});

test("the CSV carries a BOM, CRLF rows and RFC 4180 quoting", () => {
  const csv = buildCsv(SHEET);
  assert.ok(csv.startsWith("﻿"), "Excel needs the BOM to read UTF-8");
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "﻿Date,Close (SEK),Dividend (SEK)");
  assert.equal(lines[1], "2026-01-02,82.5,");
  assert.equal(lines[3], '2026-01-06,84,"quote "" and, comma"');
});

function chartResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body
  } as unknown as Response;
}

function withFetch(body: unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    return chartResponse(body);
  }) as typeof fetch;
  return run()
    .then(() => calls)
    .finally(() => {
      globalThis.fetch = original;
    });
}

const DAY = 86_400;
const MONDAY = Date.UTC(2026, 0, 5) / 1000;

function yahooWeekly() {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: "ERIC-B.ST",
            currency: "sek",
            shortName: "Ericsson B",
            fullExchangeName: "Stockholm",
            exchangeTimezoneName: "Europe/Stockholm"
          },
          timestamp: [MONDAY, MONDAY + 7 * DAY, MONDAY + 14 * DAY],
          events: {
            dividends: {
              // Two payments inside the third week, plus one inside the week the
              // upstream reported no bar for.
              [String(MONDAY + 15 * DAY)]: { amount: 2.75, date: MONDAY + 15 * DAY },
              [String(MONDAY + 17 * DAY)]: { amount: 0.25, date: MONDAY + 17 * DAY },
              [String(MONDAY + 9 * DAY)]: { amount: 9.99, date: MONDAY + 9 * DAY }
            }
          },
          indicators: {
            quote: [
              {
                open: [80, null, 84.5],
                high: [82, null, 86],
                low: [79, null, 84],
                close: [81.45999908447266, null, 85.5],
                volume: [1000, null, 3000]
              }
            ],
            adjclose: [{ adjclose: [80.1, null, 85.5] }]
          }
        }
      ]
    }
  };
}

test("bars the upstream did not report are dropped, never filled in", async () => {
  let rows: number[] = [];
  await withFetch(yahooWeekly(), async () => {
    const result = await fetchPriceExport({
      symbol: "ERIC-B.ST",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
      interval: "1wk",
      dividends: true
    });
    rows = result.rows.map((row) => row.close);
    assert.equal(result.currency, "SEK");
    assert.equal(result.name, "Ericsson B");
    // Bars are stamped with the exchange's own calendar date, not the reader's.
    assert.deepEqual(
      result.rows.map((row) => row.day),
      ["2026-01-05", "2026-01-19"]
    );
  });
  // The middle week had no close, so there are two bars, not three interpolated ones.
  assert.deepEqual(rows, [81.46, 85.5]);
});

test("dividends land in the bar whose period contains the ex-date", async () => {
  await withFetch(yahooWeekly(), async () => {
    const result = await fetchPriceExport({
      symbol: "ERIC-B.ST",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
      interval: "1wk",
      dividends: true
    });
    // Two payments in the third week sum onto that week's bar; the one that went
    // ex during the missing week is left out rather than pushed onto a neighbour.
    assert.equal(result.rows[0].dividend, null);
    assert.equal(result.rows[1].dividend, 3);
  });
});

test("dividends are left out entirely when they were not asked for", async () => {
  await withFetch(yahooWeekly(), async () => {
    const result = await fetchPriceExport({
      symbol: "ERIC-B.ST",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
      interval: "1wk",
      dividends: false
    });
    assert.ok(result.rows.every((row) => row.dividend === null));
  });
});

test("the requested period and granularity reach the upstream", async () => {
  const calls = await withFetch(yahooWeekly(), async () => {
    await fetchPriceExport({
      symbol: "ERIC-B.ST",
      from: new Date("2020-03-01T00:00:00.000Z"),
      to: new Date("2026-08-30T00:00:00.000Z"),
      interval: "1mo",
      dividends: true
    });
  });
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("period1"), String(Date.UTC(2020, 2, 1) / 1000));
  assert.equal(url.searchParams.get("period2"), String(Date.UTC(2026, 7, 30) / 1000));
  assert.equal(url.searchParams.get("interval"), "1mo");
  assert.equal(url.searchParams.get("events"), "div,split");
});

test("an empty series is an error, not an empty spreadsheet", async () => {
  await withFetch({ chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{}] } }] } }, async () => {
    await assert.rejects(
      fetchPriceExport({
        symbol: "NOPE",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-02-01T00:00:00.000Z"),
        interval: "1d",
        dividends: false
      }),
      PriceExportUnavailableError
    );
  });
});
