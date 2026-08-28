/**
 * Every third party the server talks to, and exactly what reaches it.
 *
 * ROADMAP §2.2 has a standing commitment: *"LLM providers see filing text, not
 * user holdings. Verify that is true and keep it true."* A promise like that
 * survives exactly as long as someone remembers it, so it is written down here
 * per party, next to the code path that makes it true, and the delivery check
 * fails on an outbound host that is not declared (ROADMAP §2.2).
 *
 * The GDPR distinction matters and is kept explicit rather than blurred:
 *
 *  - `processor` — handles personal data on our behalf. Needs an Art. 28
 *    agreement, appears in the privacy policy's sub-processor list, and is part
 *    of the transfer analysis.
 *  - `source` — we fetch public market, filing or news data from it. It learns
 *    that *DISU* asked about a symbol. It is told nothing about *who* holds it,
 *    and no personal data is sent. Not a processor, and listing it as one would
 *    misdescribe the arrangement.
 *
 * The line between the two is the thing to protect. If a change would start
 * sending user-identifying data to a `source`, that is not a config change —
 * it is a new processor, a policy update, and probably a consent question.
 */

import { PENDING, type LegalFact } from "./controller.ts";

export type ThirdPartyRole = "processor" | "source";

export type ThirdParty = {
  /** Legal name where it differs from the brand. */
  name: string;
  /** Hostnames this party is reached on, as they appear in the code. */
  hosts: string[];
  role: ThirdPartyRole;
  /** What the party does for the product, in a sentence a user can read. */
  purpose: { en: string; sv: string };
  /** What actually leaves this system for it. Be specific; be pessimistic. */
  receives: { en: string; sv: string };
  /** Where the processing happens, if known. `PENDING` when it is not. */
  region: LegalFact;
  /** The code path that determines what is sent. Check here before editing above. */
  boundary: string;
};

