"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function RiskManagementPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Riskhantering" : "Risk management"}
        subtitle={
          isSv
            ? "Kapitalbevarande först: storlek, stopp, och tydliga riskgränser."
            : "Capital preservation first: sizing, stops, and clear risk limits."
        }
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Vi fyller denna sida med riskmallar som kan användas direkt i din process."
              : "We will fill this page with risk templates you can use directly in your process."}
          </p>
        </section>
      </Workspace>
    </main>
  );
}
