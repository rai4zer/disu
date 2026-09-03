/**
 * The dashboard board: what the market cards are allowed to show.
 *
 * The dashboard asks for eight categories of reading — markets, commodities,
 * crypto and FX among them — and every one of those is the same shape as an
 * index: a display name, a set of upstream symbols to try, and a level plus a
 * day change. So they reuse `IndexDescriptor` and go through
 * `MarketProvider.getIndexQuotes()` rather than growing a second, parallel way
 * to fetch a price.
 *
 * That reuse is the point, not a convenience. `MARKET_MOCK_FALLBACK_MODE` is
 * the switch that stops production inventing prices (ROADMAP §2.7), and it only
 * reaches surfaces that go through the provider. The market strip was once the
 * one price surface that did not, and the fix was to move it behind the
 * provider — adding four new categories on a private fetch path would reopen
 * exactly that hole, four times over.
 *
 * `IndexReading | null` carries the honesty rule for free: there is no
 * placeholder gold price and no placeholder BTC level. A reading we could not
 * take is `null`, and the card renders "—". See docs/synthetic-data-policy.md.
 *
 * Finnhub cannot resolve most of these (its index list covers equity indices,
 * not futures or FX crosses), so `finnhubMatchers` is deliberately empty for
 * them: the Finnhub leg fails fast and Yahoo — which quotes `GC=F`, `BTC-USD`
 * and `EURSEK=X` on the same batch endpoint as `^GSPC` — is the real source.
 */

import type { IndexDescriptor } from "./index-quotes";

/** A board group as the dashboard renders it: one card per group. */
export type BoardGroupKey = "markets" | "commodities" | "crypto" | "fx";

export type BoardEntry = IndexDescriptor & {
  /** Digits to render. FX crosses need four; an index needs none. */
  precision: number;
  /** Suffix for the level, when the unit is not obvious from the name. */
  unit?: string;
};

/**
 * Yahoo-only descriptor. Written as a helper because every entry below would
 * otherwise repeat the same two empty Finnhub fields, and an empty matcher list
 * is a decision ("Finnhub cannot resolve this") rather than an oversight.
 */
function yahooOnly(
  label: string,
  fullName: string,
  yahooSymbol: string,
  precision: number,
  unit?: string
): BoardEntry {
  return {
    label,
    fullName,
    yahooSymbols: [yahooSymbol],
    finnhubSymbols: [],
    finnhubMatchers: [],
    precision,
    ...(unit ? { unit } : {})
  };
}

/**
 * Broad market indices. Deliberately a different, shorter set than
 * `INDEX_CATALOGUE` (which drives the always-on strip at the top of every
 * page): the dashboard card is a summary, and repeating all nine of the strip's
 * indices directly under the strip would be noise.
 */
export const MARKET_ENTRIES: BoardEntry[] = [
  {
    label: "OMXS30",
    fullName: "OMX Stockholm 30",
    yahooSymbols: ["^OMX", "^OMXS30"],
    finnhubSymbols: ["OMXS30", "^OMX"],
    finnhubMatchers: [(v) => v.includes("omx stockholm 30"), (v) => v.includes("omxs30")],
    precision: 2
  },
  {
    label: "S&P 500",
    fullName: "S&P 500",
    yahooSymbols: ["^GSPC"],
    finnhubSymbols: ["^GSPC", "SPX"],
    finnhubMatchers: [(v) => v.includes("s p 500"), (v) => v.includes("gspc")],
    precision: 2
  },
  {
    label: "Nasdaq",
    fullName: "Nasdaq Composite",
    yahooSymbols: ["^IXIC"],
    finnhubSymbols: ["^IXIC"],
    finnhubMatchers: [(v) => v.includes("nasdaq composite")],
    precision: 2
  },
  {
    label: "DAX",
    fullName: "DAX (Germany 40)",
    yahooSymbols: ["^GDAXI"],
    finnhubSymbols: ["^GDAXI"],
    finnhubMatchers: [(v) => v.includes("dax")],
    precision: 2
  },
  {
    label: "FTSE 100",
    fullName: "FTSE 100",
    yahooSymbols: ["^FTSE"],
    finnhubSymbols: ["^FTSE"],
    finnhubMatchers: [(v) => v.includes("ftse 100")],
    precision: 2
  },
  {
    label: "Nikkei 225",
    fullName: "Nikkei 225",
    yahooSymbols: ["^N225"],
    finnhubSymbols: ["^N225"],
    finnhubMatchers: [(v) => v.includes("nikkei 225")],
    precision: 2
  }
];

