"use client";

/**
 * Holds the visitor's consent decision and hands it to everything that needs to
 * ask permission.
 *
 * The record lives in a cookie rather than localStorage because the server has
 * to be able to read it too — a page that renders a tag server-side must know
 * the answer before it renders, not after hydration. It is deliberately not
 * `httpOnly`: client code is the thing gating the tags, so it must be able to
 * read it. That is safe here because the record is a preference, not a
 * credential — the worst an attacker can do by forging it is show themselves
 * adverts.
 *
 * Withdrawal actually deletes cookies (`app/lib/legal/tags.ts`) and DISU's own
 * analytics storage (`app/lib/analytics/anon-id.ts`). Turning a toggle off and
 * leaving `_fbp` sitting in the jar until it expires in ninety days is not
 * withdrawal, whatever the banner says.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  CONSENT_COOKIE_NAME,
  CONSENT_MAX_AGE_DAYS,
  acceptAll,
  hasConsent,
  makeRecord,
  parseConsent,
  rejectAll,
  serialiseConsent,
  type ConsentCategory,
  type ConsentChoices,
  type ConsentRecord
} from "@/app/lib/legal/consent.ts";
import { TAGS } from "@/app/lib/legal/tags.ts";
import { clearAnonId } from "@/app/lib/analytics/anon-id";

type ConsentContextValue = {
  /** null until the cookie has been read, and whenever there is no valid record. */
  record: ConsentRecord | null;
  /** True once the first read has happened. Nothing should render a decision before this. */
  ready: boolean;
  /** Whether the banner should be on screen. */
  needsDecision: boolean;
  allows: (category: ConsentCategory) => boolean;
  save: (choices: ConsentChoices) => void;
  acceptEverything: () => void;
  rejectEverything: () => void;
  /** Opens the preference centre from anywhere (the footer link, the cookie page). */
  openPreferences: () => void;
  closePreferences: () => void;
  preferencesOpen: boolean;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function writeCookie(name: string, value: string, maxAgeDays: number) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${Math.floor(maxAgeDays * 24 * 60 * 60)}; SameSite=Lax${secure}`;
}

function deleteCookie(name: string) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  // Vendor scripts often scope to the registrable domain rather than the exact
  // host, and a cookie set on `.disu.se` is not removed by deleting it on
  // `www.disu.se`. Both are attempted; the wrong one is a no-op.
  const host = typeof location !== "undefined" ? location.hostname : "";
  const parts = host.split(".");
  if (parts.length > 2) {
    const registrable = parts.slice(-2).join(".");
    document.cookie = `${name}=; Path=/; Domain=.${registrable}; Max-Age=0; SameSite=Lax${secure}`;
  }
}

/**
 * Removes the cookies belonging to categories the visitor has just turned off.
 * Best effort by nature: a cookie set on the vendor's own domain is not ours to
 * delete, which is why `tags.ts` records which ones those are and the preference
 * centre says so rather than implying a clean sweep.
 */
function clearWithdrawnCookies(previous: ConsentChoices | null, next: ConsentChoices) {
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.cookie.split("; ").map((entry) => entry.split("=")[0]);

  for (const tag of TAGS) {
    const wasAllowed = previous ? previous[tag.category] : false;
    if (!wasAllowed || next[tag.category]) {
      continue;
    }
    for (const cookie of tag.cookies) {
      if (!cookie.firstParty) {
        continue;
      }
      if (cookie.prefix) {
        for (const name of existing) {
          if (name.startsWith(cookie.name)) {
            deleteCookie(name);
          }
        }
      } else if (existing.includes(cookie.name)) {
        deleteCookie(cookie.name);
      }
    }
  }
}

/**
 * Removes DISU's own analytics storage on withdrawal.
 *
 * `clearWithdrawnCookies()` above walks the vendor tag register, which by
 * construction knows nothing about the first-party funnel id — it is not a
 * vendor and not a cookie. It still has to go, and for the same reason: leaving
 * the identifier in place while claiming the tracking stopped is the failure
 * Art. 7(3) is about. Nothing rebuilds it until consent is given again
 * (`app/lib/analytics/track.ts`).
 */
function clearWithdrawnFirstPartyStorage(previous: ConsentChoices | null, next: ConsentChoices) {
  const wasAllowed = previous ? previous.analytics : false;
  if (wasAllowed && !next.analytics) {
    clearAnonId();
  }
}

export default function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  // The current record, readable synchronously. `save()` needs to know what was
  // previously allowed *before* it schedules a re-render, and a state variable
  // read inside a setState updater is the wrong tool: React may call the updater
  // late or twice, so the cookie deletion would race the reload ConsentTags
  // fires on revocation — which is exactly how a withdrawn cookie survives.
  const recordRef = useRef<ConsentRecord | null>(null);

  useEffect(() => {
    const stored = parseConsent(readCookie(CONSENT_COOKIE_NAME));
    recordRef.current = stored;
    setRecord(stored);
    setReady(true);
  }, []);

  const save = useCallback((choices: ConsentChoices) => {
    // Timestamped at the moment of the click, because that timestamp is the
    // evidence of when consent was given (Art. 7(1)).
    const next = makeRecord(choices, new Date().toISOString());

    // Order matters and is load-bearing. Delete first, synchronously, so the
    // cookies are gone before anything can re-render or reload.
    clearWithdrawnCookies(recordRef.current?.choices ?? null, next.choices);
    clearWithdrawnFirstPartyStorage(recordRef.current?.choices ?? null, next.choices);
    writeCookie(CONSENT_COOKIE_NAME, serialiseConsent(next), CONSENT_MAX_AGE_DAYS);

    recordRef.current = next;
    setRecord(next);
    setPreferencesOpen(false);
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      record,
      ready,
      needsDecision: ready && record === null,
      allows: (category: ConsentCategory) => hasConsent(record, category),
      save,
      acceptEverything: () => save(acceptAll()),
      rejectEverything: () => save(rejectAll()),
      openPreferences: () => setPreferencesOpen(true),
      closePreferences: () => setPreferencesOpen(false),
      preferencesOpen
    }),
    [record, ready, preferencesOpen, save]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    // Failing loudly beats silently reporting "no consent" or, far worse,
    // silently reporting consent because a provider was forgotten.
    throw new Error("useConsent must be used inside ConsentProvider");
  }
  return context;
}
