import type { NormalizedPosition } from "@/app/lib/brokers/types";

const SYMBOL_HEADERS = ["symbol", "ticker", "kortnamn", "instrument", "instrumentnamn", "namn"];
const NAME_HEADERS = ["name", "instrumentnamn", "namn", "instrument"];
const ISIN_HEADERS = ["isin"];
const QUANTITY_HEADERS = ["quantity", "antal"];
const AVG_COST_HEADERS = ["avgcost", "averageprice", "snittkurs", "anskaffningsvarde", "anskaffningsvärde"];
const MARKET_VALUE_HEADERS = ["marketvalue", "value", "marknadsvarde", "marknadsvärde", "varde", "värde"];
const CURRENCY_HEADERS = ["currency", "valuta"];

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_.-]/g, "");
}

function parseNumber(input: string | undefined): number {
  if (!input) {
    return 0;
  }

  const normalized = input
    .replace(/\s/g, "")
    .replace(/\u00a0/g, "")
    .replace(/kr|sek|usd|eur/gi, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function pickHeaderIndex(normalizedHeaders: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = normalizedHeaders.indexOf(alias);
    if (idx >= 0) {
      return idx;
    }
  }

  return -1;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  return out;
}

export function parseAvanzaPositionsCsv(content: string): NormalizedPosition[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter);
  const normalizedHeaders = headers.map(normalizeHeader);

  const symbolIdx = pickHeaderIndex(normalizedHeaders, SYMBOL_HEADERS);
  const nameIdx = pickHeaderIndex(normalizedHeaders, NAME_HEADERS);
  const isinIdx = pickHeaderIndex(normalizedHeaders, ISIN_HEADERS);
  const quantityIdx = pickHeaderIndex(normalizedHeaders, QUANTITY_HEADERS);
  const avgCostIdx = pickHeaderIndex(normalizedHeaders, AVG_COST_HEADERS);
  const marketValueIdx = pickHeaderIndex(normalizedHeaders, MARKET_VALUE_HEADERS);
  const currencyIdx = pickHeaderIndex(normalizedHeaders, CURRENCY_HEADERS);

  const now = new Date().toISOString();

  return lines
    .slice(1)
    .map((line) => {
      const cols = parseCsvLine(line, delimiter);
      const symbol = (cols[symbolIdx] ?? cols[nameIdx] ?? "").trim();
      const name = (cols[nameIdx] ?? symbol).trim();

      return {
        symbol,
        isin: (cols[isinIdx] ?? "").trim(),
        name,
        quantity: parseNumber(cols[quantityIdx]),
        avgCost: parseNumber(cols[avgCostIdx]),
        currency: ((cols[currencyIdx] ?? "SEK").trim() || "SEK").toUpperCase(),
        marketValue: parseNumber(cols[marketValueIdx]),
        asOf: now
      };
    })
    .filter((row) => row.symbol.length > 0);
}