/** Front-month futures — the contract Yahoo quotes under the `=F` suffix. */
export const COMMODITY_ENTRIES: BoardEntry[] = [
  yahooOnly("Gold", "Gold (COMEX front month)", "GC=F", 2, "USD/oz"),
  yahooOnly("Silver", "Silver (COMEX front month)", "SI=F", 2, "USD/oz"),
  yahooOnly("Brent", "Brent crude (ICE front month)", "BZ=F", 2, "USD/bbl"),
  yahooOnly("WTI", "WTI crude (NYMEX front month)", "CL=F", 2, "USD/bbl"),
  yahooOnly("Copper", "Copper (COMEX front month)", "HG=F", 3, "USD/lb"),
  yahooOnly("Nat gas", "Natural gas (NYMEX front month)", "NG=F", 3, "USD/MMBtu")
];

export const CRYPTO_ENTRIES: BoardEntry[] = [
  yahooOnly("BTC", "Bitcoin", "BTC-USD", 0, "USD"),
  yahooOnly("ETH", "Ethereum", "ETH-USD", 0, "USD"),
  yahooOnly("SOL", "Solana", "SOL-USD", 2, "USD"),
  yahooOnly("XRP", "XRP", "XRP-USD", 4, "USD"),
  yahooOnly("ADA", "Cardano", "ADA-USD", 4, "USD"),
  yahooOnly("DOGE", "Dogecoin", "DOGE-USD", 4, "USD")
];

/**
 * SEK first — the display currency is SEK (ROADMAP D5) and the audience is
 * Swedish through M3, so "what is the dollar worth today" is the question this
 * card exists to answer.
 */
export const FX_ENTRIES: BoardEntry[] = [
  yahooOnly("USD/SEK", "US dollar / Swedish krona", "USDSEK=X", 4),
  yahooOnly("EUR/SEK", "Euro / Swedish krona", "EURSEK=X", 4),
  yahooOnly("GBP/SEK", "British pound / Swedish krona", "GBPSEK=X", 4),
  yahooOnly("NOK/SEK", "Norwegian krone / Swedish krona", "NOKSEK=X", 4),
  yahooOnly("DKK/SEK", "Danish krone / Swedish krona", "DKKSEK=X", 4),
  yahooOnly("EUR/USD", "Euro / US dollar", "EURUSD=X", 4)
];

export const BOARD_GROUPS: Record<BoardGroupKey, BoardEntry[]> = {
  markets: MARKET_ENTRIES,
  commodities: COMMODITY_ENTRIES,
  crypto: CRYPTO_ENTRIES,
  fx: FX_ENTRIES
};

/**
 * The movers universe.
 *
 * There is no free "market gainers and losers" feed behind either provider, and
 * inventing one is not an option. So the gainers/losers cards rank a *named,
 * fixed* universe — the OMXS30-weight Swedish large caps plus the US mega caps
 * a Swedish retail investor actually holds — and the UI says so in as many
 * words. "Top movers in 24 tracked names" is a true statement about a real
 * measurement; "today's biggest gainers" would be a claim about a whole market
 * we did not observe.
 *
 * Kept at 24 because every name costs an upstream quote. The route batches them
 * through one Yahoo call and caches the result, so the cost is one request per
 * refresh window shared across all viewers — not 24 per viewer.
 */
export const MOVERS_UNIVERSE: Array<{ symbol: string; name: string }> = [
  // Swedish large caps
  { symbol: "VOLV-B.ST", name: "Volvo B" },
  { symbol: "ERIC-B.ST", name: "Ericsson B" },
  { symbol: "HM-B.ST", name: "H&M B" },
  { symbol: "INVE-B.ST", name: "Investor B" },
  { symbol: "ATCO-A.ST", name: "Atlas Copco A" },
  { symbol: "SEB-A.ST", name: "SEB A" },
  { symbol: "SWED-A.ST", name: "Swedbank A" },
  { symbol: "SHB-A.ST", name: "Handelsbanken A" },
  { symbol: "TELIA.ST", name: "Telia" },
  { symbol: "SAND.ST", name: "Sandvik" },
  { symbol: "ASSA-B.ST", name: "Assa Abloy B" },
  { symbol: "EVO.ST", name: "Evolution" },
  { symbol: "NIBE-B.ST", name: "NIBE B" },
  { symbol: "SKF-B.ST", name: "SKF B" },
  { symbol: "ESSITY-B.ST", name: "Essity B" },
  { symbol: "ALFA.ST", name: "Alfa Laval" },
  // US mega caps
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AVGO", name: "Broadcom" }
];
