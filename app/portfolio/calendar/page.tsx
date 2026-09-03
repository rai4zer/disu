"use client";

/**
 * Calendar — what is coming up for the companies you hold.
 *
 * Grouped by month, the way the reference design does it, because "what is
 * happening in September" is the question people actually bring here; a flat
 * list sorted by date answers it but makes the reader do the grouping.
 *
 * The coverage strip at the bottom is the important part. On the current
 * Finnhub plan, US earnings dates resolve and Nordic ones return 403 — and the
 * audience is Swedish, so the holdings most likely to matter are the ones most
 * likely to be missing. An empty month with no explanation reads as "nothing is
 * happening", which is a worse falsehood than "we cannot see this yet", so the
 * page names the symbols it could not cover.
 */

import { useEffect, useMemo, useState } from "react";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import PortfolioTabs from "../portfolio-tabs";
import styles from "./page.module.css";

type CalendarEvent = {
  id: string;
  symbol: string;
  name: string;
  kind: "earnings";
  date: string;
  session: string | null;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
};

type CoverageEntry = {
  symbol: string;
  status: "ok" | "unsupported" | "failed";
  eventCount: number;
};

export default function CalendarPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [coverage, setCoverage] = useState<CoverageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/portfolio/calendar", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/auth/login?next=/portfolio/calendar";
          return;
        }
        const payload = (await response.json()) as {
          events?: CalendarEvent[];
          coverage?: CoverageEntry[];
        };
        if (cancelled) return;
        setEvents(Array.isArray(payload.events) ? payload.events : []);
        setCoverage(Array.isArray(payload.coverage) ? payload.coverage : []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load the calendar");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Events bucketed by calendar month, in date order. */
  const months = useMemo(() => {
    const buckets = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = event.date.slice(0, 7);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(event);
      else buckets.set(key, [event]);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const monthLabel = (key: string) =>
    new Date(`${key}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric" });

  const dayNumber = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric" });
  const monthShort = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { month: "short" });

  const sessionLabel = (session: string | null) => {
    if (session === "bmo") return isSv ? "före öppning" : "before open";
    if (session === "amc") return isSv ? "efter stängning" : "after close";
    return null;
  };

  const uncovered = coverage.filter((entry) => entry.status !== "ok");

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Portfölj" : "Portfolio"}
        subtitle={
          isSv
            ? "Kommande rapporter för bolagen du äger."
            : "Upcoming reports for the companies you hold."
        }
      >
        <PortfolioTabs />

        {loading ? <UiState kind="loading" message={isSv ? "Läser in kalendern…" : "Loading the calendar…"} /> : null}
        {error ? <UiState kind="error" message={error} /> : null}

        {!loading && !error && months.length === 0 ? (
          <section className={`dsCard ${styles.empty}`}>
            <h2 className={styles.emptyTitle}>
              {isSv ? "Inga bekräftade datum" : "No confirmed dates"}
            </h2>
            <p className={styles.emptyLead}>
              {coverage.length === 0
                ? isSv
                  ? "Lägg till innehav så visas deras rapportdatum här."
                  : "Add holdings and their report dates will appear here."
                : isSv
                  ? "Vi har inga bekräftade datum för dina innehav ännu. Det betyder inte att inget är på gång — se täckningen nedan."
                  : "We have no confirmed dates for your holdings yet. That does not mean nothing is scheduled — see the coverage below."}
            </p>
          </section>
        ) : null}

        {months.map(([key, monthEvents]) => (
          <section key={key} className={styles.month}>
            <h2 className={styles.monthHeading}>{monthLabel(key)}</h2>
            <h3 className={styles.kindHeading}>{isSv ? "Rapporter" : "Reports"}</h3>

            <ul className={styles.eventList}>
              {monthEvents.map((event) => (
                <li key={event.id}>
                  <article className={`dsCard ${styles.event}`}>
                    <div className={styles.eventDate}>
                      <span className={styles.eventDay}>{dayNumber(event.date)}</span>
                      <span className={styles.eventMonth}>{monthShort(event.date)}</span>
                    </div>

                    <div className={styles.eventBody}>
                      <p className={styles.eventName}>
                        {event.name}
                        <span className={styles.eventSymbol}>{event.symbol}</span>
                      </p>
                      <p className={styles.eventDetail}>
                        {event.quarter && event.year
                          ? isSv
                            ? `Delårsrapport Q${event.quarter} ${event.year}`
                            : `Q${event.quarter} ${event.year} results`
                          : isSv
                            ? "Rapport"
                            : "Earnings report"}
                        {sessionLabel(event.session) ? ` · ${sessionLabel(event.session)}` : ""}
                        {/*
                          An estimate is a forecast by other people, so it is
                          labelled as one rather than sitting next to the date
                          as though it were a scheduled fact.
                        */}
                        {event.epsEstimate !== null
                          ? isSv
                            ? ` · väntad vinst/aktie ${event.epsEstimate.toFixed(2)}`
                            : ` · est. EPS ${event.epsEstimate.toFixed(2)}`
                          : ""}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!loading && uncovered.length > 0 ? (
          <section className={`dsCard ${styles.coverage}`}>
            <h2 className="dsCardTitle">{isSv ? "Täckning" : "Coverage"}</h2>
            <p className={styles.coverageLead}>
              {isSv
                ? `Vi kunde inte hämta datum för ${uncovered.length} av ${coverage.length} innehav. Vår nuvarande marknadsdatakälla täcker amerikanska bolag men inte nordiska, och den har inga utdelningar eller bolagsstämmor alls.`
                : `We could not source dates for ${uncovered.length} of ${coverage.length} holdings. Our current market-data plan covers US companies but not Nordic ones, and it carries no dividends or AGMs at all.`}
            </p>
            <ul className={styles.coverageList}>
              {uncovered.map((entry) => (
                <li key={entry.symbol} className={styles.coverageItem}>
                  <span className={styles.coverageSymbol}>{entry.symbol}</span>
                  <span className="dsDelta dsFlat">
                    {entry.status === "unsupported"
                      ? isSv
                        ? "täcks inte"
                        : "not covered"
                      : isSv
                        ? "kunde inte hämtas"
                        : "lookup failed"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Workspace>
    </main>
  );
}
