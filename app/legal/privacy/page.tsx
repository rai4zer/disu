"use client";

import LegalDocumentView from "@/app/components/legal-document";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import { pendingControllerFacts } from "@/app/lib/legal/controller.ts";
import { PRIVACY_DOCUMENT } from "@/app/lib/legal/privacy-document.ts";
import { pick } from "@/app/lib/legal/document.ts";
import styles from "../page.module.css";

export default function PrivacyPolicyPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const pending = pendingControllerFacts();

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={pick(PRIVACY_DOCUMENT.title, language)}
        subtitle={pick(PRIVACY_DOCUMENT.summary, language)}
      >
        {pending.length > 0 ? (
          <p className={styles.incomplete}>
            {isSv
              ? "Den här policyn är komplett i sak men inte formellt i kraft: företaget bakom DISU är ännu inte registrerat, så uppgifterna om personuppgiftsansvarig saknas nedan. De fylls i innan tjänsten öppnas för allmänheten."
              : "This policy is complete in substance but not yet formally in force: the company behind DISU is not registered yet, so the controller details below are missing. They will be filled in before the service opens to the public."}
          </p>
        ) : null}

        <LegalDocumentView document={PRIVACY_DOCUMENT} />
      </Workspace>
    </main>
  );
}
