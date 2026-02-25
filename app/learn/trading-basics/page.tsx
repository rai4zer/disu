"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function TradingBasicsPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Tradinggrunder" : "Trading basics"}
        subtitle={
          isSv
            ? "Grundramverk: marknadsstruktur, orderläggning och enkel exekveringshygien."
            : "Foundation framework: market structure, order placement, and basic execution hygiene."
        }
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Vi fyller denna sida med korta lektionsblock och checklistor."
              : "We will fill this page with short lesson blocks and checklists."}
          </p>
        </section>
      </Workspace>
    </main>
  );
}
