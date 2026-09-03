import { deflateRawSync } from "node:zlib";

/**
 * A single-sheet .xlsx writer, inside the dependency budget this repo keeps
 * (nothing at runtime beyond Next/React). An .xlsx file is a zip of a handful
 * of XML parts, and Node already ships the two hard pieces: deflate and Buffer.
 *
 * Deliberately narrow: one worksheet, a bold header row, text/number/date
 * cells. Anything richer belongs in a real library, not here.
 */

export type XlsxCell = string | number | null | { date: Date };

export type XlsxSheet = {
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Optional per-column widths in characters, aligned with `header`. */
  widths?: number[];
};

// Excel counts days from 1899-12-30 (the 1900 system, leap-year bug included),
// which puts the Unix epoch at serial 25569.
const EXCEL_EPOCH_OFFSET = 25569;
const MS_PER_DAY = 86_400_000;

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATE = 2;

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Control characters are illegal in XML 1.0 and Excel rejects the file.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

function columnName(index: number): string {
  let name = "";
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

function excelSerial(date: Date): number {
  // Excel serials carry no timezone. The caller hands us the instant it wants
  // written, so the day boundary is UTC's.
  return date.getTime() / MS_PER_DAY + EXCEL_EPOCH_OFFSET;
}

function cellXml(reference: string, cell: XlsxCell, style: number): string {
  if (cell === null || cell === undefined || cell === "") {
    return "";
  }
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? `<c r="${reference}" s="${style}"><v>${cell}</v></c>` : "";
  }
  if (typeof cell === "object" && cell.date instanceof Date) {
    return `<c r="${reference}" s="${STYLE_DATE}"><v>${excelSerial(cell.date)}</v></c>`;
  }
  return (
    `<c r="${reference}" s="${style}" t="inlineStr">` +
    `<is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`
  );
}

function sheetXml(sheet: XlsxSheet): string {
  const columns = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const headerRow = `<row r="1">${sheet.header
    .map((label, index) => cellXml(`${columnName(index)}1`, label, STYLE_HEADER))
    .join("")}</row>`;

  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = row
        .map((cell, columnIndex) => cellXml(`${columnName(columnIndex)}${rowNumber}`, cell, STYLE_DEFAULT))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    columns +
    `<sheetData>${headerRow}${bodyRows}</sheetData>` +
    `</worksheet>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookXml(sheetName: string): string {
  // Excel caps sheet names at 31 characters and forbids : \ / ? * [ ]
  const safe = escapeXml(sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)) || "Sheet1";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${safe}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = -1;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

type ZipEntry = { name: string; data: Buffer };

/** A minimal zip container: deflated entries, no directory records, no zip64. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // modified time — fixed, so output is reproducible
    local.writeUInt16LE(0x21, 12); // modified date — 1980-01-01
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

export function buildXlsx(sheet: XlsxSheet): Buffer {
  const utf8 = (text: string) => Buffer.from(text, "utf8");
  return zip([
    { name: "[Content_Types].xml", data: utf8(CONTENT_TYPES) },
    { name: "_rels/.rels", data: utf8(ROOT_RELS) },
    { name: "xl/workbook.xml", data: utf8(workbookXml(sheet.name)) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: utf8(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheetXml(sheet)) }
  ]);
}

/** RFC 4180 CSV, with a BOM so Excel reads the UTF-8 as UTF-8. */
export function buildCsv(sheet: Pick<XlsxSheet, "header" | "rows">): string {
  const cell = (value: XlsxCell): string => {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "";
    }
    if (typeof value === "object" && value.date instanceof Date) {
      return value.date.toISOString().slice(0, 10);
    }
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [sheet.header.map((label) => cell(label)).join(",")];
  for (const row of sheet.rows) {
    lines.push(row.map(cell).join(","));
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