export const THIRD_PARTIES: ThirdParty[] = [
  {
    name: "Supabase",
    hosts: ["supabase.co"],
    role: "processor",
    purpose: {
      en: "Hosts the database that stores your account and everything in it.",
      sv: "Driftar databasen som lagrar ditt konto och allt i det."
    },
    receives: {
      en: "Everything the product stores about you: email address, holdings, job history, sessions, and your encrypted broker tokens.",
      sv: "Allt produkten lagrar om dig: e-postadress, innehav, jobbhistorik, sessioner och dina krypterade bankkopplingstoken."
    },
    region: PENDING,
    boundary: "app/lib/db/supabase.ts"
  },
  {
    name: "Tink AB (a Visa company)",
    hosts: ["api.tink.com", "link.tink.com"],
    role: "processor",
    purpose: {
      en: "Provides the regulated bank connection that reads your holdings from your broker.",
      sv: "Tillhandahåller den reglerade bankkopplingen som läser dina innehav hos din depotbank."
    },
    receives: {
      en: "You authenticate directly with your bank inside Tink's flow, so Tink sees that authentication and returns your holdings to us. Your bank credentials never pass through DISU.",
      sv: "Du autentiserar dig direkt hos din bank inne i Tinks flöde, så Tink ser den autentiseringen och lämnar dina innehav till oss. Dina bankinloggningsuppgifter passerar aldrig DISU."
    },
    region: "EU (Sweden)",
    boundary: "app/lib/brokers/tink.ts"
  },
  {
    name: "Resend",
    hosts: ["api.resend.com"],
    role: "processor",
    purpose: {
      en: "Sends the transactional email the product needs to work: password resets and replies on the feature board.",
      sv: "Skickar den transaktionella e-post produkten behöver: lösenordsåterställning och svar på förslagstavlan."
    },
    receives: {
      en: "Your email address and the contents of that message. No holdings are ever included in an email.",
      sv: "Din e-postadress och innehållet i meddelandet. Inga innehav skickas någonsin med e-post."
    },
    region: PENDING,
    boundary: "app/lib/auth/reset.ts, app/lib/feature-requests/notifications.ts"
  },
  {
    name: "Google LLC",
    hosts: ["accounts.google.com", "oauth2.googleapis.com"],
    role: "processor",
    purpose: {
      en: "Sign in with Google, if you choose it instead of a password.",
      sv: "Logga in med Google, om du väljer det i stället för ett lösenord."
    },
    receives: {
      en: "Google learns that you signed in to DISU. We receive your email address and a stable account identifier, and ask for nothing else.",
      sv: "Google får veta att du loggade in på DISU. Vi tar emot din e-postadress och en bestående kontoidentifierare, och begär inget annat."
    },
    region: "United States (Google Ireland Limited for EU users)",
    boundary: "app/lib/auth/google.ts"
  },
  {
    name: "Groq",
    hosts: ["api.groq.com"],
    role: "processor",
    purpose: {
      en: "Writes the plain-language summary of a company filing, and translates release notes.",
      sv: "Skriver sammanfattningen av en företagsrapport på vanlig svenska, och översätter versionsnyheter."
    },
    receives: {
      en: "The ticker you asked about and the text of that public filing. Your holdings, your email address and your account identifier are never sent to a language model.",
      sv: "Tickern du frågade om och texten i den offentliga rapporten. Dina innehav, din e-postadress och din kontoidentifierare skickas aldrig till en språkmodell."
    },
    region: "United States",
    boundary: "app/lib/primers/executor.ts (passes --ticker only), app/lib/release-notes/translate.ts"
  },
  {
    name: "OpenAI",
    hosts: ["api.openai.com"],
    role: "processor",
    purpose: {
      en: "Same role as Groq, used when the deployment is configured for an OpenAI-compatible endpoint instead.",
      sv: "Samma roll som Groq, används när miljön är konfigurerad för en OpenAI-kompatibel slutpunkt i stället."
    },
    receives: {
      en: "The ticker and the public filing text, on the same terms as Groq.",
      sv: "Tickern och den offentliga rapporttexten, på samma villkor som Groq."
    },
    region: "United States",
    boundary: "app/lib/release-notes/translate.ts"
  },
  {
    name: "Yahoo Finance",
    hosts: ["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
    role: "source",
    purpose: {
      en: "Prices and index levels.",
      sv: "Kurser och indexnivåer."
    },
    receives: {
      en: "A symbol. Requests are made by our server and carry nothing about who is looking at it.",
      sv: "En symbol. Förfrågningarna görs av vår server och bär inget om vem som tittar."
    },
    region: "United States",
    boundary: "app/lib/market/market-provider.ts"
  },
  {
    name: "Have I Been Pwned (Pwned Passwords)",
    hosts: ["api.pwnedpasswords.com"],
    role: "source",
    purpose: {
      en: "Checks whether a password you are choosing already appears in a known data breach.",
      sv: "Kontrollerar om ett lösenord du väljer redan förekommer i en känd dataläcka."
    },
    receives: {
      en: "The first five characters of a SHA-1 hash of the candidate password — a bucket shared by hundreds of thousands of different passwords. The password itself, the full hash, your email address and your IP address are never sent; the request is made by our server.",
      sv: "De fem första tecknen i en SHA-1-summa av det tänkta lösenordet — en grupp som hundratusentals olika lösenord delar. Själva lösenordet, hela summan, din e-postadress och din IP-adress skickas aldrig; förfrågan görs av vår server."
    },
    region: "United Kingdom (Cloudflare edge)",
    boundary: "app/lib/security/pwned-passwords.ts"
  },
  {
    name: "Finnhub",
    hosts: ["finnhub.io"],
    role: "source",
    purpose: {
      en: "Alternative market-data feed.",
      sv: "Alternativt marknadsdataflöde."
    },
    receives: {
      en: "A symbol, on the same terms as Yahoo Finance.",
      sv: "En symbol, på samma villkor som Yahoo Finance."
    },
    region: "United States",
    boundary: "app/api/market/indices/route.ts"
  },
  {
    name: "U.S. Securities and Exchange Commission (EDGAR)",
    hosts: ["www.sec.gov", "data.sec.gov"],
    role: "source",
    purpose: {
      en: "The public filings a primer is written from.",
      sv: "De offentliga rapporter en primer skrivs utifrån."
    },
    receives: {
      en: "A ticker or company identifier, plus the contact address EDGAR requires callers to send.",
      sv: "En ticker eller företagsidentifierare, plus den kontaktadress EDGAR kräver att anropare skickar."
    },
    region: "United States",
    boundary: "python/src/filings/, app/lib/quant/executor.ts"
  },
  {
    name: "Placera forum",
    hosts: ["api.forum.placera.se"],
    role: "source",
    purpose: {
      en: "Public forum posts, for the market-mood view.",
      sv: "Offentliga foruminlägg, för marknadsstämningsvyn."
    },
    receives: {
      en: "A search term or symbol.",
      sv: "En sökterm eller symbol."
    },
    region: "EU (Sweden)",
    boundary: "app/placera/summary.ts"
  },
  {
    name: "News publishers (Financial Times, The New York Times, Dow Jones, Google News)",
    hosts: ["www.ft.com", "rss.nytimes.com", "feeds.a.dj.com", "news.google.com"],
    role: "source",
    purpose: {
      en: "Public headline feeds.",
      sv: "Offentliga nyhetsflöden."
    },
    receives: {
      en: "Nothing specific to you. The server fetches the same public feed once and shares the result.",
      sv: "Inget som är specifikt för dig. Servern hämtar samma offentliga flöde en gång och delar resultatet."
    },
    region: "United States and EU",
    boundary: "app/api/news/feed/route.ts, python/src/filings/news.py"
  },
  {
    name: "Google Analytics (Google Ireland Limited)",
    hosts: ["www.googletagmanager.com"],
    role: "processor",
    purpose: {
      en: "Measures which pages are used and where people give up, so the product can be improved.",
      sv: "Mäter vilka sidor som används och var människor ger upp, så att produkten kan förbättras."
    },
    receives: {
      en: "Only if you agree to analytics: the pages you view on DISU, your approximate location, your device and browser, and a random identifier that links those visits together. Not your holdings, not your email address.",
      sv: "Endast om du godkänner analys: de sidor du besöker på DISU, din ungefärliga plats, din enhet och webbläsare, och en slumpmässig identifierare som binder besöken samman. Inte dina innehav, inte din e-postadress."
    },
    region: "EU with transfers to the United States",
    boundary: "app/components/consent-tags.tsx (gated on the analytics category)"
  },
  {
    name: "Google Ads (Google Ireland Limited)",
    hosts: [],
    role: "processor",
    purpose: {
      en: "Measures which advert brought you here, and shows DISU adverts to you on other sites.",
      sv: "Mäter vilken annons som förde dig hit, och visar DISU-annonser för dig på andra sajter."
    },
    receives: {
      en: "Only if you agree to advertising: that you visited DISU, which pages, and which advert you arrived from. Google may combine this with what it already knows about you from other sites.",
      sv: "Endast om du godkänner annonsering: att du besökt DISU, vilka sidor, och vilken annons du kom från. Google kan kombinera detta med vad de redan vet om dig från andra sajter."
    },
    region: "EU with transfers to the United States",
    boundary: "app/components/consent-tags.tsx (gated on the marketing category)"
  },
  {
    name: "Meta Platforms Ireland Limited",
    hosts: ["connect.facebook.net"],
    role: "processor",
    purpose: {
      en: "Measures Facebook and Instagram campaigns, and shows DISU adverts to you there.",
      sv: "Mäter kampanjer på Facebook och Instagram, och visar DISU-annonser för dig där."
    },
    receives: {
      en: "Only if you agree to advertising: that you visited DISU and which pages. Meta can link this to your Facebook or Instagram account if you have one.",
      sv: "Endast om du godkänner annonsering: att du besökt DISU och vilka sidor. Meta kan koppla detta till ditt Facebook- eller Instagram-konto om du har ett."
    },
    region: "EU with transfers to the United States",
    boundary: "app/components/consent-tags.tsx (gated on the marketing category)"
  },
  {
    name: "LinkedIn Ireland Unlimited Company",
    hosts: ["snap.licdn.com"],
    role: "processor",
    purpose: {
      en: "Measures LinkedIn campaigns, and shows DISU adverts to you on LinkedIn.",
      sv: "Mäter LinkedIn-kampanjer, och visar DISU-annonser för dig på LinkedIn."
    },
    receives: {
      en: "Only if you agree to advertising: that you visited DISU and which pages. LinkedIn can link this to your LinkedIn account if you have one.",
      sv: "Endast om du godkänner annonsering: att du besökt DISU och vilka sidor. LinkedIn kan koppla detta till ditt LinkedIn-konto om du har ett."
    },
    region: "EU with transfers to the United States",
    boundary: "app/components/consent-tags.tsx (gated on the marketing category)"
  },
  {
    name: "Hosting provider",
    hosts: [],
    role: "processor",
    purpose: {
      en: "Runs the application server.",
      sv: "Kör applikationsservern."
    },
    receives: {
      en: "Whatever passes through a request: your IP address, and the traffic between your browser and the application.",
      sv: "Det som passerar en förfrågan: din IP-adress och trafiken mellan din webbläsare och applikationen."
    },
    region: PENDING,
    boundary: "ROADMAP §2.5 / D1 — not yet decided"
  }
];

/**
 * A second boundary this register now carries.
 *
 * The advertising and analytics parties above are the only entries whose
 * `receives` begins "Only if you agree". That phrase is load-bearing: it is a
 * statement about `app/components/consent-tags.tsx`, which renders no script for
 * a category the visitor has not agreed to. If a tag is ever loaded before
 * consent — including "loaded but signalled to hold off" — these descriptions
 * become false and the privacy policy becomes a misstatement, not a stale doc.
 */

/**
 * Hosts that appear in the code but are never sent anything.
 *
 * The delivery guard treats an undeclared outbound host as a build failure, so
 * a host that is only ever *linked to* needs to be exempted explicitly, with
 * the reason written down. Adding a host here is a claim that no request
 * carrying user data is ever made to it — do not add one to silence the guard.
 */
export const NON_DATA_HOSTS: Record<string, string> = {
  "www.imy.se": "Linked in the privacy policy so a user can reach the supervisory authority. We never call it."
};

export function partiesWithRole(role: ThirdPartyRole): ThirdParty[] {
  return THIRD_PARTIES.filter((party) => party.role === role);
}

/** Every declared host, for the delivery guard. */
export function declaredHosts(): Set<string> {
  return new Set(THIRD_PARTIES.flatMap((party) => party.hosts));
}
