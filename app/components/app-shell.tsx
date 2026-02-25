"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import MarketStrip from "@/app/components/market-strip";
import TopNav from "@/app/components/top-nav";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./app-shell.module.css";

type Props = {
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "portfolio" | "sentiment" | "quant" | "primers";
};

const PROTECTED_PREFIXES = ["/dashboard", "/portfolio", "/sentiment", "/quant", "/primers", "/learn", "/help", "/filings-primers", "/placera"];

function shouldUseShell(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/sentiment") {
    return pathname === "/sentiment" || pathname.startsWith("/placera");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ kind }: { kind: NavItem["icon"] }) {
  if (kind === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h7v6H4z" />
        <path d="M13 5h7v10h-7z" />
        <path d="M4 13h7v6H4z" />
        <path d="M13 17h7v2h-7z" />
      </svg>
    );
  }

  if (kind === "portfolio") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8h16v11H4z" />
        <path d="M9 8V6h6v2" />
      </svg>
    );
  }

  if (kind === "sentiment") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 5h12v10H9l-3 3z" />
        <path d="M9 9h6M9 12h4" />
      </svg>
    );
  }

  if (kind === "quant") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18h16" />
        <path d="M6 16 10 11l3 2 5-6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12v16H6z" />
      <path d="M9 8h6M9 11h6M9 14h4" />
    </svg>
  );
}

export default function AppShell({ children }: Props) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const copy = getUiCopy(language);
  const navItems: NavItem[] = [
    { href: "/dashboard", label: copy.nav.dashboard, icon: "dashboard" },
    { href: "/portfolio", label: copy.nav.portfolio, icon: "portfolio" },
    { href: "/sentiment", label: copy.nav.sentiment, icon: "sentiment" },
    { href: "/quant", label: copy.nav.quant, icon: "quant" },
    { href: "/primers", label: copy.nav.primers, icon: "primers" }
  ];

  if (!pathname || !shouldUseShell(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className={styles.frame}>
      <MarketStrip withSidebarOffset action="signout" />
      <TopNav />

      <aside className={styles.sidebar}>
        <nav className={styles.nav} aria-label={copy.nav.mainNavigation}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
            >
              <span className={styles.navIcon}>
                <NavIcon kind={item.icon} />
              </span>
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
