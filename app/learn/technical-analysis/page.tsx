"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function TechnicalAnalysisPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Teknisk analys" : "Technical analysis"}
        subtitle={isSv ? "Trend, nivåer och sannolikhetsbaserade setups." : "Trend, levels, and probability-based setups."}
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Vi fyller denna sida med struktur för trendanalys, triggerregler och exits."
              : "We will fill this page with a structure for trend analysis, trigger rules, and exits."}
          </p>
        </section>
      </Workspace>
    </main>
  );
}
