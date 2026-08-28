/**
 * In-memory sliding-window rate limiter.
 *
 * Deliberately dependency-free: no Supabase round-trip on the hot path of an
 * unauthenticated route, and no import of `@/…` so it stays unit-testable under
 * `node --experimental-strip-types --test`.
 *
 * **Single-process only.** Counters live in this module's closure, so N app
 * instances give an attacker N× the budget. That is acceptable while DISU runs
 * as one long-lived Node process (ROADMAP D1, option A) and is the same
 * assumption the job queue already makes. Moving to multiple instances means
 * swapping `consume()` for a shared store (Postgres, Redis) — the call sites do
 * not change, only this file does.
 */

export type RateLimitPolicy = {
  /** Maximum number of hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitVerdict = {
  allowed: boolean;
  /** Hits still available in the current window (0 once blocked). */
  remaining: number;
  /** Whole seconds until the oldest hit falls out of the window. >= 1 when blocked. */
  retryAfterSeconds: number;
};

/**
 * Cap on distinct keys held at once. An attacker rotating IPs would otherwise
 * grow this map without bound. When the cap is hit we drop the least-recently
 * touched keys — which resets their counters, so the cap must stay well above
 * plausible legitimate concurrency.
 */
const MAX_TRACKED_KEYS = 50_000;

/** Insertion order is touch order: we re-insert on every access. */
const hits = new Map<string, number[]>();

function touch(key: string, timestamps: number[]): void {
  hits.delete(key);
  hits.set(key, timestamps);
}

function evictIfOversized(): void {
  if (hits.size <= MAX_TRACKED_KEYS) {
    return;
  }
  const overflow = hits.size - MAX_TRACKED_KEYS;
  let removed = 0;
  for (const key of hits.keys()) {
    hits.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

/**
 * Records a hit against `key` and reports whether it is allowed.
 *
 * A blocked hit is *not* recorded, so a caller that keeps hammering does not
 * extend its own penalty indefinitely — the window drains on schedule.
 */
export function consumeRateLimit(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitVerdict {
  const windowStart = now - policy.windowMs;
  const previous = hits.get(key) ?? [];
  const timestamps = previous.filter((at) => at > windowStart);

  if (timestamps.length >= policy.limit) {
    touch(key, timestamps);
    const oldest = timestamps[0];
    const retryAfterMs = Math.max(1, oldest + policy.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  timestamps.push(now);
  touch(key, timestamps);
  evictIfOversized();

  return {
    allowed: true,
    remaining: policy.limit - timestamps.length,
    retryAfterSeconds: 0
  };
}

/**
 * Forgets every hit recorded against `key`. Used after a successful login so a
 * user who fat-fingered their password four times is not still throttled once
 * they get it right.
 */
export function clearRateLimit(key: string): void {
  hits.delete(key);
}

/** Test seam. Not exported through any route. */
export function resetRateLimitsForTests(): void {
  hits.clear();
}

/** Test seam: how many distinct keys are currently tracked. */
export function trackedRateLimitKeyCountForTests(): number {
  return hits.size;
}
