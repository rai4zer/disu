"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./theme-toggle.module.css";

/**
 * The theme picker.
 *
 * It used to be an icon button in the market strip. It lives in My Profile now,
 * next to the language picker, for the same reason that one moved: the top bar
 * carries chrome, not preferences. That is also why this renders as a segmented
 * control rather than a two-state button — a toggle can only say "the other
 * one", while a preference someone has gone looking for should show what it is
 * currently set to.
 *
 * Three choices, not two. The old toggle already followed the OS when nothing
 * was stored, so dropping to light/dark would have taken that behaviour away
 * from everyone who never touched it. "System" is therefore represented as the
 * *absence* of a stored key, which keeps it live: the browser goes dark at
 * sunset with the OS instead of being pinned to whatever it said on first
 * visit.
 */

type Choice = "system" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEYS = ["theme", "placera-theme"] as const;

function readChoice(): Choice {
  for (const key of STORAGE_KEYS) {
    const stored = window.localStorage.getItem(key);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  }
  return "system";
}

function systemTheme(): Resolved {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyChoice(choice: Choice) {
  const resolved: Resolved = choice === "system" ? systemTheme() : choice;
  document.documentElement.setAttribute("data-theme", resolved);

  // Both keys are written, and both cleared, because the pre-paint script in
  // layout.tsx reads either one — a browser that still carries the old
  // `placera-theme` key must not out-vote a choice made here.
  for (const key of STORAGE_KEYS) {
    if (choice === "system") {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, choice);
    }
  }
}

export default function ThemeToggle() {
  const { language } = useLanguage();
  const copy = getUiCopy(language);

  // "system" until the effect runs: the server has no localStorage, so any
  // other initial value would render one option as active and then change it.
  // The document itself is already correct by then — layout.tsx set data-theme
  // before paint — so this state only drives which segment looks selected.
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    setChoice(readChoice());
  }, []);

  // Following the OS is only meaningful if it keeps following it. Without this
  // the page would hold whatever the OS said at load for the rest of the visit.
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyChoice("system");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [choice]);

  const options: Array<{ value: Choice; label: string }> = [
    { value: "system", label: copy.themeToggle.system },
    { value: "light", label: copy.themeToggle.light },
    { value: "dark", label: copy.themeToggle.dark }
  ];

  return (
    <div className="dsSegmented" role="radiogroup" aria-label={copy.themeToggle.label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={choice === option.value}
          className={`dsSegment ${choice === option.value ? "dsSegmentActive" : ""}`}
          onClick={() => {
            setChoice(option.value);
            applyChoice(option.value);
          }}
        >
          <span className={styles.glyph} aria-hidden="true">
            {option.value === "system" ? (
              <svg viewBox="0 0 24 24" className={styles.icon}>
                <rect x="2.75" y="4.25" width="18.5" height="12.5" rx="2" />
                <path d="M8.5 20.5h7" />
              </svg>
            ) : option.value === "light" ? (
              <svg viewBox="0 0 24 24" className={styles.icon}>
                <circle cx="12" cy="12" r="4.25" />
                <path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.72 5.28l-1.77 1.77M7.05 16.95l-1.77 1.77M18.72 18.72l-1.77-1.77M7.05 7.05 5.28 5.28" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className={styles.icon}>
                <path d="M20.7 14.3A8.7 8.7 0 1 1 9.7 3.3a7.4 7.4 0 1 0 11 11z" />
              </svg>
            )}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
