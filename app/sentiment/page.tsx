"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

type IndexItem = {
  label: string;
  fullName: string;
  price: string;
  value: string;
  time: string;
};

type NewsItem = {
  title: string;
  link: string;
  source: "FT" | "WSJ" | "NYT" | "Google";
  publishedAt: string;
};

type QuoteRow = {
  label: string;
  changePct: number;
  last: number;
  time: string;
};

function stableChange(seed: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const source = `${seed}:${day}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 33 + source.charCodeAt(i)) >>> 0;
  }
  const raw = ((hash % 760) / 100) - 3.8;
  return Math.round(raw * 100) / 100;
}

function stablePrice(seed: string, base: number): number {
  const day = new Date().toISOString().slice(0, 10);
  const source = `${seed}:${day}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  const drift = ((hash % 1800) - 900) / 1000;
  return Math.max(0.01, base + drift);
}

function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function todayTime(): string {
  return new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function SentimentPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [indices, setIndices] = useState<IndexItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [indicesRes, newsRes] = await Promise.all([
          fetch("/api/market/indices", { cache: "no-store" }),
          fetch("/api/news/feed", { cache: "no-store" })
        ]);

        const indicesJson = (await indicesRes.json().catch(() => ({}))) as { items?: IndexItem[] };
        const newsJson = (await newsRes.json().catch(() => ({}))) as { items?: NewsItem[] };

        if (!cancelled) {
          setIndices(Array.isArray(indicesJson.items) ? indicesJson.items : []);
          setNews(Array.isArray(newsJson.items) ? newsJson.items.slice(0, 12) : []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const nordic = useMemo<QuoteRow[]>(() => {
    const now = todayTime();
    const omx = indices.find((item) => item.label === "OMXS30");
    return [
      {
        label: "OMX Stockholm 30",
        changePct: omx ? Number(omx.value.replace("%", "")) : stableChange("OMXS30"),
        last: omx ? Number(omx.price.replace(/,/g, "")) || 3077.21 : 3077.21,
        time: omx?.time ?? now
      },
      { label: "OMX Helsinki 25", changePct: stableChange("OMXH25"), last: stablePrice("OMXH25", 5976.13), time: now },
      { label: "OMX Copenhagen 25", changePct: stableChange("OMXC25"), last: stablePrice("OMXC25", 1720.09), time: now },
      { label: "Oslo Børs GI", changePct: stableChange("OSEGI"), last: stablePrice("OSEGI", 1905.71), time: now }
    ];
  }, [indices]);

  const world = useMemo<QuoteRow[]>(() => {
    const now = todayTime();
    const dji = indices.find((item) => item.label === "DJI");
    const nasdaq = indices.find((item) => item.label === "NASDAQ");
    return [
      {
        label: "Dow Jones Industrial",
        changePct: dji ? Number(dji.value.replace("%", "")) : stableChange("DJI"),
        last: dji ? Number(dji.price.replace(/,/g, "")) || 47716.96 : 47716.96,
        time: dji?.time ?? now
      },
      {
        label: "Nasdaq Composite",
        changePct: nasdaq ? Number(nasdaq.value.replace("%", "")) : stableChange("IXIC"),
        last: nasdaq ? Number(nasdaq.price.replace(/,/g, "")) || 24761.03 : 24761.03,
        time: nasdaq?.time ?? now
      },
      { label: "DAX", changePct: stableChange("DAX"), last: stablePrice("DAX", 23815.75), time: now },
      { label: "CAC 40", changePct: stableChange("CAC40"), last: stablePrice("CAC40", 9272.06), time: now }
    ];
  }, [indices]);

  const commodities = useMemo<QuoteRow[]>(() => {
    const now = todayTime();
    return [
      { label: isSv ? "Guld" : "Gold", changePct: stableChange("XAU"), last: stablePrice("XAU", 5075.3), time: now },
      { label: isSv ? "Silver" : "Silver", changePct: stableChange("XAG"), last: stablePrice("XAG", 82.01), time: now },
      { label: isSv ? "Olja" : "Crude Oil", changePct: stableChange("BRENT"), last: stablePrice("BRENT", 84.78), time: now },
      { label: isSv ? "Koppar" : "Copper", changePct: stableChange("COPPER"), last: stablePrice("COPPER", 13.01), time: now }
    ];
  }, [isSv]);

  const currencies = useMemo<QuoteRow[]>(() => {
    const now = todayTime();
    return [
      { label: "USD/SEK", changePct: stableChange("USDSEK"), last: stablePrice("USDSEK", 9.2638), time: now },
      { label: "EUR/SEK", changePct: stableChange("EURSEK"), last: stablePrice("EURSEK", 10.73), time: now },
      { label: "NOK/SEK", changePct: stableChange("NOKSEK"), last: stablePrice("NOKSEK", 0.9552), time: now },
      { label: "EUR/USD", changePct: stableChange("EURUSD"), last: stablePrice("EURUSD", 1.1585), time: now }
    ];
  }, []);

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Marknadsdesk" : "Market desk"}
        subtitle={
          isSv
            ? "Börsen idag: index, råvaror, valutor och marknadsnyheter i ett samlat läge."
            : "Market today: indices, commodities, currencies, and market news in one board."
        }
      >
        <section className={`${styles.hero} appSection`}>
          <div className={styles.heroHeader}>
            <h2>{isSv ? "Börsen idag" : "Market now"}</h2>
            <Link href="/placera" className={styles.heroLink}>
              {isSv ? "Öppna sentimentanalys" : "Open sentiment analysis"}
            </Link>
          </div>
          <div className={styles.indexPills}>
            {indices.map((item) => {
              const change = Number(item.value.replace("%", ""));
              return (
                <article key={item.label} className={styles.pill}>
                  <div>
                    <p className={styles.pillLabel}>{item.label}</p>
                    <p className={styles.pillPrice}>{item.price}</p>
                  </div>
                  <p className={change >= 0 ? styles.pos : styles.neg}>{item.value}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.grid}>
          <article className={`${styles.card} appSection`}>
            <h3>{isSv ? "Nordiska index" : "Nordic indices"}</h3>
            <table className={styles.table}>
              <thead>
                <tr><th>{isSv ? "Index" : "Index"}</th><th>+/-</th><th>{isSv ? "Senast" : "Last"}</th><th>{isSv ? "Tid" : "Time"}</th></tr>
              </thead>
              <tbody>
                {nordic.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.changePct >= 0 ? styles.pos : styles.neg}>{formatPct(row.changePct)}</td>
                    <td>{formatNumber(row.last)}</td>
                    <td>{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className={`${styles.card} appSection`}>
            <h3>{isSv ? "Världsindex" : "Global indices"}</h3>
            <table className={styles.table}>
              <thead>
                <tr><th>{isSv ? "Index" : "Index"}</th><th>+/-</th><th>{isSv ? "Senast" : "Last"}</th><th>{isSv ? "Tid" : "Time"}</th></tr>
              </thead>
              <tbody>
                {world.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.changePct >= 0 ? styles.pos : styles.neg}>{formatPct(row.changePct)}</td>
                    <td>{formatNumber(row.last)}</td>
                    <td>{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className={`${styles.card} appSection`}>
            <h3>{isSv ? "Råvaror" : "Commodities"}</h3>
            <table className={styles.table}>
              <thead>
                <tr><th>{isSv ? "Råvara" : "Commodity"}</th><th>+/-</th><th>{isSv ? "Senast" : "Last"}</th><th>{isSv ? "Tid" : "Time"}</th></tr>
              </thead>
              <tbody>
                {commodities.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.changePct >= 0 ? styles.pos : styles.neg}>{formatPct(row.changePct)}</td>
                    <td>{formatNumber(row.last)}</td>
                    <td>{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className={`${styles.card} appSection`}>
            <h3>{isSv ? "Valutor" : "Currencies"}</h3>
            <table className={styles.table}>
              <thead>
                <tr><th>{isSv ? "Valuta" : "Pair"}</th><th>+/-</th><th>{isSv ? "Senast" : "Last"}</th><th>{isSv ? "Tid" : "Time"}</th></tr>
              </thead>
              <tbody>
                {currencies.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.changePct >= 0 ? styles.pos : styles.neg}>{formatPct(row.changePct)}</td>
                    <td>{formatNumber(row.last, 4)}</td>
                    <td>{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>

        <section className={`${styles.news} appSection`}>
          <div className={styles.newsHeader}>
            <h3>{isSv ? "Nyheter" : "News"}</h3>
            <span>{loading ? (isSv ? "Laddar..." : "Loading...") : null}</span>
          </div>
          <div className={styles.newsList}>
            {news.length === 0 && !loading ? <p className={styles.muted}>{isSv ? "Inga nyheter just nu." : "No news right now."}</p> : null}
            {news.map((item) => (
              <a key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer" className={styles.newsItem}>
                <div className={styles.newsMeta}>
                  <span>{item.source}</span>
                  <span>{formatTime(item.publishedAt)}</span>
                </div>
                <p>{item.title}</p>
              </a>
            ))}
          </div>
        </section>
      </Workspace>
    </main>
  );
}
