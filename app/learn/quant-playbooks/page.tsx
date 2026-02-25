"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function QuantPlaybooksPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Quant-playbooks" : "Quant playbooks"}
        subtitle={
          isSv
            ? "Översätt modeller till beslut: signal, confidence och exekveringsplan."
            : "Translate models into decisions: signal, confidence, and execution plan."
        }
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Vi fyller denna sida med konkreta playbooks kopplade till Quant-output."
              : "We will fill this page with concrete playbooks tied to Quant output."}
          </p>
        </section>
      </Workspace>
    </main>
  );
}
