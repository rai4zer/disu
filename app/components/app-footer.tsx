"use client";

import Link from "next/link";
import { useLanguage } from "@/app/i18n/language";
import { useConsent } from "./consent-provider";
import styles from "./app-footer.module.css";

export default function AppFooter() {
  const { language } = useLanguage();
  const { openPreferences } = useConsent();
  const isSv = language === "sv";

  return (
    <div className={styles.footerWrap}>
      <footer className={styles.footer} aria-label={isSv ? "Information och support" : "Information and support"}>
        <div className={styles.columns}>
          <section>
            <h3>{isSv ? "Behöver du hjälp?" : "Need help?"}</h3>
            <ul>
              <li><Link href="/help/faq">{isSv ? "Frågor & svar" : "FAQ"}</Link></li>
              <li><Link href="/help">{isSv ? "Kontakta oss" : "Contact us"}</Link></li>
            </ul>
          </section>
          <section>
            <h3>{isSv ? "DISU" : "DISU"}</h3>
            <ul>
              <li><Link href="/help/release-notes">{isSv ? "Release logg" : "Release log"}</Link></li>
              <li><Link href="/learn">{isSv ? "Kunskapsnav" : "Learning hub"}</Link></li>
              <li><span>{isSv ? "Statussida (kommer snart)" : "Status page (coming soon)"}</span></li>
            </ul>
          </section>
          <section>
            <h3>{isSv ? "Sociala medier" : "Social media"}</h3>
            <ul>
              <li><span>{isSv ? "LinkedIn (kommer snart)" : "LinkedIn (coming soon)"}</span></li>
              <li><span>{isSv ? "X (kommer snart)" : "X (coming soon)"}</span></li>
              <li><span>{isSv ? "YouTube (kommer snart)" : "YouTube (coming soon)"}</span></li>
            </ul>
          </section>
          <section>
            <h3>{isSv ? "Plattform" : "Platform"}</h3>
            <ul>
              <li><Link href="/dashboard">{isSv ? "Översikt" : "Overview"}</Link></li>
              <li><Link href="/portfolio">{isSv ? "Portfölj" : "Portfolio"}</Link></li>
              <li><Link href="/sentiment">{isSv ? "Marknadsdesk" : "Market desk"}</Link></li>
            </ul>
          </section>
          <section>
            <h3>{isSv ? "För företag" : "For companies"}</h3>
            <ul>
              <li><span>{isSv ? "Företagswebb (kommer snart)" : "Corporate site (coming soon)"}</span></li>
            </ul>
          </section>
        </div>

        <div className={styles.legal}>
          <Link href="/legal/terms">{isSv ? "Användarvillkor" : "Terms"}</Link>
          <Link href="/legal/privacy">{isSv ? "Integritetspolicy" : "Privacy"}</Link>
          <Link href="/legal/cookies">{isSv ? "Cookies" : "Cookies"}</Link>
          {/* Withdrawal has to be as easy as consent (GDPR Art. 7(3)), which
              means reachable from every page — not only on first visit. */}
          <button type="button" className={styles.legalButton} onClick={openPreferences}>
            {isSv ? "Cookie-inställningar" : "Cookie settings"}
          </button>
          <Link href="/legal">{isSv ? "Juridik" : "Legal"}</Link>
          <span>{isSv ? "Säkerhet (kommer snart)" : "Security (coming soon)"}</span>
          <span>{isSv ? "Klagomål (kommer snart)" : "Complaints (coming soon)"}</span>
        </div>
      </footer>
    </div>
  );
}
