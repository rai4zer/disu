"use client";

import LegalDocumentView from "@/app/components/legal-document";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import { COOKIE_DOCUMENT } from "@/app/lib/legal/cookie-document.ts";
import { pick } from "@/app/lib/legal/document.ts";
import styles from "../page.module.css";

export default function CookiesPage() {
  const { language } = useLanguage();

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace title={pick(COOKIE_DOCUMENT.title, language)} subtitle={pick(COOKIE_DOCUMENT.summary, language)}>
        <LegalDocumentView document={COOKIE_DOCUMENT} />
      </Workspace>
    </main>
  );
}
