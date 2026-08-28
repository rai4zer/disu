/**
 * Rate-limit policy for the unauthenticated auth routes.
 *
 * Framework-free on purpose (see rate-limit.ts): routes bring their own
 * `NextResponse`, this module only decides. Every limit is applied twice —
 * once per client IP, once per subject (the email being targeted) — because
 * either dimension alone is trivially defeated:
 *
 *   - IP-only  → one attacker, one address, many accounts (credential stuffing)
 *   - email-only → many addresses, one account (distributed password spray)
 *
 * The subject bucket is cleared on a successful login, so a user who mistypes
 * their password four times is not still throttled once they get it right, and
 * a legitimate sign-in never spends another user's budget.
 */

import { clearRateLimit, consumeRateLimit, type RateLimitPolicy } from "@/app/lib/security/rate-limit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type AuthRateLimitRoute = "login" | "register" | "forgot-password" | "reset-password";

type RoutePolicy = {
  /** Applied to every request from one client address. */
  ip: RateLimitPolicy;
  /** Applied per email address, when the request carries one. */
  subject?: RateLimitPolicy;
};

/**
 * Numbers are set so a confused human never notices and a script always does.
 * Register and the password-reset pair are hourly because they cost real money
 * (row inserts, outbound email) and no human needs a second attempt within
 * minutes.
 */
const POLICIES: Record<AuthRateLimitRoute, RoutePolicy> = {
  login: {
    ip: { limit: 30, windowMs: 15 * MINUTE },
    subject: { limit: 10, windowMs: 15 * MINUTE }
  },
  register: {
    ip: { limit: 10, windowMs: HOUR },
    subject: { limit: 3, windowMs: HOUR }
  },
  "forgot-password": {
    ip: { limit: 15, windowMs: HOUR },
    subject: { limit: 5, windowMs: HOUR }
  },
  "reset-password": {
    // Keyed on IP only: the caller presents a token, not an email, and the
    // token is single-use. This bounds brute-forcing the token itself.
    ip: { limit: 20, windowMs: HOUR }
  }
};

export type AuthRateLimitVerdict = {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Which bucket ran out. `null` when allowed. */
  scope: "ip" | "subject" | null;
};

const ALLOWED: AuthRateLimitVerdict = { allowed: true, retryAfterSeconds: 0, scope: null };

function normalizeSubject(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function ipKey(route: AuthRateLimitRoute, ip: string): string {
  return `auth:${route}:${ip}`;
}

function subjectKey(route: AuthRateLimitRoute, subject: string): string {
  return `auth:${route}:email:${subject}`;
}

/**
 * Records an attempt and reports whether it may proceed.
 *
 * The IP bucket is consumed first. If it is exhausted the subject bucket is
 * left untouched — otherwise an attacker who has already burned their own IP
 * budget could keep burning a victim's, locking them out for free.
 */
export function checkAuthRateLimit(input: {
  route: AuthRateLimitRoute;
  ip: string;
  email?: string | null;
  now?: number;
}): AuthRateLimitVerdict {
  const policy = POLICIES[input.route];
  const now = input.now ?? Date.now();

  const ipVerdict = consumeRateLimit(ipKey(input.route, input.ip), policy.ip, now);
  if (!ipVerdict.allowed) {
    return { allowed: false, retryAfterSeconds: ipVerdict.retryAfterSeconds, scope: "ip" };
  }

  const subject = normalizeSubject(input.email);
  if (!policy.subject || !subject) {
    return ALLOWED;
  }

  const subjectVerdict = consumeRateLimit(subjectKey(input.route, subject), policy.subject, now);
  if (!subjectVerdict.allowed) {
    return { allowed: false, retryAfterSeconds: subjectVerdict.retryAfterSeconds, scope: "subject" };
  }

  return ALLOWED;
}

/** Called after a successful sign-in to release the subject bucket. */
export function clearAuthRateLimitForSubject(route: AuthRateLimitRoute, email: string): void {
  const subject = normalizeSubject(email);
  if (subject) {
    clearRateLimit(subjectKey(route, subject));
  }
}
