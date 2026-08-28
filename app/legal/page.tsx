"use client";

import Link from "next/link";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import { LEGAL_DOCUMENTS_UPDATED } from "@/app/lib/legal/controller.ts";
import styles from "./page.module.css";

export default function LegalIndexPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const documents = [
    {
      href: "/legal/privacy",
      title: isSv ? "Integritetspolicy" : "Privacy policy",
      description: isSv
        ? "Vad vi samlar in, varför, vilka andra som ser det, och hur du får ut det eller raderar det."
        : "What we collect, why, who else sees it, and how to get it back or delete it."
    },
    {
      href: "/legal/terms",
      title: isSv ? "Användarvillkor" : "Terms of service",
      description: isSv
        ? "Vad DISU gör, vad det medvetet inte gör, och vad vi är skyldiga varandra."
        : "What DISU does, what it deliberately does not do, and what we each owe the other."
    },
    {
      href: "/legal/cookies",
      title: isSv ? "Cookies" : "Cookies",
      description: isSv
        ? "Hela listan över vad vi lagrar i din webbläsare, och vad du får bestämma om."
        : "The full list of what we store in your browser, and what you get to decide about."
    }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Juridik och integritet" : "Legal and privacy"}
        subtitle={
          isSv
            ? "Tre dokument, skrivna för att läsas."
            : "Three documents, written to be read."
        }
      >
        <section className={`${styles.intro} appSection`}>
          <p>
            {isSv
              ? "DISU hanterar dina innehav, så du har rätt att veta exakt vad som lagras, vem mer som ser det och vad du kan göra åt det. Det står i klartext nedan — inte i finstilt."
              : "DISU handles your holdings, so you are entitled to know exactly what is stored, who else sees it, and what you can do about it. It is written in plain language below, not in small print."}
          </p>
        </section>

        <section className={styles.links} aria-label={isSv ? "Juridiska dokument" : "Legal documents"}>
          {documents.map((entry) => (
            <Link key={entry.href} href={entry.href} className={styles.linkCard}>
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
            </Link>
          ))}
        </section>

        <p className={styles.updated}>
          {isSv
            ? `Alla tre uppdaterades senast ${LEGAL_DOCUMENTS_UPDATED}.`
            : `All three were last updated on ${LEGAL_DOCUMENTS_UPDATED}.`}
        </p>
      </Workspace>
    </main>
  );
}
