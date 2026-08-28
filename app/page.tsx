"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import CompoundCalculator from "./components/compound-calculator";
import MarketStrip from "./components/market-strip";
import enCopy from "./i18n/en.json";
import svCopy from "./i18n/sv.json";
import { useLanguage } from "@/app/i18n/language";
import { useFunnelEvent } from "@/app/lib/analytics/track";
import styles from "./page.module.css";

const copy = {
  en: enCopy,
  sv: svCopy
};

export default function HomePage() {
  const { language } = useLanguage();
  const content = copy[language];
  const rootRef = useRef<HTMLElement>(null);

  // The top of the funnel, and the only event most visitors will ever produce.
  // Nothing is sent — and no identifier is created — unless analytics consent is
  // already recorded; if it arrives later from the banner, this fires then.
  useFunnelEvent("landing_view");

  useEffect(() => {
    const reveals = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(`.${styles.reveal}`) ?? []
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      reveals.forEach((element) => element.classList.add(styles.revealed));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle(styles.revealed, entry.isIntersecting);
        });
      },
      { threshold: 0.25, rootMargin: "0px 0px -10% 0px" }
    );

    reveals.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [language]);

  return (
    <main className={styles.page} ref={rootRef}>
      <MarketStrip action="signin" withSidebarOffset />
      <section className={styles.hero}>
        <div className={styles.brand}>
          <h1 className={styles.mark}>{content.brand}</h1>
          <span className={styles.cuneiform} aria-hidden="true">
            𒁲𒋢
          </span>
        </div>
        <div className={styles.copy}>
          <p className={styles.lead}>{content.landingLead}</p>
          <div className={styles.ctaRow}>
            <Link href="/auth/login?mode=register" className={styles.ctaPrimary}>
              {content.landingCreateAccount}
            </Link>
            <Link href="/auth/login" className={styles.ctaSecondary}>
              {content.landingHaveAccount}
            </Link>
          </div>
        </div>
      </section>

      <section
        className={styles.modules}
        aria-label={language === "sv" ? "Funktioner" : "Features"}
      >
        {content.modules.map((module, index) => {
          const imageRight = index % 2 === 1;
          return (
            <article
              key={module.image}
              className={`${styles.module} ${imageRight ? styles.imageRight : ""} ${styles.reveal}`}
            >
              <div className={styles.moduleMedia}>
                <img
                  src={`/modules/${module.image}.svg`}
                  alt={module.title}
                  className={styles.moduleImage}
                  loading="lazy"
                />
              </div>
              <div className={styles.moduleText}>
                <h2 className={styles.moduleTitle}>{module.title}</h2>
                <p className={styles.moduleBody}>{module.body}</p>
                {/* wrapper carries the scroll-reveal so the link keeps its own
                    fast hover transition */}
                <div className={styles.moduleCtaWrap}>
                  <Link href="/auth/login?mode=register" className={styles.moduleCta}>
                    {content.landingModuleCta}
                    <span className={styles.moduleCtaArrow} aria-hidden="true">
                      →
                    </span>
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className={`${styles.ctaBand} ${styles.reveal}`}>
        <Link href="/auth/login?mode=register" className={styles.ctaBandButton}>
          {content.landingFinalCta}
        </Link>
        <p className={styles.ctaBandNote}>{content.landingFinalCtaNote}</p>
      </section>

      <section
        className={styles.calculator}
        aria-label={language === "sv" ? "Ränta på ränta" : "Compound calculator"}
      >
        <CompoundCalculator copy={content.calculator} />
      </section>
    </main>
  );
}
