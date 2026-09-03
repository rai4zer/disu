"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import InstrumentSearch from "@/app/components/instrument-search";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./public-nav.module.css";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Header for the open-facing pages a signed-out visitor is allowed to read.
 * Deliberately NOT TopNav: that one links into the gated app (Overview, Market
 * desk, Learn) and would advertise pages the visitor cannot open. This carries
 * only public destinations plus the sign-up nudge.
 */
export default function PublicNav() {
  const pathname = usePathname() ?? "";
  const { language } = useLanguage();
  const copy = getUiCopy(language);
  const isSv = language === "sv";

  const links = [
    { href: "/help", label: copy.topNav.helpMenu.hub, exact: true },
    { href: "/help/docs", label: copy.topNav.helpMenu.docs, exact: false },
    { href: "/help/faq", label: copy.topNav.helpMenu.faq, exact: false }
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="DISU">
          <span className={styles.brandWord}>DISU</span>
          <span className={styles.brandGlyph} aria-hidden="true">
            𒁲𒋢
          </span>
        </Link>

        {/* The rail carries the centred content column, the nav inside it carries
            the negative shift that pulls the first item's text off its own
            padding and onto the column edge — so "Help center" starts exactly
            where the page headline below it starts. */}
        <div className={styles.navRail}>
          <nav className={styles.nav} aria-label={isSv ? "Publika sidor" : "Public pages"}>
            {links.map((link) => {
              const active = link.exact ? pathname === link.href : isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Search sits beside the CTA for a signed-out visitor too: instrument
            pages are public (ROADMAP §4.6), and searching is how anyone reaches
            them without already knowing a URL. */}
        <div className={styles.actions}>
          <InstrumentSearch />
          <Link href="/auth/login?mode=register" className={styles.cta}>
            {isSv ? "Skapa konto" : "Create account"}
          </Link>
        </div>
      </div>
    </div>
  );
}
