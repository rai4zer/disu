"use client";

/**
 * The consent gate: the first-visit banner, and the preference centre it opens.
 *
 * The banner does not block the page. Nothing in the law requires it to, and a
 * wall in front of the first screen is the most expensive thing you can put
 * between a visitor and the product (ROADMAP §9.5 targets under 60 seconds to
 * first value). It stays until a choice is made, and no optional tag fires in
 * the meantime — which is the part that actually matters.
 *
 * Accept and Reject are rendered by the same element with the same class and the
 * same word count. That symmetry is not decoration: a prominent "Accept all"
 * beside a muted "Manage" link is the specific pattern regulators treat as
 * invalid consent, so if a later redesign makes one of these louder than the
 * other, the consent collected stops being consent. `tests/consent.test.ts`
 * asserts the symmetry so a redesign has to notice.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/app/i18n/language";
import { useConsent } from "./consent-provider";
import { OPTIONAL_CATEGORIES, type ConsentCategory, type ConsentChoices } from "@/app/lib/legal/consent.ts";
import { TAGS } from "@/app/lib/legal/tags.ts";
import styles from "./consent-banner.module.css";

const CATEGORY_COPY: Record<Exclude<ConsentCategory, "necessary">, { en: string; sv: string }> = {
  preference: { en: "Preferences", sv: "Inställningar" },
  analytics: { en: "Analytics", sv: "Analys" },
  marketing: { en: "Advertising", sv: "Annonsering" }
};

const CATEGORY_DESCRIPTION: Record<Exclude<ConsentCategory, "necessary">, { en: string; sv: string }> = {
  preference: {
    en: "Remembers your language and where you were in each module.",
    sv: "Kommer ihåg ditt språk och var du var i varje modul."
  },
  analytics: {
    en: "Lets us see which pages people use and where they get stuck, so we can fix it.",
    sv: "Låter oss se vilka sidor människor använder och var de fastnar, så att vi kan åtgärda det."
  },
  marketing: {
    en: "Lets advertising platforms know you visited, so campaigns can be measured and DISU adverts can be shown to you on other sites.",
    sv: "Låter annonsplattformar veta att du besökt oss, så att kampanjer kan mätas och DISU-annonser kan visas för dig på andra sajter."
  }
};

function vendorsFor(category: ConsentCategory): string[] {
  return TAGS.filter((tag) => tag.category === category).map((tag) => tag.vendor);
}

export default function ConsentBanner() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const {
    needsDecision,
    preferencesOpen,
    acceptEverything,
    rejectEverything,
    save,
    openPreferences,
    closePreferences,
    record
  } = useConsent();

  if (preferencesOpen) {
    return (
      <PreferenceCentre
        isSv={isSv}
        initial={record?.choices ?? null}
        onSave={save}
        onAcceptAll={acceptEverything}
        onRejectAll={rejectEverything}
        onClose={closePreferences}
      />
    );
  }

  if (!needsDecision) {
    return null;
  }

  return (
    <aside className={styles.banner} aria-label={isSv ? "Cookie-val" : "Cookie choices"}>
      {/* Advertising is named here rather than folded into "your experience".
          Consent only covers purposes the person was actually told about, so a
          euphemism on the face of the banner would invalidate the record that
          the Accept button beside it creates. */}
      <p className={styles.text}>
        {isSv
          ? "Vi använder cookies för analys, annonsering och din upplevelse."
          : "We use cookies for analytics, advertising and your experience."}
      </p>

      {/* Peers, on purpose. Same element, same class, same weight. */}
      <div className={styles.actions}>
        <button type="button" className={styles.choice} onClick={acceptEverything}>
          {isSv ? "Godkänn" : "Accept"}
        </button>
        <button type="button" className={styles.choice} onClick={rejectEverything}>
          {isSv ? "Neka" : "Reject"}
        </button>
      </div>

      {/* The route to per-category choice and to the full list. Kept as the one
          link on the banner so the row stays a single line; the preference
          centre it opens carries the link to /legal/cookies. */}
      <button type="button" className={styles.customise} onClick={openPreferences}>
        {isSv ? "Välj själv" : "Choose"}
      </button>
    </aside>
  );
}

