"use client";

/**
 * The Portfolio module's horizontal tab bar.
 *
 * Four views of the same money — the accounts it sits in, the positions it is
 * held as, what it has done, and what is coming — so they are tabs within one
 * module rather than four entries in the sidebar rail. The rail is for
 * different jobs; this is one job at four altitudes.
 *
 * The active tab is derived from the pathname rather than held in state,
 * because these are real routes: each is linkable, bookmarkable and
 * back-buttonable, and a tab bar that only looks like navigation while actually
 * swapping a panel breaks all three.
 *
 * The underline is on the link itself rather than a sliding indicator. A
 * sliding one has to know its neighbours' geometry, which means measuring the
 * DOM, which means it is wrong for a frame on every load and wrong forever if a
 * label wraps.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/app/i18n/language";
import styles from "./portfolio-tabs.module.css";

export default function PortfolioTabs() {
  const pathname = usePathname() ?? "";
  const { language } = useLanguage();
  const isSv = language === "sv";

  const tabs = [
    { href: "/portfolio", label: isSv ? "Mina pengar" : "My money" },
    { href: "/portfolio/positions", label: isSv ? "Innehav" : "Positions" },
    { href: "/portfolio/analysis", label: isSv ? "Analys" : "Analysis" },
    { href: "/portfolio/calendar", label: isSv ? "Kalender" : "Calendar" }
  ];

  /**
   * `/portfolio` is a prefix of every other tab, so it can only match exactly —
   * otherwise "My money" would render active on all four. The rest match their
   * own subtree so a detail page under a tab keeps that tab lit.
   */
  const isActive = (href: string) =>
    href === "/portfolio" ? pathname === "/portfolio" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className={styles.tabs} aria-label={isSv ? "Portföljvyer" : "Portfolio views"}>
      {tabs.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
