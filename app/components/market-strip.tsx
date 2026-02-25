"use client";

import Link from "next/link";
import LogoutButton from "@/app/components/logout-button";
import LanguageToggle from "@/app/components/language-toggle";
import ThemeToggle from "@/app/components/theme-toggle";
import { useLanguage } from "@/app/i18n/language";
import { getUiCopy } from "@/app/i18n/ui-copy";
import styles from "./market-strip.module.css";

const ITEMS = [
  { label: "OMXS30", value: "+0.71%", time: "17:30" },
  { label: "DJUS", value: "+0.64%", time: "22:00" },
  { label: "SPX", value: "-0.12%", time: "16:00" }
];

type Props = {
  action?: "signout" | "signin";
  withSidebarOffset?: boolean;
};

export default function MarketStrip({ action = "signout", withSidebarOffset = false }: Props) {
  const { language } = useLanguage();
  const copy = getUiCopy(language);

  return (
    <div className={styles.strip} role="status" aria-label={copy.market.ariaLabel}>
      <div className={withSidebarOffset ? `${styles.inner} ${styles.innerWithSidebar}` : styles.inner}>
        <div className={styles.rail}>
          <div className={styles.tickers}>
            {ITEMS.map((item) => {
              const positive = item.value.startsWith("+");
              return (
                <p key={item.label} className={styles.item}>
                  <span className={styles.name}>{item.label}</span>
                  <span className={positive ? styles.up : styles.down}>{item.value}</span>
                  <span className={styles.time}>{item.time}</span>
                </p>
              );
            })}
          </div>
        </div>
        <div className={styles.controls}>
          <LanguageToggle />
          <ThemeToggle />
          {action === "signin" ? (
            <Link href="/auth/login" className={styles.signOut}>
              {copy.market.signIn}
            </Link>
          ) : (
            <LogoutButton className={styles.signOut} />
          )}
        </div>
      </div>
    </div>
  );
}
