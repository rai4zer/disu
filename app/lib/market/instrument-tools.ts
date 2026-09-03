/**
 * Which analysis tools can run against an instrument.
 *
 * A leaf: no imports beyond the payload types, because the client components
 * that draw the tab strip need these rules and must not pull a bridge in with
 * them (see `instrument-types.ts` for why that boundary is structural).
 *
 * Each tool has a *different* reach, and the reaches were measured rather than
 * assumed (2026-09-03):
 *
 *  - **Quant** runs off yfinance price history, so it covers everything the
 *    instrument page can open: shares, indices, futures, FX, crypto.
 *  - **Primers** read SEC EDGAR (`python/src/filings/edgar.py`), so they are
 *    **US filers only**. AAPL has one; VOLV-B.ST does not and never will.
 *  - **Sentiment** reads the Placera forum, which is a **Swedish** retail
 *    board. VOLV-B.ST has threads; AAPL does not.
 *
 * The consequence worth knowing, because it caps the design: primers and
 * sentiment are mutually exclusive by geography. No instrument ever shows both,
 * so the tab strip tops out at six rather than seven.
 *
 * The rule these follow is the one the data tabs already follow — a tab exists
 * only where its data can. Offering a Placera tab on Apple would be a tab that
 * opens onto an apology (docs/synthetic-data-policy.md).
 */

import type { InstrumentProfile } from "./instrument-types.ts";

export type ToolKey = "quant" | "sentiment" | "primers";

export type ToolAvailability = {
  quant: boolean;
  sentiment: boolean;
  primers: boolean;
};

/**
 * Exchange codes and suffixes that mean "listed in the US".
 *
 * Checked against the exchange first and the symbol suffix second: Yahoo
 * reports `NasdaqGS`/`NYSE` in `fullExchangeName` but bare `NMS`/`NYQ` in
 * `exchange`, and the profile carries whichever one resolved.
 */
const US_EXCHANGES = ["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BATS", "NASDAQ", "NYSE", "AMEX"];

/** Suffix Yahoo appends to Stockholm listings. */
const STOCKHOLM_SUFFIX = ".ST";

function isUsListed(symbol: string, profile: InstrumentProfile): boolean {
  const exchange = (profile.exchange ?? "").toUpperCase();
  if (US_EXCHANGES.some((code) => exchange.includes(code))) return true;
  // A US ticker carries no exchange suffix at all — `AAPL`, not `AAPL.US`. A
  // dot therefore means "listed somewhere else", which is the reliable half of
  // this test even when the exchange name is missing.
  return !symbol.includes(".") && exchange === "";
}

function isStockholmListed(symbol: string, profile: InstrumentProfile): boolean {
  return (
    symbol.toUpperCase().endsWith(STOCKHOLM_SUFFIX) || (profile.exchange ?? "").toUpperCase().includes("STOCKHOLM")
  );
}

/**
 * What may be offered for this instrument.
 *
 * Availability is not a promise the run will succeed — a US small cap may have
 * no usable filing, and a listed Swedish company may have no forum threads.
 * It is a promise that the tool *applies*, which is the difference between a
 * tab that can return nothing and a tab that could never have returned
 * anything.
 */
export function toolsFor(symbol: string, profile: InstrumentProfile): ToolAvailability {
  const quoteType = (profile.quoteType ?? "").toUpperCase();
  const isEquity = quoteType === "EQUITY";

  return {
    // Anything the page can open has price history behind it, which is all the
    // quant bridge needs.
    quant: Boolean(quoteType),
    sentiment: isEquity && isStockholmListed(symbol, profile),
    primers: isEquity && isUsListed(symbol, profile)
  };
}

/**
 * A company name Placera's search will actually match.
 *
 * Yahoo reports the *legal* name — "AB Volvo (publ)", "Telefonaktiebolaget LM
 * Ericsson (publ)" — and Placera's search does not. Measured 2026-09-03 against
 * the live endpoint: "AB Volvo (publ)" returns 404, "Volvo" returns 200. So the
 * legal wrapper has to come off before the query goes out, or the tab renders
 * "no forum for this company" for a company that plainly has one.
 *
 * Deliberately conservative. It strips the corporate-form wrapper and nothing
 * else — no fuzzy shortening, no first-word-only. Over-trimming would match the
 * *wrong* company's forum and attribute a stranger's posts to this instrument,
 * which is far worse than a miss.
 */
export function placeraQuery(name: string): string {
  let out = name.trim();

  // "(publ)" and its bare variant: a Swedish public-company marker, never part
  // of the name anyone searches for.
  out = out.replace(/\(\s*publ\.?\s*\)/gi, " ").replace(/\bpubl\.?\b/gi, " ");

  // Corporate form, leading or trailing. Nordic forms only — this tab exists
  // for Stockholm listings, so there is no reason to guess at others.
  const FORMS = ["AB", "A/S", "AS", "ASA", "Oyj", "Abp", "Plc", "Inc", "Corp"];
  const formGroup = FORMS.map((f) => f.replace(/[/.]/g, "\\$&")).join("|");
  out = out.replace(new RegExp(`^\\s*(?:${formGroup})\\b\\.?\\s*`, "i"), "");
  out = out.replace(new RegExp(`\\s*\\b(?:${formGroup})\\b\\.?\\s*$`, "i"), "");

  // Share-class tail: "ser. B", "ser B", or a lone trailing class letter.
  out = out.replace(/\s+ser\.?\s*[A-D]\s*$/i, "");

  return out.replace(/\s{2,}/g, " ").trim() || name.trim();
}
