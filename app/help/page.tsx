"use client";

import Link from "next/link";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

export default function HelpHubPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const cards = [
    {
      href: "/help/docs",
      title: isSv ? "Dokumentation" : "Docs",
      description: isSv ? "Hur funktionerna fungerar och hur de kopplas ihop." : "How features work and how they connect."
    },
    {
      href: "/help/faq",
      title: isSv ? "Vanliga frågor" : "FAQ",
      description: isSv ? "Snabba svar på vanliga frågor och felbilder." : "Quick answers to common questions and failures."
    },
    {
      href: "/help/release-notes",
      title: isSv ? "Versionsnyheter" : "Release notes",
      description: isSv ? "Vad som har ändrats och vad som kommer härnäst." : "What changed and what is coming next."
    }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Hjälpcenter" : "Help center"}
        subtitle={
          isSv ? "Dokumentation och supportyta för plattformen." : "Documentation and support area for the platform."
        }
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Välj sida" : "Choose a page"}</h2>
          <p>{isSv ? "Starta här när du söker svar eller vill följa senaste ändringar." : "Start here when you need answers or want to follow recent changes."}</p>
        </section>

        <section className={styles.links} aria-label={isSv ? "Hjälpsidor" : "Help pages"}>
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
