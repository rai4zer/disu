/**
 * Ticker → currency inference, and the curated ticker list it leans on.
 *
 * This is a leaf on purpose: **no imports, and nothing that reaches a database,
 * the filesystem or the network.** `app/portfolio/page.tsx` is a client
 * component and calls `inferCurrencyFromTicker()` while someone types a ticker
 * into the add-position form, so anything this module pulls in is pulled into
 * the browser bundle with it.
 *
 * That is not hypothetical. This function used to live in `market-provider.ts`,
 * and the day that module gained a quote-cache import the build broke with
 * `UnhandledSchemeError: Reading from "node:fs"` — the trace ran
 * page.tsx → market-provider → quote-cache → supabase → runtime/env → node:fs.
 * `tsc --noEmit` cannot see that class of error, because it is a bundling
 * concern rather than a typing one. Same rule, and same reason, as `quote.ts`.
 *
 * Keep it dependency-free.
 */

export const CURATED_TICKERS: Array<{ symbol: string; name: string; currency: string }> = [
  { symbol: "AAPL", name: "Apple Inc", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft Corp", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA Corp", currency: "USD" },
  { symbol: "TSLA", name: "Tesla Inc", currency: "USD" },
  { symbol: "AMZN", name: "Amazon.com Inc", currency: "USD" },
  { symbol: "ASML.AS", name: "ASML Holding NV", currency: "EUR" },
  { symbol: "MC.PA", name: "LVMH", currency: "EUR" },
  { symbol: "SAP.DE", name: "SAP SE", currency: "EUR" },
  { symbol: "NOVO-B.CO", name: "Novo Nordisk B", currency: "DKK" },
  { symbol: "EVO.ST", name: "Evolution AB", currency: "SEK" },
  { symbol: "VOLV-B.ST", name: "Volvo B", currency: "SEK" },
  { symbol: "DNB.OL", name: "DNB Bank ASA", currency: "NOK" },
  { symbol: "NESN.SW", name: "Nestle SA", currency: "CHF" },
  { symbol: "SHEL.L", name: "Shell plc", currency: "GBP" }
];

/**
 * Best-effort currency for a ticker, from the curated list then the exchange
 * suffix. Defaults to USD.
 *
 * This is an *inference*, never an observation. A price fetched from a feed
 * carries the feed's own currency and must keep it — this exists for the cases
 * where no feed has spoken yet, such as labelling a holding someone is still
 * typing in. Never use it to relabel an observed price (ROADMAP §2.7).
 */
export function inferCurrencyFromTicker(rawSymbol: string): string {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return "USD";

  const curated = CURATED_TICKERS.find((item) => item.symbol === symbol);
  if (curated) return curated.currency;

  const suffix = symbol.split(".")[1] ?? "";
  if (suffix === "ST") return "SEK";
  if (suffix === "CO") return "DKK";
  if (suffix === "OL") return "NOK";
  if (suffix === "SW") return "CHF";
  if (["PA", "AS", "DE", "MI", "BR", "HE", "VI"].includes(suffix)) return "EUR";
  if (suffix === "L") return "GBP";
  return "USD";
}
