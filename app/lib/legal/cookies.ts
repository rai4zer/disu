/**
 * Every cookie the server sets, everything the browser stores locally, and every
 * cookie a consented third-party tag drops.
 *
 * This used to be a list of nothing but essentials, which is why DISU shipped a
 * notice rather than a consent wall. That changed when analytics and cross-site
 * advertising were added: entries below are now categorised `analytics` and
 * `marketing`, `noticeIsSufficient()` returns false, and the UI is a real
 * consent gate (`app/components/consent-banner.tsx`). The tripwire fired and was
 * acted on — leaving it as a notice would have been the failure this file exists
 * to prevent.
 *
 * `scripts/check-delivery-readiness.mjs` fails on a cookie set anywhere in
 * `app/` that is not declared here, and separately fails if a consent-requiring
 * category is declared while no consent gate exists.
 *
 * The vendor cookies are described here for the user-facing table.
 * `app/lib/legal/tags.ts` is what the code actually enforces against — it holds
 * the same cookie names plus whether each one is ours to delete on withdrawal.
 * Keep the two in step; the tests check that every tag cookie is declared here.
 */

export type StorageCategory =
  /** Without it the service does not work. No consent needed (ePrivacy Art. 5(3)). */
  | "essential"
  /**
   * Remembers a choice the user made.
   *
   * Legally arguable either way for a purely first-party, unshared preference.
   * DISU puts it behind consent anyway, because once a gate exists the marginal
   * cost of one more honest toggle is nothing, and the alternative is arguing
   * about it later.
   */
  | "preference"
  /** Requires consent. Nothing may be written until the visitor agrees. */
  | "analytics"
  /** Requires consent, and involves another company profiling the visitor. */
  | "marketing";

/**
 * `sessionStorage` is listed separately from `localStorage` because the
 * difference is the point: it dies with the tab. The funnel's anonymous id uses
 * it so that measurement covers one visit and structurally cannot follow anyone
 * across visits (`app/lib/analytics/anon-id.ts`).
 */
export type StorageMedium = "cookie" | "localStorage" | "sessionStorage";

export type StorageEntry = {
  name: string;
  medium: StorageMedium;
  category: StorageCategory;
  /** How long it lives, in words a user can check against their browser. */
  lifetime: { en: string; sv: string };
  purpose: { en: string; sv: string };
  /** Where it is set. */
  source: string;
};

