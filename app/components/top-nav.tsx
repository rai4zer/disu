"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./top-nav.module.css";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TopNav() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const copy = getUiCopy(language);

  const learnSections = [
    {
      title: copy.topNav.education.foundations,
      items: [
        { href: "/learn", label: copy.topNav.education.hub },
        { href: "/learn/trading-basics", label: copy.topNav.education.tradingBasics }
      ]
    },
    {
      title: copy.topNav.education.analysis,
      items: [{ href: "/learn/technical-analysis", label: copy.topNav.education.technicalAnalysis }]
    },
    {
      title: copy.topNav.education.execution,
      items: [
        { href: "/learn/risk-management", label: copy.topNav.education.riskManagement },
        { href: "/learn/quant-playbooks", label: copy.topNav.education.quantPlaybooks }
      ]
    }
  ];

  const helpItems = [
    { href: "/help", label: copy.topNav.helpMenu.hub },
    { href: "/help/docs", label: copy.topNav.helpMenu.docs },
    { href: "/help/faq", label: copy.topNav.helpMenu.faq },
    { href: "/help/release-notes", label: copy.topNav.helpMenu.releaseNotes }
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <Link href="/dashboard" className={styles.brand} aria-label="DISU">
          <span className={styles.brandWord}>DISU</span>
          <span className={styles.brandGlyph} aria-hidden="true">
            𒁲𒋢
          </span>
        </Link>

        <div className={styles.navRail}>
          <nav className={styles.nav} aria-label={language === "sv" ? "Sekundär navigering" : "Secondary navigation"}>
            <Link href="/dashboard" className={isActive(pathname, "/dashboard") ? `${styles.item} ${styles.itemActive}` : styles.item}>
              {copy.topNav.overview}
            </Link>

            <Link href="/sentiment" className={isActive(pathname, "/sentiment") || isActive(pathname, "/placera") ? `${styles.item} ${styles.itemActive}` : styles.item}>
              {copy.topNav.marketDesk}
            </Link>

            <div className={styles.dropdown}>
              <button
                type="button"
                className={isActive(pathname, "/learn") ? `${styles.item} ${styles.itemActive}` : styles.item}
                aria-haspopup="menu"
              >
                {copy.topNav.learnMore}
                <span aria-hidden="true" className={styles.caret}>
                  ▾
                </span>
              </button>

              <div className={styles.panel} role="menu" aria-label={copy.topNav.learnMore}>
                {learnSections.map((section) => (
                  <div key={section.title} className={styles.panelGroup}>
                    <p className={styles.panelTitle}>{section.title}</p>
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className={isActive(pathname, item.href) ? `${styles.panelItem} ${styles.panelItemActive}` : styles.panelItem}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.dropdown}>
              <button
                type="button"
                className={isActive(pathname, "/help") ? `${styles.item} ${styles.itemActive}` : styles.item}
                aria-haspopup="menu"
              >
                {copy.topNav.help}
                <span aria-hidden="true" className={styles.caret}>
                  ▾
                </span>
              </button>

              <div className={styles.panel} role="menu" aria-label={copy.topNav.help}>
                {helpItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={isActive(pathname, item.href) ? `${styles.panelItem} ${styles.panelItemActive}` : styles.panelItem}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
