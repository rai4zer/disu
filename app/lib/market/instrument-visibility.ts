/**
 * What a signed-out visitor may see on an instrument page.
 *
 * A leaf: no imports beyond the payload types, so both the route and the client
 * components can use it and there is exactly one definition of the line.
 *
 * **The line, and why it sits where it does.** ROADMAP §1.3 says DISU's wedge is
 * comprehension, not execution — "you already own this, here is what it
 * actually is, in words you use" — and §9.1 says value comes before an account.
 * So everything that answers *what is this company* is public: the business
 * summary, the sector, where it is listed, how many people it employs, the
 * price chart, the headlines. That is also the half that earns its way into
 * search results, which is the point of opening these pages at all (§4.6).
 *
 * Everything that answers *what is it worth, and should I buy it* needs an
 * account. Valuation multiples, the financial statements and analyst coverage
 * are what a prospective buyer opens a broker app for, and they are the reason
 * to sign up rather than bounce. That is a product decision, not a legal one.
 *
 * **This is enforced in the route, before serialisation, not in the UI.**
 * Hiding a field in a component still ships it in the JSON, where anyone can
 * read it in a network tab — which would make the gate theatre and, worse,
 * would quietly publish licensed-feed fundamentals to anonymous traffic.
 */

import type { InstrumentDetail, InstrumentProfile, InstrumentSections } from "./instrument-types.ts";

/**
 * Profile fields a signed-out visitor keeps: identity and description, never
 * valuation. Listed explicitly rather than as a blocklist so a new field added
 * to the payload is private by default — the safe direction to fail.
 */
const PUBLIC_PROFILE_FIELDS = [
  "name",
  "quoteType",
  "exchange",
  "currency",
  "summary",
  "sector",
  "industry",
  "website",
  "country",
  "employees",
  "ceo"
] as const satisfies ReadonlyArray<keyof InstrumentProfile>;

/** Named so the UI can explain what signing in adds, rather than just hiding it. */
export type GatedSection = "kpi" | "analysts" | "valuation";

export type PublicInstrumentDetail = InstrumentDetail & {
  /** What was withheld. Empty for a signed-in reader. */
  gated: GatedSection[];
};

/**
 * Strip an instrument payload down to what an anonymous visitor may have.
 *
 * Returns a new object; the input is never mutated, because the caller may be
 * handing the same cached detail to a signed-in reader on the next request.
 */
export function redactForPublic(detail: InstrumentDetail): PublicInstrumentDetail {
  const profile = {} as InstrumentProfile;
  for (const key of Object.keys(detail.profile) as Array<keyof InstrumentProfile>) {
    // Every non-public field is nulled rather than deleted, so the shape stays
    // identical for both audiences and the UI needs no separate type.
    (profile[key] as unknown) = (PUBLIC_PROFILE_FIELDS as ReadonlyArray<string>).includes(key)
      ? detail.profile[key]
      : null;
  }

  const gated: GatedSection[] = [];
  if (detail.sections.kpi) gated.push("kpi");
  if (detail.sections.analysts) gated.push("analysts");
  // Only claim valuation was withheld when there was something to withhold —
  // an index has no P/E to hide, and offering to unlock nothing is a worse
  // invitation than offering nothing.
  if (detail.profile.marketCap !== null || detail.profile.peRatio !== null) gated.push("valuation");

  const sections: InstrumentSections = {
    overview: detail.sections.overview,
    // The tabs disappear rather than rendering locked and empty. A tab that
    // opens onto nothing is the same broken promise as an empty KPI tab on
    // gold; the invitation to sign in belongs on the overview, once.
    kpi: false,
    news: detail.sections.news,
    analysts: false
  };

  return {
    symbol: detail.symbol,
    profile,
    financials: null,
    news: detail.news,
    analysts: null,
    sections,
    gated
  };
}

/** Identity for a signed-in reader: nothing withheld. */
export function fullDetail(detail: InstrumentDetail): PublicInstrumentDetail {
  return { ...detail, gated: [] };
}