function PreferenceCentre({
  isSv,
  initial,
  onSave,
  onAcceptAll,
  onRejectAll,
  onClose
}: {
  isSv: boolean;
  initial: ConsentChoices | null;
  onSave: (choices: ConsentChoices) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}) {
  // Opened from a link, so it starts from whatever is currently recorded — and
  // from all-off when nothing is, never from all-on.
  const [draft, setDraft] = useState<ConsentChoices>(
    initial ?? { necessary: true, preference: false, analytics: false, marketing: false }
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const thirdPartyNames = TAGS.filter((tag) => tag.cookies.some((cookie) => !cookie.firstParty)).map(
    (tag) => tag.vendor
  );

  return (
    <div className={styles.scrim} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={isSv ? "Cookie-inställningar" : "Cookie settings"}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.dialogTitle}>{isSv ? "Cookie-inställningar" : "Cookie settings"}</h2>
        <p className={styles.dialogIntro}>
          {isSv
            ? "Allt utom det nödvändiga är avstängt tills du slår på det. Du kan ändra dig när som helst."
            : "Everything except the necessary is off until you turn it on. You can change your mind at any time."}{" "}
          <Link href="/legal/cookies" className={styles.dialogLink}>
            {isSv ? "Se hela listan" : "See the full list"}
          </Link>
        </p>

        <div className={styles.categories}>
          <div className={styles.category}>
            <div className={styles.categoryHead}>
              <strong>{isSv ? "Nödvändiga" : "Necessary"}</strong>
              <span className={styles.always}>{isSv ? "Alltid på" : "Always on"}</span>
            </div>
            <p className={styles.categoryText}>
              {isSv
                ? "Håller dig inloggad och skyddar formulär. Utan dem fungerar inte tjänsten, så de kräver inte samtycke."
                : "Keeps you signed in and protects forms. The service does not work without them, so they do not require consent."}
            </p>
          </div>

          {OPTIONAL_CATEGORIES.map((category) => {
            const vendors = vendorsFor(category);
            return (
              <div key={category} className={styles.category}>
                <div className={styles.categoryHead}>
                  <strong>{CATEGORY_COPY[category][isSv ? "sv" : "en"]}</strong>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={draft[category]}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [category]: event.target.checked }))
                      }
                    />
                    <span className={styles.switchTrack} aria-hidden="true" />
                    <span className={styles.switchLabel}>
                      {draft[category] ? (isSv ? "På" : "On") : isSv ? "Av" : "Off"}
                    </span>
                  </label>
                </div>
                <p className={styles.categoryText}>
                  {CATEGORY_DESCRIPTION[category][isSv ? "sv" : "en"]}
                  {vendors.length > 0 ? ` ${isSv ? "Leverantörer" : "Providers"}: ${vendors.join(", ")}.` : ""}
                </p>
              </div>
            );
          })}
        </div>

        <div className={styles.dialogActions}>
          <button type="button" className={styles.choice} onClick={onAcceptAll}>
            {isSv ? "Godkänn allt" : "Accept all"}
          </button>
          <button type="button" className={styles.choice} onClick={onRejectAll}>
            {isSv ? "Neka allt" : "Reject all"}
          </button>
          <button type="button" className={styles.choice} onClick={() => onSave(draft)}>
            {isSv ? "Spara mitt val" : "Save my choice"}
          </button>
        </div>

        {thirdPartyNames.length > 0 ? (
          <p className={styles.dialogFootnote}>
            {isSv
              ? `Om du stänger av något raderar vi de cookies vi själva satt. Några cookies sätts på ${thirdPartyNames.join(", ")}s egna domäner och kan bara rensas i din webbläsare — vi slutar ladda dem direkt.`
              : `Turning something off deletes the cookies we set ourselves. A few are set on ${thirdPartyNames.join(", ")}'s own domains and can only be cleared in your browser — we stop loading them immediately.`}
          </p>
        ) : null}

        <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={isSv ? "Stäng" : "Close"}>
          {isSv ? "Stäng" : "Close"}
        </button>
      </div>
    </div>
  );
}
