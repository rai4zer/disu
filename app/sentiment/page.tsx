"use client";

/**
 * Market desk.
 *
 * This page previously generated every number it displayed. `stableChange()`
 * and `stablePrice()` hashed a seed against the date to produce a plausible
 * percentage and a plausible level, so "OMX Helsinki 25 +1.42%" was a hash of
 * the string "OMXH25" and nothing else — the exact pattern ROADMAP §2.1 removed
 * from the dashboard, still live here because the synthetic-data test only ever
 * guarded `app/dashboard/page.tsx`.
 *
 * Both functions are gone. Every reading below comes from `/api/market/board`
 * and `/api/news/feed`, and anything those cannot supply renders "—". A market
 * we could not read is a market we do not report on.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

type BoardTile = {
  label: string;
  fullName: string;
  unit: string | null;
  price: string | null;
  changePct: number | null;
  asOf: string | null;
};

type BoardGroupKey = "markets" | "commodities" | "crypto" | "fx";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
};

type Mover = { symbol: string; name: string; price: number; changePct: number };

const REFRESH_MS = 60_000;

function deltaClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "dsFlat";
  return value > 0 ? "dsUp" : value < 0 ? "dsDown" : "dsFlat";
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function QuoteTable({
  title,
  tiles,
  loading,
  isSv
}: {
  title: string;
  tiles: BoardTile[];
  loading: boolean;
  isSv: boolean;
}) {
  return (
    <article className={`dsCard ${styles.card}`}>
      <header className="dsCardHeader">
        <h2 className="dsCardTitle">{title}</h2>
      </header>
      {tiles.length === 0 ? (
        <p className={styles.empty}>
          {loading ? (isSv ? "Hämtar…" : "Loading…") : isSv ? "Inga kurser just nu." : "No readings right now."}
        </p>
      ) : (
        <ul className="dsRows">
          {tiles.map((tile) => (
            <li key={tile.label}>
              <div className="dsRow">
                <span className="dsRowLabel">
                  <span className="dsRowName" title={tile.fullName}>
                    {tile.label}
                  </span>
                  <span className="dsRowMeta">{tile.unit ?? formatTime(tile.asOf)}</span>
                </span>
                <span className="dsRowValue">
                  <span className="dsNum">{tile.price ?? "—"}</span>
                  <span className={`dsDelta ${deltaClass(tile.changePct)}`}>{formatPct(tile.changePct)}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function MarketDeskPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [groups, setGroups] = useState<Record<BoardGroupKey, BoardTile[]> | null>(null);
  const [movers, setMovers] = useState<{ gainers: Mover[]; losers: Mover[]; covered: number; universeSize: number } | null>(
    null
  );
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [boardResult, moversResult, newsResult] = await Promise.allSettled([
        fetch("/api/market/board", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/market/movers", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/news/feed", { cache: "no-store" }).then((r) => r.json())
      ]);

      if (cancelled) return;

      if (boardResult.status === "fulfilled" && boardResult.value?.groups) {
        setGroups(boardResult.value.groups);
      }
      if (moversResult.status === "fulfilled" && moversResult.value?.ok) {
        setMovers(moversResult.value);
      }
      if (newsResult.status === "fulfilled" && Array.isArray(newsResult.value?.items)) {
        setNews(newsResult.value.items.slice(0, 14) as NewsItem[]);
      }
      setLoading(false);
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const moverNote =
    movers && movers.covered > 0
      ? isSv
        ? `Av ${movers.covered} av ${movers.universeSize} bevakade bolag.`
        : `Of ${movers.covered} of ${movers.universeSize} tracked names.`
      : null;

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Marknadsdesk" : "Market desk"}
        subtitle={
          isSv
            ? "Index, råvaror, krypto, valutor och marknadsnyheter i ett samlat läge."
            : "Indices, commodities, crypto, currencies and market news in one board."
        }
      >
        <div className={styles.leadRow}>
          <Link href="/placera" className="dsChip">
            {isSv ? "Öppna sentimentanalys" : "Open sentiment analysis"}
          </Link>
        </div>

        <section className={`dsRail ${styles.rail}`}>
          <QuoteTable title={isSv ? "Index" : "Indices"} tiles={groups?.markets ?? []} loading={loading} isSv={isSv} />
          <QuoteTable
            title={isSv ? "Råvaror" : "Commodities"}
            tiles={groups?.commodities ?? []}
            loading={loading}
            isSv={isSv}
          />
          <QuoteTable title={isSv ? "Krypto" : "Crypto"} tiles={groups?.crypto ?? []} loading={loading} isSv={isSv} />
          <QuoteTable title={isSv ? "Valutor" : "Currencies"} tiles={groups?.fx ?? []} loading={loading} isSv={isSv} />
        </section>

        <section className={`dsRail ${styles.rail}`}>
          {(
            [
              { key: "gainers" as const, title: isSv ? "Vinnare" : "Gainers", rows: movers?.gainers ?? [] },
              { key: "losers" as const, title: isSv ? "Förlorare" : "Losers", rows: movers?.losers ?? [] }
            ]
          ).map((column) => (
            <article key={column.key} className={`dsCard ${styles.card}`}>
              <header className="dsCardHeader">
                <h2 className="dsCardTitle">{column.title}</h2>
              </header>
              {column.rows.length === 0 ? (
                <p className={styles.empty}>
                  {loading ? (isSv ? "Hämtar…" : "Loading…") : isSv ? "Inget att visa." : "Nothing to show."}
                </p>
              ) : (
                <ul className="dsRows">
                  {column.rows.map((row) => (
                    <li key={row.symbol}>
                      <div className="dsRow">
                        <span className="dsRowLabel">
                          <span className="dsRowName">{row.name}</span>
                          <span className="dsRowMeta">{row.symbol}</span>
                        </span>
                        <span className="dsRowValue">
                          <span className="dsNum">
                            {row.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          </span>
                          <span className={`dsDelta ${deltaClass(row.changePct)}`}>{formatPct(row.changePct)}</span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {moverNote ? <p className={styles.note}>{moverNote}</p> : null}
            </article>
          ))}
        </section>

        <section className={`dsCard ${styles.news}`}>
          <header className="dsCardHeader">
            <h2 className="dsCardTitle">{isSv ? "Nyheter" : "News"}</h2>
          </header>
          {news.length === 0 ? (
            loading ? (
              <UiState kind="loading" message={isSv ? "Hämtar nyheter…" : "Loading news…"} />
            ) : (
              <p className={styles.empty}>{isSv ? "Inga nyheter just nu." : "No news right now."}</p>
            )
          ) : (
            <ul className={`dsRows ${styles.newsList}`}>
              {news.map((item) => (
                <li key={`${item.link}-${item.publishedAt}`}>
                  <a className={`dsRow ${styles.newsRow}`} href={item.link} target="_blank" rel="noreferrer">
                    <span className="dsRowLabel">
                      <span className={styles.newsTitle}>{item.title}</span>
                      <span className="dsRowMeta">
                        {item.source} · {formatTime(item.publishedAt)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Workspace>
    </main>
  );
}
