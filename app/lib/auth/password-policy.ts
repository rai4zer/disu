/**
 * What counts as an acceptable password (§2.3).
 *
 * The old rule was "at least 8 characters", which accepts `password1` — the
 * single most predictable thing a lay user picks, and the exact case the
 * roadmap called out. Length alone cannot fix that: `password12` is ten
 * characters and no better. So this module does three cheap things that
 * together kill the whole class:
 *
 *   1. A floor of 10 characters, and a ceiling (scrypt is deliberately slow;
 *      an unbounded input is a free CPU-burn primitive).
 *   2. A blocklist of common base words, matched after folding the disguises
 *      people actually use — trailing digits (`password2024`), leetspeak
 *      (`p@ssw0rd`), punctuation (`Password!`).
 *   3. Structural rejects: too few distinct characters, straight runs off the
 *      keyboard, all-digit dates, and anything built out of the user's own
 *      email address.
 *
 * Everything here is synchronous and dependency-free so the sign-up form can
 * import it and give the same verdict as the server before a round trip. The
 * fourth check — has this exact password appeared in a breach corpus — needs
 * the network and lives in `app/lib/security/pwned-passwords.ts`; the two are
 * combined server-side by `assertAcceptablePassword()`.
 *
 * Existing accounts are unaffected: nothing validates a password on sign-in,
 * so a user who registered under the 8-character rule keeps working and only
 * meets the new floor if they reset.
 */

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Well above any real passphrase and well below anything that makes scryptSync
 * a denial-of-service tool.
 */
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordRejectionCode =
  | "password_too_short"
  | "password_too_long"
  | "password_common"
  | "password_sequential"
  | "password_repetitive"
  | "password_numeric"
  | "password_personal"
  | "password_breached";

export type PasswordVerdict =
  | { ok: true }
  | { ok: false; code: PasswordRejectionCode };

/**
 * Copy for every rejection, in both languages, so the client can render the
 * server's verdict without a second source of truth. Each one says what to do
 * next rather than only what was wrong.
 */
export const PASSWORD_MESSAGES: Record<PasswordRejectionCode, { en: string; sv: string }> = {
  password_too_short: {
    en: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    sv: `Lösenordet måste vara minst ${PASSWORD_MIN_LENGTH} tecken.`
  },
  password_too_long: {
    en: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    sv: `Lösenordet får vara högst ${PASSWORD_MAX_LENGTH} tecken.`
  },
  password_common: {
    en: "That password is one of the most commonly used ones. Pick something less guessable — a few unrelated words works well.",
    sv: "Det lösenordet är ett av de mest använda. Välj något mindre gissningsbart — några orelaterade ord fungerar bra."
  },
  password_sequential: {
    en: "Avoid straight runs like 1234567890 or qwertyuiop. A few unrelated words works well.",
    sv: "Undvik raka följder som 1234567890 eller qwertyuiop. Några orelaterade ord fungerar bra."
  },
  password_repetitive: {
    en: "That password repeats too few characters. Mix in more variety — a few unrelated words works well.",
    sv: "Lösenordet återanvänder för få tecken. Variera mer — några orelaterade ord fungerar bra."
  },
  password_numeric: {
    en: "A digits-only password is easy to guess. Add letters, or use a longer passphrase.",
    sv: "Ett lösenord med bara siffror är lätt att gissa. Lägg till bokstäver, eller använd en längre fras."
  },
  password_personal: {
    en: "Do not build the password out of your email address or the service name.",
    sv: "Bygg inte lösenordet av din e-postadress eller tjänstens namn."
  },
  password_breached: {
    en: "That password appears in a known data breach, so it is already on attackers' lists. Pick a different one.",
    sv: "Lösenordet förekommer i en känd dataläcka och finns därför redan på angripares listor. Välj ett annat."
  }
};

export function passwordPolicyMessage(code: PasswordRejectionCode, language: "en" | "sv" = "en"): string {
  return PASSWORD_MESSAGES[code][language];
}

/** Thrown by the server-side guard so routes can surface a stable code. */
export class PasswordPolicyError extends Error {
  readonly code: PasswordRejectionCode;

  constructor(code: PasswordRejectionCode) {
    super(passwordPolicyMessage(code, "en"));
    this.name = "PasswordPolicyError";
    this.code = code;
  }
}

/**
 * Base words, letters only — the disguise folding below strips digits and
 * punctuation before comparing, so `password` covers `Password1!`,
 * `password2024` and `p@ssw0rd` without listing each.
 *
 * Drawn from the top of the public breach corpora, plus the Swedish and
 * finance-app words a DISU user is disproportionately likely to reach for.
 * It does not need to be long: the breach range API is the broad net, and this
 * list is what still works when that call fails open.
 */