export const STORAGE_ENTRIES: StorageEntry[] = [
  {
    name: "disu_session",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Until you sign out, or it expires", sv: "Tills du loggar ut, eller den går ut" },
    purpose: {
      en: "Keeps you signed in. It is a signed token, readable only by the server, and it can be revoked server-side.",
      sv: "Håller dig inloggad. Den är en signerad token som bara servern kan läsa, och den kan återkallas på serversidan."
    },
    source: "app/lib/auth/session.ts"
  },
  {
    name: "disu_google_state",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Minutes — deleted as soon as sign-in finishes", sv: "Minuter — raderas så snart inloggningen är klar" },
    purpose: {
      en: "Ties the sign-in you started to the answer that comes back from Google, so someone else cannot substitute theirs.",
      sv: "Binder inloggningen du startade till svaret som kommer tillbaka från Google, så att ingen annan kan byta ut sitt."
    },
    source: "app/api/auth/google/start/route.ts"
  },
  {
    name: "disu_google_pkce",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Minutes — deleted as soon as sign-in finishes", sv: "Minuter — raderas så snart inloggningen är klar" },
    purpose: {
      en: "The PKCE secret that proves the code coming back from Google was issued to this browser.",
      sv: "PKCE-hemligheten som bevisar att koden från Google utfärdades till just den här webbläsaren."
    },
    source: "app/api/auth/google/start/route.ts"
  },
  {
    name: "disu_google_nonce",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Minutes — deleted as soon as sign-in finishes", sv: "Minuter — raderas så snart inloggningen är klar" },
    purpose: {
      en: "Makes a replayed Google sign-in token useless.",
      sv: "Gör en återspelad inloggningstoken från Google värdelös."
    },
    source: "app/api/auth/google/start/route.ts"
  },
  {
    name: "disu_tink_state",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Minutes — deleted when the broker connection finishes", sv: "Minuter — raderas när bankkopplingen är klar" },
    purpose: {
      en: "The same protection as above, for the broker connection you start at Tink.",
      sv: "Samma skydd som ovan, för bankkopplingen du startar hos Tink."
    },
    source: "app/api/brokers/tink/start/route.ts"
  },
  {
    name: "disu_tink_pkce",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "Minutes — deleted when the broker connection finishes", sv: "Minuter — raderas när bankkopplingen är klar" },
    purpose: {
      en: "The PKCE secret for the broker connection.",
      sv: "PKCE-hemligheten för bankkopplingen."
    },
    source: "app/api/brokers/tink/start/route.ts"
  },
  {
    name: "disu_feature_vote",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "One year", sv: "Ett år" },
    purpose: {
      en: "Lets you vote on the public feature board without an account, and stops the same browser voting twice. It is a random value and is not linked to your account.",
      sv: "Låter dig rösta på den öppna förslagstavlan utan konto, och hindrar samma webbläsare från att rösta två gånger. Det är ett slumpvärde och kopplas inte till ditt konto."
    },
    source: "app/api/feature-requests/[requestId]/vote/route.ts"
  },
  {
    name: "theme",
    medium: "localStorage",
    category: "preference",
    lifetime: { en: "Until you clear your browser data", sv: "Tills du rensar webbläsardata" },
    purpose: { en: "Remembers light or dark.", sv: "Kommer ihåg ljust eller mörkt." },
    source: "app/layout.tsx"
  },
  {
    name: "app_language",
    medium: "localStorage",
    category: "preference",
    lifetime: { en: "Until you clear your browser data", sv: "Tills du rensar webbläsardata" },
    purpose: { en: "Remembers English or Swedish.", sv: "Kommer ihåg engelska eller svenska." },
    source: "app/i18n/language.tsx"
  },
  {
    name: "pref.* and disu.jobs.*",
    medium: "localStorage",
    category: "preference",
    lifetime: { en: "Until you clear your browser data", sv: "Tills du rensar webbläsardata" },
    purpose: {
      en: "Remembers the last ticker, range and chart mode you looked at in each module, and which long-running job you were watching, so a page reload does not lose your place.",
      sv: "Kommer ihåg den senaste tickern, tidsintervallet och diagramläget du tittade på i varje modul, och vilket långkörande jobb du följde, så att en omladdning inte tappar var du var."
    },
    source: "app/quant/page.tsx, app/primers/page.tsx, app/placera/page.tsx"
  },
  {
    name: "disu_anon_id",
    medium: "sessionStorage",
    category: "analytics",
    lifetime: { en: "Until you close the tab", sv: "Tills du stänger fliken" },
    purpose: {
      en: "A random value that links the steps of one visit — the page you arrived on, whether you opened the sign-up form — so we can see where people give up. It is created only if you agree to analytics, is deleted the moment you withdraw, is not sent to anyone else, and cannot follow you to your next visit.",
      sv: "Ett slumpvärde som binder samman stegen i ett besök — vilken sida du kom till, om du öppnade registreringsformuläret — så att vi kan se var människor ger upp. Det skapas bara om du godkänner analys, raderas i samma stund du återkallar, skickas inte till någon annan, och kan inte följa dig till ditt nästa besök."
    },
    source: "app/lib/analytics/anon-id.ts"
  },
  {
    name: "disu_consent",
    medium: "cookie",
    category: "essential",
    lifetime: { en: "6 months, then we ask again", sv: "6 månader, sedan frågar vi igen" },
    purpose: {
      en: "Records which cookie categories you agreed to, and when. It is itself essential — without it we would have to ask you on every single page.",
      sv: "Registrerar vilka cookie-kategorier du godkände, och när. Den är själv nödvändig — utan den skulle vi behöva fråga dig på varje enskild sida."
    },
    source: "app/lib/legal/consent.ts"
  },
  {
    name: "_ga, _ga_*, _gid",
    medium: "cookie",
    category: "analytics",
    lifetime: { en: "Up to 2 years", sv: "Upp till 2 år" },
    purpose: {
      en: "Google Analytics. Distinguishes visitors so we can see which pages get used and where people give up. Only set if you agree to analytics.",
      sv: "Google Analytics. Skiljer besökare åt så att vi kan se vilka sidor som används och var människor ger upp. Sätts bara om du godkänner analys."
    },
    source: "app/components/consent-tags.tsx"
  },
  {
    name: "_gcl_au, _gcl_aw",
    medium: "cookie",
    category: "marketing",
    lifetime: { en: "Up to 90 days", sv: "Upp till 90 dagar" },
    purpose: {
      en: "Google Ads. Links your visit to an advert you clicked, and lets Google show you DISU adverts elsewhere. Only set if you agree to advertising.",
      sv: "Google Ads. Kopplar ditt besök till en annons du klickat på, och låter Google visa dig DISU-annonser på andra ställen. Sätts bara om du godkänner annonsering."
    },
    source: "app/components/consent-tags.tsx"
  },
  {
    name: "_fbp, _fbc",
    medium: "cookie",
    category: "marketing",
    lifetime: { en: "Up to 90 days", sv: "Upp till 90 dagar" },
    purpose: {
      en: "Meta Pixel. Tells Meta you visited DISU so campaigns can be measured and adverts shown to you on Facebook and Instagram. Only set if you agree to advertising.",
      sv: "Meta Pixel. Berättar för Meta att du besökt DISU så att kampanjer kan mätas och annonser visas för dig på Facebook och Instagram. Sätts bara om du godkänner annonsering."
    },
    source: "app/components/consent-tags.tsx"
  },
  {
    name: "li_sugr, UserMatchHistory, bcookie, lidc",
    medium: "cookie",
    category: "marketing",
    lifetime: { en: "Up to 1 year", sv: "Upp till 1 år" },
    purpose: {
      en: "LinkedIn Insight Tag, for LinkedIn campaign measurement and advertising. Only set if you agree to advertising. Some of these are set on LinkedIn's own domain, so we cannot delete them for you.",
      sv: "LinkedIn Insight Tag, för mätning av LinkedIn-kampanjer och annonsering. Sätts bara om du godkänner annonsering. Några av dessa sätts på LinkedIns egen domän, så vi kan inte radera dem för dig."
    },
    source: "app/components/consent-tags.tsx"
  }
];

/** Categories that may not be written before the visitor agrees. */
export const CONSENT_REQUIRING_CATEGORIES: StorageCategory[] = ["preference", "analytics", "marketing"];

/**
 * Whether a plain notice would still be legally sufficient.
 *
 * False since analytics and advertising were added, which is what obliges
 * `app/components/consent-banner.tsx` to be a gate rather than a notice. Kept
 * rather than deleted: it is the thing the delivery check and the tests read to
 * decide whether a gate is required, and it would go true again if the tracking
 * were ever removed.
 */
export function noticeIsSufficient(): boolean {
  return !STORAGE_ENTRIES.some((entry) => CONSENT_REQUIRING_CATEGORIES.includes(entry.category));
}

/** Entries that must not be written without consent. */
export function consentRequiringEntries(): StorageEntry[] {
  return STORAGE_ENTRIES.filter((entry) => CONSENT_REQUIRING_CATEGORIES.includes(entry.category));
}

export function cookieNames(): Set<string> {
  return new Set(STORAGE_ENTRIES.filter((entry) => entry.medium === "cookie").map((entry) => entry.name));
}
