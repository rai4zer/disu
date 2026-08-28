/**
 * Who the data controller is, and how to reach them.
 *
 * A privacy policy that does not name a controller is not a privacy policy —
 * GDPR Art. 13(1)(a)-(b) requires the identity and contact details before any
 * of the rest means anything. ROADMAP §2.2 also has "register the entity" open,
 * so several of these facts do not exist yet.
 *
 * They are therefore declared here as `PENDING` rather than invented. Two things
 * follow from that, deliberately:
 *
 *  1. The pages render an honest, visible notice where a pending fact belongs,
 *     instead of a plausible-looking placeholder that reads as real.
 *  2. `scripts/check-delivery-readiness.mjs --strict-env` fails to boot a
 *     production server while anything here is still pending. The documents can
 *     be reviewed and iterated on now; they cannot go live half-identified.
 *
 * Fill these in when the entity is registered, and delete nothing else.
 */

/** A fact that does not exist yet. Never render this string to a user. */
export const PENDING = "PENDING" as const;

export type LegalFact = string | typeof PENDING;

export function isPending(fact: LegalFact): fact is typeof PENDING {
  return fact === PENDING;
}

export type Controller = {
  /** Registered legal name of the entity that controls the data. */
  legalName: LegalFact;
  /** Trading name shown in the product. Known today. */
  tradingName: string;
  /** Swedish organisationsnummer, once the company exists. */
  registrationNumber: LegalFact;
  /** Registered postal address, one line per element. */
  address: LegalFact;
  /** Where a data-subject request lands. */
  privacyEmail: LegalFact;
  /** General support address. */
  supportEmail: LegalFact;
  /**
   * Whether an Art. 37 DPO is appointed. A solo information service is very
   * unlikely to need one; recording the conclusion is still part of the file.
   */
  dataProtectionOfficer: LegalFact | null;
};

export const CONTROLLER: Controller = {
  legalName: PENDING,
  tradingName: "DISU",
  registrationNumber: PENDING,
  address: PENDING,
  privacyEmail: PENDING,
  supportEmail: PENDING,
  dataProtectionOfficer: null
};

/**
 * The supervisory authority a Swedish data subject complains to. Known and
 * fixed — this is not pending on anything.
 */
export const SUPERVISORY_AUTHORITY = {
  name: "Integritetsskyddsmyndigheten (IMY)",
  country: "Sweden",
  url: "https://www.imy.se"
} as const;

/**
 * Last substantive revision of the legal documents, ISO date.
 *
 * Bumped by hand, because "when did this change" is a question a user is
 * entitled to ask and an automatic build timestamp would answer it wrongly.
 */
export const LEGAL_DOCUMENTS_UPDATED = "2026-08-27";

/**
 * Every pending fact, for the delivery guard and for the in-page notice.
 */
export function pendingControllerFacts(): string[] {
  const pending: string[] = [];
  for (const [key, value] of Object.entries(CONTROLLER)) {
    if (typeof value === "string" && isPending(value)) {
      pending.push(key);
    }
  }
  return pending;
}
