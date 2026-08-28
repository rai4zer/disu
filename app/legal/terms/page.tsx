"use client";

import LegalDocumentView from "@/app/components/legal-document";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import { pendingControllerFacts } from "@/app/lib/legal/controller.ts";
import { TERMS_DOCUMENT } from "@/app/lib/legal/terms-document.ts";
import { pick } from "@/app/lib/legal/document.ts";
import styles from "../page.module.css";

export default function TermsPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const pending = pendingControllerFacts();

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace title={pick(TERMS_DOCUMENT.title, language)} subtitle={pick(TERMS_DOCUMENT.summary, language)}>
        {pending.length > 0 ? (
          <p className={styles.incomplete}>
            {isSv
              ? "Villkoren är kompletta i sak men inte formellt i kraft: företaget bakom DISU är ännu inte registrerat, så namnet på motparten saknas nedan. Det fylls i innan tjänsten öppnas för allmänheten."
              : "These terms are complete in substance but not yet formally in force: the company behind DISU is not registered yet, so the name of the other party is missing below. It will be filled in before the service opens to the public."}
          </p>
        ) : null}

        <LegalDocumentView document={TERMS_DOCUMENT} />
      </Workspace>
    </main>
  );
}
