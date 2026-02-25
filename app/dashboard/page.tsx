"use client";

import Link from "next/link";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

export default function DashboardPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const modules = [
    {
      eyebrow: isSv ? "Sanningskälla" : "Source of truth",
      name: isSv ? "Portfölj" : "Portfolio",
      description: isSv
        ? "Koppla mäklare och håll innehav synkade som baslager för all analys."
        : "Connect brokers and keep holdings synced as the base layer for all analysis.",
      href: "/portfolio",
      cta: isSv ? "Öppna Portfölj" : "Open Portfolio"
    },
    {
      eyebrow: isSv ? "Narrativ" : "Narrative",
      name: "Sentiment",
      description: isSv
        ? "Skanna forum- och kommentarflöde för att identifiera flocklutning och signalhälsa."
        : "Scan forum and comment flow to identify crowd tilt and signal health.",
      href: "/sentiment",
      cta: isSv ? "Kör Sentiment" : "Run Sentiment"
    },
    {
      eyebrow: isSv ? "Scenarier" : "Scenarios",
      name: "Quant",
      description: isSv
        ? "Modellera korta och medellånga prisbanor med sannolikhetskontext."
        : "Model short- and medium-horizon price paths with probability context.",
      href: "/quant",
      cta: isSv ? "Kör Quant" : "Run Quant"
    },
    {
      eyebrow: "Filings",
      name: "Primers",
      description: isSv
        ? "Gör 10-K och 10-Q till korta beslutsklara primers."
        : "Turn 10-K and 10-Q filings into concise, decision-ready primers.",
      href: "/primers",
      cta: isSv ? "Skapa Primer" : "Generate Primer"
    }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Översikt" : "Dashboard"}
        subtitle={isSv ? "Snabb väg in i varje arbetsflöde." : "Fast path into each workflow."}
      >
        <section className={`${styles.hero} appSection`}>
          <div>
            <p className={styles.summaryLabel}>{isSv ? "Arbetsmodell" : "Operating model"}</p>
            <p className={styles.summaryText}>
              {isSv
                ? "Starta i Portfölj och gå sedan till Sentiment, Quant och Primers med en delad tickerkontext."
                : "Start in Portfolio, then branch to Sentiment, Quant, and Primers with one shared ticker context."}
            </p>
          </div>
          <div className={styles.flow}>
            <span>{isSv ? "Portfölj" : "Portfolio"}</span>
            <span aria-hidden="true">→</span>
            <span>Sentiment</span>
            <span aria-hidden="true">→</span>
            <span>Quant</span>
            <span aria-hidden="true">→</span>
            <span>Primers</span>
          </div>
        </section>

        <section className={styles.grid} aria-label={isSv ? "Verktyg" : "Tools"}>
          {modules.map((module) => (
            <article key={module.name} className={`${styles.card} appSection`}>
              <p className={styles.cardEyebrow}>{module.eyebrow}</p>
              <h2>{module.name}</h2>
              <p>{module.description}</p>
              <Link href={module.href} className={styles.inlineLink}>
                {module.cta}
              </Link>
            </article>
          ))}
        </section>
      </Workspace>
    </main>
  );
}