const COMMON_BASE_WORDS = new Set([
  // Top of every leaked-password list.
  "password", "passwort", "passord", "losenord", "motdepasse", "contrasena",
  "qwerty", "qwertyuiop", "qwertz", "azerty", "asdfgh", "asdfghjkl", "zxcvbnm",
  "letmein", "welcome", "admin", "administrator", "root", "guest", "login",
  "iloveyou", "princess", "sunshine", "shadow", "dragon", "monkey", "master",
  "superman", "batman", "starwars", "pokemon", "michael", "jennifer", "jordan",
  "hunter", "trustno", "freedom", "whatever", "computer", "internet", "secret",
  "hemligt", "changeme", "default", "abcabc", "abcdef", "abcdefg", "abcdefgh",
  "iloveu", "loveyou", "letmeinnow", "welcomeback",
  // Sport and brand words, which read as strong to the person picking them.
  "football", "baseball", "liverpool", "arsenal", "chelsea", "barcelona",
  "realmadrid", "manchester", "juventus", "fotboll", "hockey",
  "samsung", "google", "facebook", "instagram", "spotify", "netflix", "apple",
  // Swedish, since the product ships in Swedish first.
  "sverige", "stockholm", "goteborg", "gothenburg", "malmo", "hejsan", "hejhej",
  "sommar", "vinter", "karlek", "alskardig", "blomma", "kanelbulle", "fika",
  "svenska", "norrland", "skane",
  // Words this product invites.
  "disu", "disuplatform", "portfolio", "portfolj", "aktier", "aktie", "borsen",
  "invest", "investor", "investera", "trading", "trader", "finance", "money",
  "pengar", "stonks", "bitcoin", "avanza", "nordnet"
]);

/** Straight runs, forwards; the check also tries each one reversed. */
const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "qwertzuiop",
  "azertyuiop",
  "1qaz2wsx3edc"
];

function reverse(value: string): string {
  return value.split("").reverse().join("");
}

function foldLeet(value: string): string {
  return value
    .replace(/[@4]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/7/g, "t")
    .replace(/[()]/g, "c")
    .replace(/8/g, "b");
}

function lettersOnly(value: string): string {
  return value.replace(/[^a-z]/g, "");
}

/**
 * The forms a common word can be hiding in. Order matters for the leet ones:
 * a trailing `2024` must be stripped *before* folding, or `passw0rd2024` folds
 * into `passwordoa` and slips past.
 */
function disguiseCandidates(password: string): string[] {
  const lowered = password.toLowerCase();
  const alnum = lowered.replace(/[^a-z0-9]/g, "");
  const trimmedDigits = alnum.replace(/^\d+/, "").replace(/\d+$/, "");

  return [
    lettersOnly(lowered),
    alnum,
    trimmedDigits,
    lettersOnly(foldLeet(lowered)),
    lettersOnly(foldLeet(trimmedDigits))
  ];
}

function looksCommon(password: string): boolean {
  for (const candidate of disguiseCandidates(password)) {
    if (!candidate) {
      continue;
    }
    if (COMMON_BASE_WORDS.has(candidate)) {
      return true;
    }
    // `sunshine` plus one or two throwaway letters is still `sunshine`.
    for (const word of COMMON_BASE_WORDS) {
      if (candidate.length <= word.length + 2 && candidate.startsWith(word)) {
        return true;
      }
    }
  }
  return false;
}

function looksSequential(password: string): boolean {
  const needle = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length < 4) {
    return false;
  }
  return SEQUENCES.some((sequence) => sequence.includes(needle) || reverse(sequence).includes(needle));
}

/**
 * Ten characters drawn from three distinct ones (`abababab12`) has roughly the
 * guessability of a four-character password.
 */
function tooFewDistinctCharacters(password: string): boolean {
  return new Set(password).size < 5;
}

/**
 * The email address is the other half of the credential, so it is public as
 * far as this check is concerned: `anna@example.com` / `annaanna123` is one
 * guess. Only the local part and the domain label are considered, and only when
 * long enough that the match means something.
 */
function derivedFromEmail(password: string, email: string): boolean {
  const haystack = password.toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const [localPart = "", domain = ""] = normalizedEmail.split("@");
  const parts = [localPart, domain.split(".")[0] ?? ""]
    .flatMap((part) => part.split(/[._+-]/))
    .filter((part) => part.length >= 4);

  return parts.some((part) => haystack.includes(part));
}

/**
 * Everything that can be decided without the network. `email` is optional so
 * the reset form — which has a token, not an address — can use the same call.
 */
export function checkPasswordShape(password: string, options: { email?: string } = {}): PasswordVerdict {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, code: "password_too_short" };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, code: "password_too_long" };
  }
  if (tooFewDistinctCharacters(password)) {
    return { ok: false, code: "password_repetitive" };
  }
  if (looksSequential(password)) {
    return { ok: false, code: "password_sequential" };
  }
  // A digits-only secret is a date, a phone number or a personal number. Long
  // digit passphrases are allowed, since at that length the space is real.
  if (/^\d+$/.test(password) && password.length < 14) {
    return { ok: false, code: "password_numeric" };
  }
  if (looksCommon(password)) {
    return { ok: false, code: "password_common" };
  }
  if (options.email && derivedFromEmail(password, options.email)) {
    return { ok: false, code: "password_personal" };
  }
  return { ok: true };
}
