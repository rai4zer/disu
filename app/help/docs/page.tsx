"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function HelpDocsPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Dokumentation" : "Docs"}
        subtitle={
          isSv
            ? "Produktguider för Portfolio, Sentiment, Quant och Primers."
            : "Product guides for Portfolio, Sentiment, Quant, and Primers."
        }
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>{isSv ? "Här lägger vi strukturerade guider med steg-för-steg-flöden." : "We will add structured guides with step-by-step flows here."}</p>
        </section>
      </Workspace>
    </main>
  );
}
