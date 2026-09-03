"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LogoutButton from "@/app/components/logout-button";
import LanguageToggle from "@/app/components/language-toggle";
import { useLanguage, type AppLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./market-strip.module.css";

type MarketItem = {
  label: string;
  fullName: string;
  price: string;
  value: string;
  time: string;
};

/**
 * What the strip is allowed to claim about the numbers beside it.
 *
 * The route already publishes `stale`, `source` and `asOf`; until now the strip
 * read none of them and rendered every level with no provenance at all. That is
 * the bug docs/synthetic-data-policy.md names in rule 3 — the flag has to survive
 * every hop, and the component has to change what it renders.
 *
 * `stale` on its own is not the signal, because the route uses it for two
 * different things. On a successful publish it means *some* index came back
 * empty; those cells already render "--", so every number actually on screen is
 * still current. It is `source === "fallback"` that means the whole payload is
 * last-known values retained from an earlier fetch, and only that deserves a
 * different label.
 */
type Provenance =
  | { kind: "pending" }
  | { kind: "indicative" }
  | { kind: "lastKnown"; asOf: string };

type IndicesResponse = {
  ok?: boolean;
  items?: MarketItem[];
  stale?: boolean;
  asOf?: string;
  source?: string;
};

function formatAsOf(iso: string, language: AppLanguage): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(language === "sv" ? "sv-SE" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Pre-fetch state: dashes everywhere, so nothing on screen claims a reading we
// do not have yet.
const PLACEHOLDER_ITEMS: MarketItem[] = [
  { label: "S&P 500", fullName: "S&P 500", price: "--", value: "--", time: "--:--" },
  { label: "Nasdaq", fullName: "Nasdaq Composite", price: "--", value: "--", time: "--:--" },
  { label: "Dow Jones", fullName: "Dow Jones Industrial Average (DJI)", price: "--", value: "--", time: "--:--" },
  { label: "OMXS30", fullName: "OMX Stockholm 30 (OMXS30)", price: "--", value: "--", time: "--:--" },
  { label: "Nikkei 225", fullName: "Nikkei 225", price: "--", value: "--", time: "--:--" },
  { label: "FTSE 100", fullName: "FTSE 100", price: "--", value: "--", time: "--:--" },
  { label: "DAX", fullName: "DAX (Germany 40)", price: "--", value: "--", time: "--:--" },
  { label: "SSEC", fullName: "Shanghai SE Composite (SSEC)", price: "--", value: "--", time: "--:--" },
  { label: "Hang Seng", fullName: "Hang Seng Index (HSI)", price: "--", value: "--", time: "--:--" }
];

// How often to re-poll the indices endpoint while the strip is mounted.
const REFRESH_INTERVAL_MS = 60_000;

// Fallback if --market-scroll-duration is missing or unparseable.
const FALLBACK_DURATION_S = 60;
// Wheel delta (px) -> extra scroll velocity (px/s).
const WHEEL_GAIN = 4;
// Ceiling on the nudge, so a hard flick stays readable.
const MAX_NUDGE_SPEED = 900;
// Wheel events set a target; the applied speed eases toward it over this many
// seconds, so a burst of deltas ramps up instead of snapping.
const NUDGE_ATTACK_S = 0.28;
// How long the target takes to bleed away once the wheel stops: a long glide
// back to the ambient drift rather than an abrupt halt.
const NUDGE_DECAY_S = 0.9;
// Below this the nudge is spent; treat it as zero so the loop can idle.
const NUDGE_EPSILON = 1;

type Props = {
  action?: "signout" | "signin";
  withSidebarOffset?: boolean;
};

export default function MarketStrip({ action = "signout", withSidebarOffset = false }: Props) {
  const { language } = useLanguage();
  const copy = getUiCopy(language);
  const [items, setItems] = useState<MarketItem[]>(PLACEHOLDER_ITEMS);
  // Starts at "pending" on purpose: before the first response the strip is all
  // dashes, and a badge vouching for dashes would be worse than no badge.
  const [provenance, setProvenance] = useState<Provenance>({ kind: "pending" });
  const lastGoodAsOf = useRef("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;

    // A fetch that never arrives leaves real numbers on screen with no way for
    // the reader to know they have stopped moving, so a failure downgrades the
    // badge even though it deliberately leaves the values alone.
    const degrade = () => {
      if (!alive) return;
      setProvenance((current) =>
        current.kind === "pending" ? current : { kind: "lastKnown", asOf: lastGoodAsOf.current }
      );
    };

    const load = async () => {
      try {
        const res = await fetch("/api/market/indices", { cache: "no-store" });
        if (!res.ok) {
          degrade();
          return;
        }
        const data = (await res.json()) as IndicesResponse;
        if (!alive || !data.ok || !Array.isArray(data.items) || data.items.length === 0) {
          degrade();
          return;
        }
        setItems(data.items);
        if (data.source === "fallback") {
          setProvenance({ kind: "lastKnown", asOf: data.asOf ?? lastGoodAsOf.current });
        } else {
          if (data.asOf) lastGoodAsOf.current = data.asOf;
          setProvenance({ kind: "indicative" });
        }
      } catch {
        // Keep the last known items on screen, but stop calling them current.
        degrade();
      }
    };

    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // The marquee runs in JS rather than as a CSS animation so a horizontal wheel
  // over the strip can push it along (or backwards) while the hover pause holds
  // the automatic drift.
  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // The track is two identical passes, so one pass wide is the loop length.
    let passWidth = 0;
    let durationS = FALLBACK_DURATION_S;

    const measure = () => {
      passWidth = track.getBoundingClientRect().width / 2;
      const raw = getComputedStyle(viewport).getPropertyValue("--market-scroll-duration").trim();
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        durationS = raw.endsWith("ms") ? parsed / 1000 : parsed;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);

    let offset = 0;
    // nudgeTarget is what the wheel writes to; nudge is the smoothed speed actually applied.
    let nudgeTarget = 0;
    let nudge = 0;
    let hovered = false;
    let raf = 0;
    let last = 0;

    const driftSpeed = () => (passWidth > 0 && !hovered && !reduceMotion.matches ? passWidth / durationS : 0);

    const frame = (now: number) => {
      // Clamp dt so a backgrounded tab does not resume with a huge jump.
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;

      offset += (driftSpeed() + nudge) * dt;
      nudgeTarget *= Math.exp(-dt / NUDGE_DECAY_S);
      nudge += (nudgeTarget - nudge) * (1 - Math.exp(-dt / NUDGE_ATTACK_S));
      if (Math.abs(nudgeTarget) < NUDGE_EPSILON && Math.abs(nudge) < NUDGE_EPSILON) {
        nudgeTarget = 0;
        nudge = 0;
      }
      if (passWidth > 0) offset = ((offset % passWidth) + passWidth) % passWidth;
      track.style.transform = `translate3d(${-offset}px, 0, 0)`;

      if (driftSpeed() === 0 && nudge === 0 && nudgeTarget === 0) {
        raf = 0;
        last = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const onWheel = (event: WheelEvent) => {
      // Only claim horizontal intent: plain vertical wheeling still scrolls the page.
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (raw === 0) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      const next = nudgeTarget + raw * scale * WHEEL_GAIN;
      nudgeTarget = Math.max(-MAX_NUDGE_SPEED, Math.min(MAX_NUDGE_SPEED, next));
      start();
    };

    const onEnter = () => {
      hovered = true;
    };

    const onLeave = () => {
      hovered = false;
      start();
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerenter", onEnter);
    viewport.addEventListener("pointerleave", onLeave);
    reduceMotion.addEventListener("change", start);
    start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerenter", onEnter);
      viewport.removeEventListener("pointerleave", onLeave);
      reduceMotion.removeEventListener("change", start);
    };
  }, []);

  // Composed here rather than in the copy file so the timestamp is formatted in
  // the reader's language without inventing a placeholder syntax for one string.
  const asOfText = provenance.kind === "lastKnown" ? formatAsOf(provenance.asOf, language) : "";
  const provenanceLabel =
    provenance.kind === "lastKnown"
      ? asOfText
        ? `${copy.market.lastKnown} ${asOfText}`
        : copy.market.lastKnown
      : copy.market.indicative;
  const provenanceNote =
    provenance.kind === "lastKnown"
      ? asOfText
        ? `${copy.market.lastKnownNote} ${asOfText}.`
        : copy.market.indicativeNote
      : copy.market.indicativeNote;

  return (
    <div className={styles.strip} role="status" aria-label={copy.market.ariaLabel}>
      <div className={withSidebarOffset ? `${styles.inner} ${styles.innerWithSidebar}` : styles.inner}>
        <div className={styles.rail}>
          {provenance.kind === "pending" ? null : (
            <span
              className={
                provenance.kind === "lastKnown"
                  ? `${styles.provenance} ${styles.provenanceStale}`
                  : styles.provenance
              }
              title={provenanceNote}
              aria-label={`${provenanceLabel}. ${provenanceNote}`}
            >
              {provenanceLabel}
            </span>
          )}
          <div className={styles.tickers} ref={viewportRef}>
            {/* Two identical passes so the right-to-left scroll loops seamlessly. */}
            <div className={styles.track} ref={trackRef}>
              {[0, 1].map((pass) =>
                items.map((item) => {
                  const positive = item.value.startsWith("+");
                  const negative = item.value.startsWith("-");
                  return (
                    <p
                      key={`${pass}-${item.label}`}
                      className={styles.item}
                      aria-hidden={pass === 1 ? true : undefined}
                    >
                      <span className={styles.name} title={item.fullName}>
                        {item.label}
                      </span>
                      <span className={styles.price}>{item.price}</span>
                      <span className={positive ? styles.up : negative ? styles.down : styles.flat}>{item.value}</span>
                      <span className={styles.time}>{item.time}</span>
                    </p>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className={styles.controls}>
          {action === "signin" ? (
            /* Signed out, the strip is the only chrome there is, so the
               language toggle stays here. Signed in it lives in My Profile
               instead — the top bar carries no preferences. */
            <>
              <LanguageToggle />
              <Link href="/auth/login" className={styles.signOut}>
                {copy.market.signIn}
              </Link>
            </>
          ) : (
            /* Account used to sit here as a link, because it had no module of
               its own to be found in. It is now "My Profile" in the sidebar
               rail, so the strip keeps only sign-out — the one control that
               belongs to the chrome rather than to a page. */
            <LogoutButton className={styles.signOut} />
          )}
        </div>
      </div>
    </div>
  );
}
