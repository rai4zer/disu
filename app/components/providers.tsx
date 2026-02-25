"use client";

import { LanguageProvider } from "@/app/i18n/language";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}
