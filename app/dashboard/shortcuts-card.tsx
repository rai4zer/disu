"use client";

/**
 * The shortcuts card, and the "all options" panel behind it.
 *
 * Four things on the card — insert funds, add a holding, portfolio, calendar —
 * and everything else one tap further in. The card is the shortlist; the panel
 * is the full menu, grouped, each row with a line explaining what it does.
 *
 * The panel is a sheet, not a route: these are jumping-off points, and pushing
 * history for a menu means the back button dismisses a menu instead of going
 * back to where the reader came from. It is dismissed the three ways a sheet
 * has to be — the close button, Escape, and the scrim — and focus is sent into
 * it on open and returned to the trigger on close, because a panel that traps a
 * keyboard user is worse than no panel.
 *
 * "Insert funds" deliberately goes nowhere yet. Deposits require a licensed
 * partner holding segregated client money (docs/trading-platform.md §3), so the
 * row explains that instead of pretending to open a transfer. A shortcut that
 * silently does nothing is worse than one that says why.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

type ShortcutIcon = "deposit" | "add" | "portfolio" | "calendar" | "transfer" | "connect" | "analysis" | "profile";

function Icon({ kind }: { kind: ShortcutIcon }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true as const };
  if (kind === "deposit") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2.5" />
        <path d="M12 10v5M9.5 12.5h5" />
      </svg>
    );
  }
  if (kind === "add") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (kind === "portfolio") {
    return (
      <svg {...common}>
        <path d="M4 8h16v11H4z" />
        <path d="M9 8V6h6v2" />
      </svg>
    );
  }
  if (kind === "calendar") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </svg>
    );
  }
  if (kind === "transfer") {
    return (
      <svg {...common}>
        <path d="M4 9h13l-3-3M20 15H7l3 3" />
      </svg>
    );
  }
  if (kind === "connect") {
    return (
      <svg {...common}>
        <path d="M9 15l6-6" />
        <path d="M7 11 5.5 12.5a3.5 3.5 0 0 0 5 5L12 16" />
        <path d="M17 13l1.5-1.5a3.5 3.5 0 0 0-5-5L12 8" />
      </svg>
    );
  }
  if (kind === "analysis") {
    return (
      <svg {...common}>
        <path d="M4 19h16" />
        <path d="M7 16V9M12 16V5M17 16v-4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
    </svg>
  );
}

type PanelRow = {
  icon: ShortcutIcon;
  title: string;
  detail: string;
  href?: string;
  /** Set when the row is deliberately not actionable yet, and why. */
  pending?: string;
};

