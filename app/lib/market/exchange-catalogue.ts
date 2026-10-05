/**
 * The world's financial centres, as the dashboard map draws them.
 *
 * One entry per centre: where it is on the planet, what the exchange there is
 * called, and which index stands for "how did that market do today". The index
 * descriptor is the same `IndexDescriptor` the strip and the board use, so
 * these readings go through `MarketProvider.getIndexQuotes()` and inherit its
 * rules — one batched upstream call, and `null` rather than an invented level
 * for anything that could not be read (docs/synthetic-data-policy.md).
 *
 * `chip` is cartography, not data: the coordinates the callout box sits at, in
 * the map's own units. They are hand-placed because no automatic labeller is
 * going to know that the North Atlantic is the only free space near London and
 * that Frankfurt, Paris, Zurich, Milan and Madrid have to queue up beneath it.
 * Each column is ordered north-to-south so the leader lines fan out without
 * crossing each other.
 *
 * Deliberately not exhaustive. Every added pin costs an upstream symbol and, in
 * Europe, a callout box there is no room for — so this is the largest venue per
 * centre, and a centre without a reliably quotable index (Moscow, Dubai) is
 * left off rather than drawn as a permanent "—".
 */

import type { IndexDescriptor } from "./index-quotes";

export type ExchangeEntry = IndexDescriptor & {
  /** Exchange abbreviation — what the callout box shows. */
  code: string;
  /** The city, for the tooltip and the screen-reader label. */
  city: string;
  /** The index whose level the box shows, named for the tooltip. */
  indexName: string;
  latitude: number;
  longitude: number;
  /** Digits to render in the level. Indices need two. */
  precision: number;
  /** Callout box centre, in map units (see app/lib/geo/world-map-paths.ts). */
  chip: { x: number; y: number };
};

function exchange(
  code: string,
  city: string,
  indexName: string,
  yahooSymbols: string[],
  latitude: number,
  longitude: number,
  chip: { x: number; y: number }
): ExchangeEntry {
  return {
    code,
    city,
    indexName,
    // Finnhub's index list covers a handful of US indices and resolves almost
    // none of these, so the Finnhub leg is left to fail fast and Yahoo — which
    // quotes all of them off one batch endpoint — is the real source. Same
    // decision, for the same reason, as the board catalogue's `yahooOnly`.
    yahooSymbols,
    finnhubSymbols: [],
    finnhubMatchers: [],
    label: code,
    fullName: `${indexName} · ${city}`,
    latitude,
    longitude,
    precision: 2,
    chip
  };
}

export const EXCHANGE_ENTRIES: ExchangeEntry[] = [
  // --- Americas. Callouts stack in the eastern Pacific. ---
  exchange("TSX", "Toronto", "S&P/TSX Composite", ["^GSPTSE"], 43.649, -79.382, { x: 160, y: 30 }),
  exchange("NYSE", "New York", "NYSE Composite", ["^NYA"], 40.707, -74.011, { x: 160, y: 70 }),
  exchange("NASDAQ", "New York", "Nasdaq Composite", ["^IXIC", "^NDX"], 40.756, -73.986, { x: 160, y: 110 }),
  exchange("BMV", "Mexico City", "S&P/BMV IPC", ["^MXX"], 19.433, -99.133, { x: 160, y: 168 }),
  exchange("B3", "São Paulo", "Ibovespa", ["^BVSP"], -23.55, -46.633, { x: 270, y: 300 }),

  // --- Europe. One column down the North Atlantic, north to south. ---
  exchange("LSE", "London", "FTSE 100", ["^FTSE"], 51.515, -0.092, { x: 418, y: 30 }),
  exchange("XETR", "Frankfurt", "DAX", ["^GDAXI"], 50.111, 8.682, { x: 418, y: 70 }),
  exchange("ENX", "Paris", "CAC 40", ["^FCHI"], 48.87, 2.341, { x: 418, y: 110 }),
  exchange("SIX", "Zurich", "SMI", ["^SSMI"], 47.377, 8.542, { x: 418, y: 150 }),
  exchange("MIL", "Milan", "FTSE MIB", ["FTSEMIB.MI", "^FTMIB"], 45.464, 9.19, { x: 422, y: 190 }),
  exchange("BME", "Madrid", "IBEX 35", ["^IBEX"], 40.417, -3.704, { x: 430, y: 230 }),
  // Stockholm gets the Arctic to itself rather than a ninth slot in the queue.
  exchange("OMX", "Stockholm", "OMX Stockholm 30", ["^OMX", "^OMXS30"], 59.329, 18.069, { x: 566, y: 26 }),

  // --- Africa and the Middle East. Riyadh's box goes over the empty Sahara
  //     rather than the Arabian Sea, which is where Mumbai's leader runs. ---
  exchange("TADAWUL", "Riyadh", "Tadawul All Share", ["^TASI.SR", "TASI.SR"], 24.713, 46.675, { x: 585, y: 205 }),
  exchange("JSE", "Johannesburg", "FTSE/JSE All Share", ["^J203.JO", "^JN0U.JO"], -26.204, 28.047, { x: 500, y: 366 }),

  // --- Asia-Pacific. Callouts sit in the Indian Ocean and the west Pacific. ---
  exchange("BSE", "Mumbai", "BSE Sensex", ["^BSESN"], 19.076, 72.878, { x: 652, y: 282 }),
  exchange("SGX", "Singapore", "Straits Times", ["^STI"], 1.352, 103.82, { x: 776, y: 330 }),
  exchange("KRX", "Seoul", "KOSPI", ["^KS11"], 37.567, 126.978, { x: 920, y: 52 }),
  exchange("JPX", "Tokyo", "Nikkei 225", ["^N225"], 35.676, 139.65, { x: 920, y: 96 }),
  exchange("SSE", "Shanghai", "SSE Composite", ["000001.SS"], 31.23, 121.474, { x: 920, y: 140 }),
  exchange("HKEX", "Hong Kong", "Hang Seng", ["^HSI"], 22.284, 114.159, { x: 920, y: 205 }),
  exchange("ASX", "Sydney", "S&P/ASX 200", ["^AXJO", "^AORD"], -33.869, 151.209, { x: 820, y: 400 })
];
