"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AppFooter from "@/app/components/app-footer";
import MarketStrip from "@/app/components/market-strip";
import PublicNav from "@/app/components/public-nav";
import TopNav from "@/app/components/top-nav";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./app-shell.module.css";

type Props = {
  children: React.ReactNode;
  /** Resolved on the server from the session cookie, so the signed-in chrome is
      never rendered — not even for a frame — to a visitor without a session. */
  signedIn: boolean;
};

type NavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "portfolio" | "sentiment" | "quant" | "primers" | "profile";
};

// Routes that render inside the app frame. Not the same thing as "requires a
// session" — /help, /legal, /learn and /primers are public and are deliberately
// not in the middleware matcher, but they still get chrome (the signed-out
// variant below) because a visitor can reach them before signing up.
const PROTECTED_PREFIXES = ["/profile", "/account", "/instrument", "/dashboard", "/portfolio", "/sentiment", "/quant", "/primers", "/learn", "/help", "/legal", "/filings-primers", "/placera"];

function shouldUseShell(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/placera") {
    return pathname === "/placera" || pathname.startsWith("/placera/");
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

  if (kind === "profile") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 19c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
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

export default function AppShell({ children, signedIn }: Props) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const copy = getUiCopy(language);
  const navItems: NavItem[] = [
    { href: "/dashboard", label: copy.nav.dashboard, icon: "dashboard" },
    { href: "/portfolio", label: copy.nav.portfolio, icon: "portfolio" },
    // Sentiment, Quant and Primers left the rail: all three are questions about
    // a *specific* asset, and they now live as tabs on that asset's page. A
    // module that opens by asking "which ticker?" was a detour around the page
    // the reader was already trying to reach.
    //
    // /sentiment (the market desk) is a different thing and stays in the top
    // nav: it is about the market as a whole, so it has no asset to live on.
    // Last, and set apart in the rail: this is where you go to change a
    // setting, not part of the daily loop the four modules above it make up.
    { href: "/profile", label: copy.nav.profile, icon: "profile" }
  ];

  if (!pathname || !shouldUseShell(pathname)) {
    return (
      <div className={styles.standalone}>
        <div className={styles.standaloneContent}>{children}</div>
        <AppFooter />
      </div>
    );
  }

  // Signed out on a shell route. Middleware already redirects the gated ones, so
  // whatever reaches here is public content (the help pages linked from the
  // footer). Show the content, but none of the signed-in chrome: no module rail,
  // no nav into the app, no sign-out.
  if (!signedIn) {
    return (
      <div className={styles.public}>
        <MarketStrip action="signin" />
        <PublicNav />

        <main className={styles.publicMain}>
          <div className={styles.content}>
            <div className={styles.pageContent}>{children}</div>
          </div>
        </main>

        <AppFooter />
      </div>
    );
  }

  return (
    <div className={styles.frame}>
      <MarketStrip withSidebarOffset action="signout" />
      <TopNav />

      <aside className={styles.sidebar}>
        <nav className={styles.navPill} aria-label={copy.nav.mainNavigation}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={isActive(pathname, item.href) ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
            >
              <span className={styles.navIcon}>
                <NavIcon kind={item.icon} />
              </span>
              <span className={styles.navLabel} aria-hidden="true">
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <div className={styles.pageContent}>{children}</div>
        </div>
      </main>

      <div className={styles.footerSlot}>
        <AppFooter />
      </div>
    </div>
  );
}
