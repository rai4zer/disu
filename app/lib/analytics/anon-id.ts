/**
 * The anonymous visitor id, and why it lives in `sessionStorage`.
 *
 * A funnel needs to know that the `landing_view` and the `signup_start` that
 * followed it were the same person, or the drop-off between them is
 * uncomputable. That requires an identifier on the device, which is exactly what
 * ePrivacy Art. 5(3) governs — so this is written only after analytics consent,
 * and removed the moment it is withdrawn (`app/components/consent-provider.tsx`).
 *
 * `sessionStorage` rather than a cookie or `localStorage`, on purpose:
 *
 *  - It is never sent on any other request, so it cannot become a tracking
 *    cookie by accident, and it costs nothing on every asset fetch.
 *  - It dies with the tab. That is enough to link the steps of one visit, which
 *    is what a funnel measures, and it deliberately cannot follow someone across
 *    visits or weeks — a capability the funnel does not need and would have to be
 *    justified separately.
 *
 * Every access is wrapped: `sessionStorage` throws outright in Safari's private
 * mode and wherever site data is blocked, and a funnel is never worth breaking
 * a page over.
 */

import { isAnonId } from "@/app/lib/analytics/funnel";

/** Declared in `app/lib/legal/cookies.ts` under the `analytics` category. */
export const ANON_ID_STORAGE_KEY = "disu_anon_id";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readAnonId(): string | null {
  try {
    const value = storage()?.getItem(ANON_ID_STORAGE_KEY) ?? null;
    return isAnonId(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The id for this visit, creating one if needed.
 *
 * Callers must have checked consent first — this function does not, because it
 * has no way to, and a storage helper that silently decides a legal question is
 * worse than one that is honest about being dumb. The only caller is
 * `app/lib/analytics/track.ts`, which gates on `allows("analytics")`.
 */
export function ensureAnonId(): string | null {
  const existing = readAnonId();
  if (existing) {
    return existing;
  }

  const store = storage();
  if (!store) {
    return null;
  }

  try {
    const created = crypto.randomUUID();
    store.setItem(ANON_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** Called on withdrawal. Failing quietly is fine; the value is not a credential. */
export function clearAnonId(): void {
  try {
    storage()?.removeItem(ANON_ID_STORAGE_KEY);
  } catch {
    /* nothing to do — the tab is refusing storage, so there is nothing stored */
  }
}