export default function ShortcutsCard() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    // Captured now, not read at cleanup time: by the time the sheet closes the
    // ref may point somewhere else, and focus would be returned to the wrong
    // element — or to nothing.
    const trigger = triggerRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    // Move focus into the sheet so the next Tab lands inside it rather than
    // continuing through the page behind the scrim.
    panelRef.current?.focus();

    // The page behind must not scroll while a full-height sheet is over it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, close]);

  const tiles: Array<{ icon: ShortcutIcon; label: string; href?: string; onClick?: () => void }> = [
    {
      icon: "deposit",
      label: isSv ? "Sätt in pengar" : "Insert funds",
      onClick: () => setOpen(true)
    },
    { icon: "add", label: isSv ? "Lägg till innehav" : "Add holdings", href: "/portfolio/positions#add-holding" },
    { icon: "portfolio", label: isSv ? "Portfölj" : "Portfolio", href: "/portfolio" },
    { icon: "calendar", label: isSv ? "Kalender" : "Calendar", href: "/portfolio/calendar" }
  ];

  const groups: Array<{ heading: string; rows: PanelRow[] }> = [
    {
      heading: isSv ? "Pengar" : "Money",
      rows: [
        {
          icon: "deposit",
          title: isSv ? "Sätt in pengar" : "Insert funds",
          detail: isSv
            ? "Kräver en licensierad partner som håller kundmedel åtskilda. Inte byggt än."
            : "Needs a licensed partner holding client money in segregation. Not built yet.",
          pending: isSv ? "Planerad" : "Planned"
        },
        {
          icon: "transfer",
          title: isSv ? "Ta ut pengar" : "Withdraw",
          detail: isSv
            ? "Går till samma konto som insättningen kom från."
            : "Returns to the account the deposit came from.",
          pending: isSv ? "Planerad" : "Planned"
        }
      ]
    },
    {
      heading: isSv ? "Innehav" : "Holdings",
      rows: [
        {
          icon: "add",
          title: isSv ? "Lägg till innehav" : "Add a holding",
          detail: isSv ? "Sök bolaget och ange antal aktier." : "Search the company and enter your share count.",
          href: "/portfolio/positions#add-holding"
        },
        {
          icon: "connect",
          title: isSv ? "Koppla bank eller depå" : "Connect a bank or broker",
          detail: isSv ? "Hämta innehav automatiskt, eller importera en fil." : "Sync holdings automatically, or import a file.",
          href: "/portfolio#import-holdings"
        }
      ]
    },
    {
      heading: isSv ? "Gå till" : "Go to",
      rows: [
        {
          icon: "portfolio",
          title: isSv ? "Mina pengar" : "My money",
          detail: isSv ? "Konton, depåer och kopplingar." : "Accounts, brokers and connections.",
          href: "/portfolio"
        },
        {
          icon: "analysis",
          title: isSv ? "Analys" : "Analysis",
          detail: isSv ? "Avkastning, utdelningar, fördelning per land och sektor." : "Returns, dividends, country and sector split.",
          href: "/portfolio/analysis"
        },
        {
          icon: "calendar",
          title: isSv ? "Kalender" : "Calendar",
          detail: isSv ? "Rapporter, stämmor och utdelningar för dina innehav." : "Reports, AGMs and dividends for your holdings.",
          href: "/portfolio/calendar"
        },
        {
          icon: "profile",
          title: isSv ? "Min profil" : "My Profile",
          detail: isSv ? "Inloggning, export och radering av konto." : "Sign-in, data export and account deletion.",
          href: "/profile"
        }
      ]
    }
  ];

  return (
    <>
      <article className={`dsCard ${styles.shortcutsCard}`}>
        <header className="dsCardHeader">
          <h2 className="dsCardTitle">{isSv ? "Genvägar" : "Shortcuts"}</h2>
        </header>

        <div className={styles.shortcutGrid}>
          {tiles.map((tile) =>
            tile.href ? (
              <Link key={tile.label} href={tile.href} className={styles.shortcut}>
                <span className={styles.shortcutIcon}>
                  <Icon kind={tile.icon} />
                </span>
                <span className={styles.shortcutLabel}>{tile.label}</span>
              </Link>
            ) : (
              <button key={tile.label} type="button" className={styles.shortcut} onClick={tile.onClick}>
                <span className={styles.shortcutIcon}>
                  <Icon kind={tile.icon} />
                </span>
                <span className={styles.shortcutLabel}>{tile.label}</span>
              </button>
            )
          )}
        </div>

        <button ref={triggerRef} type="button" className={styles.allShortcuts} onClick={() => setOpen(true)}>
          {isSv ? "Alla genvägar" : "All shortcuts"}
        </button>
      </article>

      {open ? (
        <div className={styles.sheetScrim} onClick={close} role="presentation">
          <div
            ref={panelRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={isSv ? "Alla genvägar" : "All shortcuts"}
            tabIndex={-1}
            // The sheet is inside the scrim so a click outside dismisses; a
            // click on the sheet itself must not bubble up into that handler.
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>{isSv ? "Alla genvägar" : "All shortcuts"}</h2>
              <button
                type="button"
                className={styles.sheetClose}
                onClick={close}
                aria-label={isSv ? "Stäng" : "Close"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>

            <div className={styles.sheetBody}>
              {groups.map((group) => (
                <section key={group.heading} className={styles.sheetGroup}>
                  <h3 className={styles.sheetGroupHeading}>{group.heading}</h3>
                  <ul className={styles.sheetRows}>
                    {group.rows.map((row) => {
                      const inner = (
                        <>
                          <span className={styles.sheetRowIcon}>
                            <Icon kind={row.icon} />
                          </span>
                          <span className={styles.sheetRowText}>
                            <span className={styles.sheetRowTitle}>
                              {row.title}
                              {row.pending ? <em className={styles.sheetRowTag}>{row.pending}</em> : null}
                            </span>
                            <span className={styles.sheetRowDetail}>{row.detail}</span>
                          </span>
                          {row.href ? (
                            <svg className={styles.sheetRowChevron} viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          ) : null}
                        </>
                      );

                      return (
                        <li key={row.title}>
                          {row.href ? (
                            <Link href={row.href} className={styles.sheetRow} onClick={close}>
                              {inner}
                            </Link>
                          ) : (
                            <div className={`${styles.sheetRow} ${styles.sheetRowPending}`}>{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
