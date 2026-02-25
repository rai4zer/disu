"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./theme-toggle.module.css";

type Theme = "light" | "dark";

type Props = {
  className?: string;
};

function resolveInitialTheme(): Theme {
  const stored = window.localStorage.getItem("theme") ?? window.localStorage.getItem("placera-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setDocumentTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem("theme", theme);
  window.localStorage.setItem("placera-theme", theme);
}

export default function ThemeToggle({ className }: Props) {
  const { language } = useLanguage();
  const copy = getUiCopy(language);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initialTheme = resolveInitialTheme();
    setTheme(initialTheme);
    setDocumentTheme(initialTheme);
  }, []);

  const nextTheme: Theme = theme === "light" ? "dark" : "light";

  return (
    <button
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      type="button"
      onClick={() => {
        setTheme(nextTheme);
        setDocumentTheme(nextTheme);
      }}
      aria-label={nextTheme === "light" ? copy.themeToggle.switchToLight : copy.themeToggle.switchToDark}
      title={nextTheme === "light" ? copy.themeToggle.switchToLight : copy.themeToggle.switchToDark}
    >
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true">
          <circle cx="12" cy="12" r="4.25" />
          <path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.72 5.28l-1.77 1.77M7.05 16.95l-1.77 1.77M18.72 18.72l-1.77-1.77M7.05 7.05 5.28 5.28" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true">
          <path d="M20.7 14.3A8.7 8.7 0 1 1 9.7 3.3a7.4 7.4 0 1 0 11 11z" />
        </svg>
      )}
    </button>
  );
}
