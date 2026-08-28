"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type AppLanguage = "en" | "sv";

const LANGUAGE_STORAGE_KEY = "app_language";
const LEGACY_HOME_LANGUAGE_KEY = "home_language";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (next: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === "en" || value === "sv";
}

function resolveInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "en";
  }

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isAppLanguage(stored)) {
    return stored;
  }

  const legacy = window.localStorage.getItem(LEGACY_HOME_LANGUAGE_KEY);
  if (isAppLanguage(legacy)) {
    return legacy;
  }

  return "en";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  // Sync from storage as soon as we're on the client. Runs before paint via
  // useLayoutEffect on the client; falls back to useEffect during SSR to avoid
  // a hydration warning.
  useIsomorphicLayoutEffect(() => {
    const initial = resolveInitialLanguage();
    setLanguageState((current) => (current === initial ? current : initial));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    window.localStorage.setItem(LEGACY_HOME_LANGUAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: setLanguageState
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
