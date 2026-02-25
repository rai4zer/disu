export type TickerSuggestion = {
  symbol: string;
  name: string;
  aliases?: string[];
};

export const TICKER_SUGGESTIONS: TickerSuggestion[] = [
  { symbol: "AAPL", name: "Apple", aliases: ["Apple Inc"] },
  { symbol: "AVGO", name: "Broadcom", aliases: ["Broadcom Inc"] },
  { symbol: "MSFT", name: "Microsoft", aliases: ["Microsoft Corp"] },
  { symbol: "NVDA", name: "NVIDIA", aliases: ["Nvidia Corp"] },
  { symbol: "AMZN", name: "Amazon", aliases: ["Amazon.com"] },
  { symbol: "GOOGL", name: "Alphabet", aliases: ["Google"] },
  { symbol: "META", name: "Meta", aliases: ["Facebook"] },
  { symbol: "TSLA", name: "Tesla", aliases: ["Tesla Inc"] },
  { symbol: "AMD", name: "Advanced Micro Devices", aliases: ["Advanced Micro Devices Inc"] },
  { symbol: "NFLX", name: "Netflix", aliases: ["Netflix Inc"] },
  { symbol: "JPM", name: "JPMorgan Chase", aliases: ["JP Morgan"] },
  { symbol: "V", name: "Visa", aliases: ["Visa Inc"] },
  { symbol: "MA", name: "Mastercard", aliases: ["MasterCard"] },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" },
  { symbol: "QQQ", name: "Invesco QQQ ETF" },
  { symbol: "PLTR", name: "Palantir", aliases: ["Palantir Technologies"] },
  { symbol: "COIN", name: "Coinbase", aliases: ["Coinbase Global"] }
];

export type ResolvedSuggestion = {
  symbol: string;
  label: string;
  name: string;
};

export function buildTickerSuggestions(query: string, limit = 10): ResolvedSuggestion[] {
  const q = query.trim().toLowerCase();
  const scored = TICKER_SUGGESTIONS.map((item) => {
    const aliases = item.aliases ?? [];
    const haystack = [item.symbol, item.name, ...aliases].map((text) => text.toLowerCase());
    const starts = haystack.some((text) => text.startsWith(q));
    const includes = haystack.some((text) => text.includes(q));
    const score = !q ? 0 : starts ? 2 : includes ? 1 : -1;
    return { item, score };
  })
    .filter((entry) => !q || entry.score >= 1)
    .sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol))
    .slice(0, limit);

  return scored.map((entry) => ({
    symbol: entry.item.symbol,
    label: `${entry.item.symbol} - ${entry.item.name}`,
    name: entry.item.name
  }));
}

export function resolveTickerSymbol(input: string): string | null {
  const q = input.trim().toLowerCase();
  if (!q) {
    return null;
  }
  const match = TICKER_SUGGESTIONS.find((item) => {
    const aliases = item.aliases ?? [];
    return [item.symbol, item.name, ...aliases].some((text) => text.toLowerCase() === q);
  });
  return match?.symbol ?? null;
}
