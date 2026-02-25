"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function HelpFaqPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Vanliga frågor" : "FAQ"}
        subtitle={isSv ? "Snabba svar på vanliga frågor och felsökning." : "Quick answers to common questions and troubleshooting."}
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Här lägger vi svar på återkommande frågor om konto, data och jobbkörningar."
              : "We will add answers to recurring questions about accounts, data, and job runs here."}
          </p>
        </section>
      </Workspace>
    </main>
  );
}
