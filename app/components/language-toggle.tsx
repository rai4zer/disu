"use client";

import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./language-toggle.module.css";

type Props = {
  className?: string;
};

export default function LanguageToggle({ className }: Props) {
  const { language, setLanguage } = useLanguage();
  const copy = getUiCopy(language);

  const nextLanguage = language === "en" ? "sv" : "en";
  const flag = language === "sv" ? "🇸🇪" : "🇬🇧";

  return (
    <button
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      type="button"
      onClick={() => setLanguage(nextLanguage)}
      aria-label={copy.languageToggle.label}
      title={copy.languageToggle.label}
    >
      <span className={styles.flag} aria-hidden="true">
        {flag}
      </span>
      <span className={styles.srOnly}>{copy.languageToggle.shortLabel}</span>
    </button>
  );
}
