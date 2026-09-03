/**
 * The instrument payload's shape, and nothing else.
 *
 * A leaf on purpose: **no imports.** The instrument page and its tabs are
 * client components that need these types, and `instrument-bridge.ts` — where
 * they would otherwise live — reaches `node:child_process` to spawn Python.
 *
 * Type-only imports are erased by the compiler, so importing them from the
 * bridge does not in fact break the bundle. This module exists so the boundary
 * does not depend on someone remembering the `type` keyword: drop it in a
 * refactor and there is still nothing here to leak. Same discipline as
 * `quote.ts` and `ticker-currency.ts`, and the reason both of those say so in
 * their own headers.
 *
 * Contract: `docs/contracts/instrument-profile.schema.json`.
 */

/**
 * The overview tab. Every field is nullable because this is a feed rather than
 * a filing — a field it did not supply is omitted from the UI, never guessed.
 */
export type InstrumentProfile = {
  name: string | null;
  /** EQUITY | INDEX | FUTURE | CURRENCY | CRYPTOCURRENCY — decides which tabs can exist. */
  quoteType: string | null;
  exchange: string | null;
  currency: string | null;
  /** The issuer's own description, passed through unedited. Never generated. */
  summary: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  country: string | null;
  employees: number | null;
  /** null where the feed lists no chief executive. Not inferred from seniority. */
  ceo: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
};

/**
 * One reporting period.
 *
 * Every line is optional, and that is the point: a line the filer did not
 * report is absent rather than zero. On a bar chart a zero bar and a missing
 * bar look identical and mean opposite things.
 */
export type StatementPeriod = {
  period: string;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  assets?: number;
  equity?: number;
  debt?: number;
  liabilities?: number;
};

/** Headline, publisher, timestamp and link. Deliberately no summary or sentiment. */
export type InstrumentNews = {
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  link: string | null;
};

export type InstrumentAnalysts = {
  recommendations?: { strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number };
  analystCount?: number;
  /** Present only with both bounds — half a range rendered as a range is a fabricated bound. */
  priceTarget?: { current?: number; low?: number; high?: number; mean?: number; median?: number };
};

/**
 * Which tabs the page may render.
 *
 * Decided once, from what actually parsed, so the UI cannot disagree with the
 * payload about what it is able to show.
 */
export type InstrumentSections = {
  overview: boolean;
  kpi: boolean;
  news: boolean;
  analysts: boolean;
};

export type InstrumentDetail = {
  symbol: string;
  profile: InstrumentProfile;
  financials: { income: StatementPeriod[]; balance: StatementPeriod[] } | null;
  news: InstrumentNews[];
  analysts: InstrumentAnalysts | null;
  sections: InstrumentSections;
};
