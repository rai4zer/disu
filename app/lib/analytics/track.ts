"use client";

/**
 * Posting funnel events from the browser.
 *
 * Three things are true of every call here and none of them are optional:
 *
 *  1. **Nothing fires before the consent cookie has been read.** `ready` is false
 *     until then, and firing on `false` would be firing on "not yet known",
 *     which is the bug that turns a consent gate into decoration.
 *  2. **Nothing fires without analytics consent** — no request, no anonymous id
 *     created. The server checks again; this check is what stops the id being
 *     written to `sessionStorage` in the first place.
 *  3. **`sendBeacon` where it exists.** A `landing_view` immediately followed by
 *     a click to `/auth/login` is the single most important event in the funnel
 *     and also the one most likely to be cancelled by the navigation. A beacon
 *     survives it; a plain `fetch` does not.
 *
 * `useFunnelEvent()` is the whole client API: it fires once, and it fires late if
 * consent arrives after the page did — someone who accepts on the banner has
 * still seen the landing page, and the event is theirs from the moment they say
 * yes (not retroactively: it is timestamped when it is sent).
 */

import { useEffect, useRef } from "react";
import { useConsent } from "@/app/components/consent-provider";
import { ensureAnonId } from "@/app/lib/analytics/anon-id";
import { type FunnelEventName, type FunnelProperties } from "@/app/lib/analytics/funnel";

const ENDPOINT = "/api/analytics/events";

type ClientFunnelEvent = {
  name: FunnelEventName;
  path: string | null;
  properties: FunnelProperties;
};

function send(anonId: string, events: ClientFunnelEvent[]): void {
  const payload = JSON.stringify({ anonId, events });

  try {
    // `sendBeacon` is fire-and-forget and survives the page being torn down. The
    // blob type is text/plain because a beacon cannot set headers and anything
    // else would make this a CORS-preflighted request.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const queued = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "text/plain" }));
      if (queued) {
        return;
      }
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      cache: "no-store"
    }).catch(() => {});
  } catch {
    /* Measurement never breaks the page it is measuring. */
  }
}

function currentPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  // Only the pathname leaves the browser. The server normalises it again — the
  // query string can carry a reset token or an OAuth code and must not be sent.
  return window.location.pathname;
}

type FunnelEventOptions = {
  /**
   * Hold the event until this is true — for a step that becomes true partway
   * through a page's life, like the sign-up form being switched on.
   */
  when?: boolean;
  /**
   * Resets the once-only guard when it changes, so the event can fire again on a
   * genuinely new occurrence of the same step (switching away from the sign-up
   * form and back is a second `signup_start`; a re-render is not).
   */
  resetKey?: string | number;
};

/**
 * Fires `name` once, as soon as analytics consent is known and granted.
 *
 * The ordering here is the part that matters. Consent can arrive *after* the page
 * did — someone reads the banner and then accepts — and the event has to fire at
 * that point, not be lost because the mount already happened. Equally, the step
 * itself can become true later (`when`). So the effect waits on both and fires on
 * whichever completes the pair, which is why the guard is a ref rather than a
 * dependency list: it must survive re-renders without suppressing the late fire.
 *
 * `properties` is read on the firing render only and is deliberately not a
 * dependency, so an inline object literal cannot cause a second event.
 */
export function useFunnelEvent(
  name: FunnelEventName,
  properties: FunnelProperties = {},
  options: FunnelEventOptions = {}
): void {
  const { ready, allows } = useConsent();
  const allowed = ready && allows("analytics");
  const when = options.when ?? true;
  const resetKey = options.resetKey ?? name;

  const sentFor = useRef<string | number | null>(null);
  const latestProperties = useRef(properties);
  latestProperties.current = properties;

  useEffect(() => {
    if (!allowed || !when || sentFor.current === resetKey) {
      return;
    }
    const anonId = ensureAnonId();
    if (!anonId) {
      // Storage is blocked, so nothing can be joined into a funnel anyway.
      return;
    }
    sentFor.current = resetKey;
    send(anonId, [{ name, path: currentPath(), properties: latestProperties.current }]);
  }, [allowed, when, resetKey, name]);
}

/**
 * The same, for an event that fires on an interaction rather than on mount.
 *
 * Returns a no-op until consent is known and granted, so call sites never have
 * to ask — `track("signup_start", { method: "password" })` is either recorded or
 * it is not, and the component reads the same either way.
 */
export function useFunnelTracker(): (name: FunnelEventName, properties?: FunnelProperties) => void {
  const { ready, allows } = useConsent();
  const allowed = ready && allows("analytics");

  return (name: FunnelEventName, properties: FunnelProperties = {}) => {
    if (!allowed) {
      return;
    }
    const anonId = ensureAnonId();
    if (!anonId) {
      return;
    }
    send(anonId, [{ name, path: currentPath(), properties }]);
  };
}
