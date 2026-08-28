/**
 * Breached-password check against the Pwned Passwords range API (§2.3).
 *
 * The plaintext never leaves the process and the full hash never leaves it
 * either. We SHA-1 the candidate, send the **first five hex characters** of
 * that hash, and get back every suffix sharing that prefix — roughly 800 of
 * them — then look for ours locally. The service therefore learns a bucket
 * that a billion-odd passwords fall into, and nothing else. That is the
 * k-anonymity property; it is why this check is acceptable to run on a
 * password a user is in the middle of choosing. `Add-Padding` makes every
 * response the same size band so the count of returned lines cannot be read
 * off the wire either.
 *
 * SHA-1 is not a security choice here — it is the corpus's index. The stored
 * verifier is still scrypt (`app/lib/auth/users.ts`).
 *
 * Fail-open, deliberately. If the API is down, a slow signup that ends in
 * "try again later" is a worse outcome than a password that the local
 * blocklist already screened. Every fail-open is logged so the rate is
 * visible rather than assumed to be zero.
 */

import { createHash } from "node:crypto";
import { log } from "@/app/lib/observability/log";

const RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range";
const DEFAULT_TIMEOUT_MS = 2500;

/**
 * How many appearances in the corpus we treat as disqualifying. One is the
 * right answer for a password being chosen now: a single appearance means it
 * is in a wordlist somewhere.
 */
const BREACH_THRESHOLD = 1;

export type BreachCheckResult = {
  /** False when the lookup did not happen (disabled, or the call failed). */
  checked: boolean;
  breached: boolean;
  /** Appearances in the corpus; 0 when `checked` is false. */
  count: number;
};

type BreachCheckOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Off in tests (no unit test should reach the network) and switchable off in
 * any environment that cannot make outbound calls. Anything other than an
 * explicit off value leaves it on — the safe default is checking.
 */
export function breachCheckEnabled(): boolean {
  const flag = (process.env.PASSWORD_BREACH_CHECK ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") {
    return false;
  }
  if (flag === "on" || flag === "true" || flag === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "test";
}

function sha1Upper(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
}

/**
 * Counts appearances of `password` in the corpus. Returns `checked: false`
 * rather than throwing when the range API is unreachable.
 */
export async function pwnedPasswordCount(
  password: string,
  options: BreachCheckOptions = {}
): Promise<BreachCheckResult> {
  const digest = sha1Upper(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await doFetch(`${RANGE_ENDPOINT}/${prefix}`, {
      headers: {
        // Padded responses include decoy suffixes with a count of 0, which the
        // parse below drops.
        "Add-Padding": "true",
        "User-Agent": "disu-platform"
      },
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      log.warn("auth.password_breach_check.unavailable", { status: response.status });
      return { checked: false, breached: false, count: 0 };
    }

    const body = await response.text();
    for (const line of body.split("\n")) {
      const separator = line.indexOf(":");
      if (separator < 0) {
        continue;
      }
      if (line.slice(0, separator).trim().toUpperCase() !== suffix) {
        continue;
      }
      const count = Number.parseInt(line.slice(separator + 1).trim(), 10);
      if (!Number.isFinite(count) || count <= 0) {
        // A padding decoy: present in the response, absent from the corpus.
        return { checked: true, breached: false, count: 0 };
      }
      return { checked: true, breached: count >= BREACH_THRESHOLD, count };
    }

    return { checked: true, breached: false, count: 0 };
  } catch (error) {
    log.warn("auth.password_breach_check.failed", {
      reason: error instanceof Error ? error.message : String(error)
    });
    return { checked: false, breached: false, count: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

/** `pwnedPasswordCount` plus the env gate. */
export async function isPasswordBreached(
  password: string,
  options: BreachCheckOptions = {}
): Promise<BreachCheckResult> {
  if (!breachCheckEnabled()) {
    return { checked: false, breached: false, count: 0 };
  }
  return pwnedPasswordCount(password, options);
}
