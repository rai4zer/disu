"use client";

import Link from "next/link";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

export default function LearnHubPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const cards = [
    {
      href: "/learn/trading-basics",
      title: isSv ? "Tradinggrunder" : "Trading basics",
      description: isSv ? "Ordertyper, spread, likviditet och exekvering." : "Order types, spread, liquidity, and execution."
    },
    {
      href: "/learn/technical-analysis",
      title: isSv ? "Teknisk analys" : "Technical analysis",
      description: isSv ? "Trend, momentum, stöd/motstånd och signaldisciplin." : "Trend, momentum, support/resistance, and signal discipline."
    },
    {
      href: "/learn/risk-management",
      title: isSv ? "Riskhantering" : "Risk management",
      description: isSv ? "Position sizing, maxförlust och portföljrisk." : "Position sizing, max loss, and portfolio risk."
    },
    {
      href: "/learn/quant-playbooks",
      title: isSv ? "Quant-playbooks" : "Quant playbooks",
      description: isSv ? "Hur du läser sannolikhetsoutput och agerar systematiskt." : "How to read probability output and act systematically."
    }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Lär dig mer" : "Learn more"}
        subtitle={isSv ? "Utbildningsyta för trading, teknisk analys och riskhantering." : "Education area for trading, technical analysis, and risk management."}
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Välj område" : "Pick a track"}</h2>
          <p>{isSv ? "Bygg upp en tydlig metod innan du skalar upp kapital och risk." : "Build a clear method before scaling capital and risk."}</p>
        </section>

        <section className={styles.links} aria-label={isSv ? "Utbildningssidor" : "Education pages"}>
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className={styles.linkCard}>
              <strong>{card.title}</strong>
              <span>{card.description}</span>
            </Link>
          ))}
        </section>
      </Workspace>
    </main>
  );
}
