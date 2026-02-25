"use client";

import { useEffect } from "react";
import DisuLogo from "../components/DisuLogo";
import MarketStrip from "./components/market-strip";
import enCopy from "./i18n/en.json";
import svCopy from "./i18n/sv.json";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

const copy = {
  en: enCopy,
  sv: svCopy
};

function AnimatedHeroSvg() {
  return (
    <svg viewBox="0 0 460 180" className={styles.heroSvg} role="img" aria-label="Animated market overview">
      <defs>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--navy)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--navy)" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <circle cx="56" cy="54" r="30" className={styles.ringOne} />
      <circle cx="382" cy="120" r="38" className={styles.ringTwo} />
      <path d="M20 132 C 84 122, 108 58, 164 78 C 220 98, 254 142, 314 106 C 364 76, 396 84, 440 52" className={styles.trendPath} />
      <circle cx="164" cy="78" r="5" className={styles.pulseDot} />
      <circle cx="314" cy="106" r="5" className={styles.pulseDotDelayed} />
    </svg>
  );
}

function PortfolioConceptSvg() {
  return (
    <svg viewBox="0 0 320 150" className={styles.conceptSvg} aria-hidden="true">
      <rect x="12" y="16" width="296" height="118" rx="12" className={styles.conceptPanel} />
      <rect x="28" y="34" width="128" height="18" rx="7" className={styles.conceptChip} />
      <rect x="28" y="62" width="168" height="12" rx="6" className={styles.conceptBarA} />
      <rect x="28" y="81" width="146" height="12" rx="6" className={styles.conceptBarB} />
      <rect x="28" y="100" width="118" height="12" rx="6" className={styles.conceptBarC} />
      <circle cx="250" cy="83" r="26" className={styles.conceptGauge} />
      <path d="M231 83 L247 96 L272 68" className={styles.conceptCheck} />
    </svg>
  );
}

function SentimentConceptSvg() {
  return (
    <svg viewBox="0 0 320 150" className={styles.conceptSvg} aria-hidden="true">
      <rect x="12" y="16" width="296" height="118" rx="12" className={styles.conceptPanel} />
      <path d="M30 110 C72 88, 88 102, 126 86 C160 72, 188 64, 218 76 C246 87, 270 79, 292 58" className={styles.conceptTrend} />
      <circle cx="126" cy="86" r="4" className={styles.conceptDot} />
      <circle cx="218" cy="76" r="4" className={styles.conceptDotDelayed} />
      <rect x="28" y="36" width="74" height="14" rx="7" className={styles.sentimentPositive} />
      <rect x="110" y="36" width="84" height="14" rx="7" className={styles.sentimentNeutral} />
      <rect x="202" y="36" width="90" height="14" rx="7" className={styles.sentimentNegative} />
    </svg>
  );
}

function PrimerConceptSvg() {
  return (
    <svg viewBox="0 0 320 150" className={styles.conceptSvg} aria-hidden="true">
      <rect x="12" y="16" width="296" height="118" rx="12" className={styles.conceptPanel} />
      <rect x="30" y="34" width="182" height="14" rx="7" className={styles.primerTitle} />
      <rect x="30" y="58" width="260" height="9" rx="4" className={styles.primerLineOne} />
      <rect x="30" y="74" width="242" height="9" rx="4" className={styles.primerLineTwo} />
      <rect x="30" y="90" width="228" height="9" rx="4" className={styles.primerLineThree} />
      <rect x="30" y="106" width="208" height="9" rx="4" className={styles.primerLineFour} />
    </svg>
  );
}

function PriceConceptSvg() {
  return (
    <svg viewBox="0 0 320 150" className={styles.conceptSvg} aria-hidden="true">
      <rect x="12" y="16" width="296" height="118" rx="12" className={styles.conceptPanel} />
      <line x1="36" y1="112" x2="288" y2="112" className={styles.axisLine} />
      <rect x="56" y="78" width="24" height="34" rx="4" className={styles.candleOne} />
      <rect x="92" y="66" width="24" height="46" rx="4" className={styles.candleTwo} />
      <rect x="128" y="84" width="24" height="28" rx="4" className={styles.candleThree} />
      <rect x="164" y="56" width="24" height="56" rx="4" className={styles.candleFour} />
      <rect x="200" y="70" width="24" height="42" rx="4" className={styles.candleFive} />
      <rect x="236" y="48" width="24" height="64" rx="4" className={styles.candleSix} />
    </svg>
  );
}

function FeatureConcept({ index }: { index: number }) {
  if (index === 0) {
    return <PortfolioConceptSvg />;
  }

  if (index === 1) {
    return <SentimentConceptSvg />;
  }

  if (index === 2) {
    return <PrimerConceptSvg />;
  }

  return <PriceConceptSvg />;
}

export default function HomePage() {
  const { language } = useLanguage();
  const content = copy[language];

  useEffect(() => {
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(`.${styles.reveal}`));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      reveals.forEach((element) => element.classList.add(styles.revealed));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    reveals.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [language]);

  return (
    <main className={styles.page}>
      <MarketStrip action="signin" withSidebarOffset />
      <div className={styles.pageBody}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <DisuLogo className={`${styles.brandLogo} h-10 w-auto`} title="DISU" />
          </header>

          <section className={`${styles.hero} ${styles.reveal}`}>
            <p className={styles.kicker}>{content.kicker}</p>
            <h1 className={styles.title}>{content.title}</h1>
            <p className={styles.subtitle}>{content.subtitle}</p>
            <AnimatedHeroSvg />
          </section>

          <section className={styles.sections} aria-label={language === "sv" ? "Plattformsfunktioner" : "Platform features"}>
            {content.features.map((feature, index) => (
              <div key={index} className={`${styles.featureStack} ${styles.reveal}`}>
                <article className={styles.featureCard}>
                  <div className={styles.featureHeading}>
                    <FeatureConcept index={index} />
                  </div>
                  <h2>{feature.title}</h2>
                  <p>{feature.description}</p>
                </article>

                {index < content.features.length - 1 ? (
                  <div className={styles.demoCard}>
                    <label className={styles.srOnly} htmlFor={`email-${index}`}>
                      {content.workEmail}
                    </label>
                    <div className={styles.demoRow}>
                      <input
                        id={`email-${index}`}
                        type="email"
                        placeholder={content.emailPlaceholder}
                        className={styles.emailInput}
                      />
                      <button type="button" className={styles.demoButton}>
                        {content.requestDemo}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
