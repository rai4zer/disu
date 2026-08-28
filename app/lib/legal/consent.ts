/**
 * Cookie consent: the model, shared by the server, the client and the tests.
 *
 * DISU now loads analytics and cross-site advertising tags, so ePrivacy
 * Art. 5(3) applies: nothing in the `analytics` or `marketing` categories may be
 * stored or read on someone's device until they have actively agreed. That makes
 * this file the enforcement point, not a formality — `hasConsent()` is what every
 * tag is gated on.
 *
 * Five rules are baked in here rather than left to the UI, because a UI is easy
 * to change by accident and these are the ones that get people fined:
 *
 *  1. **No pre-ticked boxes.** `DEFAULT_CONSENT` denies everything optional.
 *     Silence, a closed banner, or continued scrolling is not consent
 *     (GDPR Art. 4(11); CJEU *Planet49*).
 *  2. **Refusing is as easy as accepting.** Both are one click at the top level,
 *     which is why `acceptAll()` and `rejectAll()` are peers with identical
 *     shapes and the banner renders them with the same component and weight.
 *  3. **Withdrawal is as easy as giving** (Art. 7(3)). The preference centre is
 *     reachable from the footer on every page, forever, not just on first visit.
 *  4. **Consent is provable** (Art. 7(1)). The record carries what was agreed,
 *     when, and against which version of the purposes.
 *  5. **Consent expires.** A choice made once does not bind someone for life;
 *     re-asking after `CONSENT_MAX_AGE_DAYS` is the norm regulators expect.
 *
 * Changing what a category *covers* — adding a vendor, a purpose, a new kind of
 * tracking — invalidates the old answer, because it was an answer to a different
 * question. Bump `CONSENT_VERSION` when that happens and everyone is asked again.
 */

export const CONSENT_COOKIE_NAME = "disu_consent";

/**
 * Bump when the purposes change: a new vendor, a new category, or a material
 * change to what an existing category does. Stored consent at a lower version is
 * treated as absent, and the banner returns.
 *
 * v2: `analytics` stopped meaning only "Google Analytics, if configured" and
 * started also covering DISU's own funnel measurement — a first-party visit id
 * in `sessionStorage` and an events table we hold ourselves (ROADMAP §2.6).
 * Whether that is *more* or *less* invasive than GA4 is beside the point: a
 * v1 yes was an answer to a different question, so everyone is asked again.
 */
export const CONSENT_VERSION = 2;

/**
 * How long a recorded choice lasts before we ask again.
 *
 * Six months, applied to acceptance and refusal alike. Regulators are explicit
 * that a refusal must be remembered rather than re-prompted on every page — the
 * failure mode being nagged into consent — and equally that consent cannot be
 * indefinite. Six months is the interval CNIL recommends and nobody objects to.
 */
export const CONSENT_MAX_AGE_DAYS = 180;

export const CONSENT_CATEGORIES = ["necessary", "preference", "analytics", "marketing"] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** Categories the user can actually decide about. `necessary` is not one of them. */
export const OPTIONAL_CATEGORIES = CONSENT_CATEGORIES.filter(
  (category): category is Exclude<ConsentCategory, "necessary"> => category !== "necessary"
);

export type ConsentChoices = Record<ConsentCategory, boolean>;

export type ConsentRecord = {
  version: number;
  /** ISO timestamp of the choice. Part of demonstrating consent (Art. 7(1)). */
  decidedAt: string;
  choices: ConsentChoices;
};

/**
 * The state before anyone has chosen, and the state a "reject" produces.
 *
 * `necessary` is true because it is not consent — the session cookie is required
 * to deliver a service the user asked for, and Art. 5(3) exempts it. Everything
 * else is false. This constant is the no-pre-ticked-boxes rule; do not "helpfully"
 * default `analytics` to true.
 */
export const DEFAULT_CONSENT: ConsentChoices = {
  necessary: true,
  preference: false,
  analytics: false,
  marketing: false
};

export function acceptAll(): ConsentChoices {
  return { necessary: true, preference: true, analytics: true, marketing: true };
}

export function rejectAll(): ConsentChoices {
  return { ...DEFAULT_CONSENT };
}

export function isFullyRejected(choices: ConsentChoices): boolean {
  return OPTIONAL_CATEGORIES.every((category) => !choices[category]);
}

/**
 * Whether a category may fire right now.
 *
 * `null` — no decision recorded — denies everything optional. That is the whole
 * point: the absence of an answer is a "no", not a "not yet, go ahead".
 */
export function hasConsent(record: ConsentRecord | null, category: ConsentCategory): boolean {
  if (category === "necessary") {
    return true;
  }
  if (!record) {
    return false;
  }
  return record.choices[category] === true;
}

function isExpired(decidedAt: string, now: number): boolean {
  const decided = Date.parse(decidedAt);
  if (!Number.isFinite(decided)) {
    return true;
  }
  return now - decided > CONSENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Parses a stored record, returning `null` for anything not currently valid.
 *
 * Deliberately strict. A record that is malformed, from an older set of
 * purposes, or past its expiry is treated as no record at all, which means the
 * banner returns and nothing optional fires in the meantime. Failing open here
 * would mean tracking someone on the strength of a corrupted string.
 */
export function parseConsent(raw: string | undefined | null, now: number = Date.now()): ConsentRecord | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== CONSENT_VERSION) {
    return null;
  }
  if (typeof candidate.decidedAt !== "string" || isExpired(candidate.decidedAt, now)) {
    return null;
  }

  const rawChoices = candidate.choices;
  if (!rawChoices || typeof rawChoices !== "object" || Array.isArray(rawChoices)) {
    return null;
  }

  const choices = { ...DEFAULT_CONSENT };
  for (const category of OPTIONAL_CATEGORIES) {
    // Anything that is not exactly `true` is a no. An absent key, a string, a
    // truthy number — none of them are an affirmative act.
    choices[category] = (rawChoices as Record<string, unknown>)[category] === true;
  }

  return { version: CONSENT_VERSION, decidedAt: candidate.decidedAt, choices };
}

export function serialiseConsent(record: ConsentRecord): string {
  return encodeURIComponent(JSON.stringify(record));
}

export function makeRecord(choices: ConsentChoices, decidedAt: string): ConsentRecord {
  return {
    version: CONSENT_VERSION,
    decidedAt,
    // `necessary` is forced true regardless of what was passed: it is not a
    // choice, and storing `false` would misrepresent it as one.
    choices: { ...choices, necessary: true }
  };
}
