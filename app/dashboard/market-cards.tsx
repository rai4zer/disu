"use client";

/**
 * The dashboard's market rail: one elongated card per category.
 *
 * Split out of `page.tsx` because these cards share a single shape — a titled
 * card wrapping a grouped list of "name / level / change" rows — and the
 * portfolio half of the dashboard shares none of it. Keeping them here means
 * the eight cards are one component used eight times rather than eight
 * near-copies, so a spacing fix lands everywhere at once.
 *
 * Every card is fed from a route that returns `null` for a reading it could not
 * take, and every renderer below turns `null` into "—". Nothing on this rail
 * carries forward a stale number as if it were current, and nothing renders an
 * unknown change as 0.00% (docs/synthetic-data-policy.md).
 */

import { useEffect, useState } from "react";
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

type BoardPayload = {
  groups: Record<BoardGroupKey, BoardTile[]>;
  stale: boolean;
};

type Mover = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
};

type MoversPayload = {
  gainers: Mover[];
  losers: Mover[];
  covered: number;
  universeSize: number;
};

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
};

/** Refresh cadence. Matches the routes' own 45-60s server cache, so a poll
    that lands early is answered from cache rather than reaching upstream. */
const REFRESH_MS = 60_000;

function deltaClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "dsFlat";
  if (value > 0) return "dsUp";
  if (value < 0) return "dsDown";
  return "dsFlat";
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** A titled card wrapping a grouped list. The single shape all eight share. */
function RailCard({
  title,
  note,
  children
}: {
  title: string;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <article className={`dsCard ${styles.railCard}`}>
      <header className="dsCardHeader">
        <h2 className="dsCardTitle">{title}</h2>
      </header>
      <div className={styles.railBody}>{children}</div>
      {note ? <p className={styles.railNote}>{note}</p> : null}
    </article>
  );
}

function QuoteRows({ tiles, empty }: { tiles: BoardTile[]; empty: string }) {
  if (tiles.length === 0) {
    return <p className={styles.railEmpty}>{empty}</p>;
  }
  return (
    <ul className="dsRows">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <div className="dsRow">
            <span className="dsRowLabel">
              <span className="dsRowName" title={tile.fullName}>
                {tile.label}
              </span>
              {tile.unit ? <span className="dsRowMeta">{tile.unit}</span> : null}
            </span>
            <span className="dsRowValue">
              <span className="dsNum">{tile.price ?? "—"}</span>
              <span className={`dsDelta ${deltaClass(tile.changePct)}`}>{formatPct(tile.changePct)}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MoverRows({ rows, empty }: { rows: Mover[]; empty: string }) {
  if (rows.length === 0) {
    return <p className={styles.railEmpty}>{empty}</p>;
  }
  return (
    <ul className="dsRows">
      {rows.map((row) => (
        <li key={row.symbol}>
          <div className="dsRow">
            <span className="dsRowLabel">
              <span className="dsRowName">{row.name}</span>
              <span className="dsRowMeta">{row.symbol}</span>
            </span>
            <span className="dsRowValue">
              <span className="dsNum">{row.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
              <span className={`dsDelta ${deltaClass(row.changePct)}`}>{formatPct(row.changePct)}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function MarketCards() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [movers, setMovers] = useState<MoversPayload | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Independent surfaces: news failing must not blank the FX card, so each
      // settles on its own rather than sharing one try/catch.
      const [boardResult, moversResult, newsResult] = await Promise.allSettled([
        fetch("/api/market/board", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/market/movers", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/news/feed", { cache: "no-store" }).then((r) => r.json())
      ]);

      if (cancelled) return;

      if (boardResult.status === "fulfilled" && boardResult.value?.groups) {
        setBoard(boardResult.value as BoardPayload);
      }
      if (moversResult.status === "fulfilled" && moversResult.value?.ok) {
        setMovers(moversResult.value as MoversPayload);
      }
      if (newsResult.status === "fulfilled" && Array.isArray(newsResult.value?.items)) {
        setNews((newsResult.value.items as NewsItem[]).slice(0, 7));
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

  const waiting = isSv ? "Hämtar…" : "Loading…";
  const unavailable = isSv ? "Inga kurser just nu." : "No readings right now.";

  const universeNote =
    movers && movers.covered > 0
      ? isSv
        ? `Av ${movers.covered} av ${movers.universeSize} bevakade bolag.`
        : `Of ${movers.covered} of ${movers.universeSize} tracked names.`
      : null;

  return (
    <section className={`dsRail ${styles.rail}`} aria-label={isSv ? "Marknaden" : "Markets"}>
      <RailCard title={isSv ? "Marknader" : "Markets"}>
        <QuoteRows tiles={board?.groups.markets ?? []} empty={loading ? waiting : unavailable} />
      </RailCard>

      <RailCard title={isSv ? "Råvaror" : "Commodities"}>
        <QuoteRows tiles={board?.groups.commodities ?? []} empty={loading ? waiting : unavailable} />
      </RailCard>

      <RailCard title={isSv ? "Krypto" : "Crypto"}>
        <QuoteRows tiles={board?.groups.crypto ?? []} empty={loading ? waiting : unavailable} />
      </RailCard>

      <RailCard title={isSv ? "Valutor" : "FX rates"}>
        <QuoteRows tiles={board?.groups.fx ?? []} empty={loading ? waiting : unavailable} />
      </RailCard>

      <RailCard title={isSv ? "Vinnare" : "Gainers"} note={universeNote}>
        <MoverRows
          rows={movers?.gainers ?? []}
          empty={loading ? waiting : isSv ? "Inga stigande bolag just nu." : "Nothing up right now."}
        />
      </RailCard>

      <RailCard title={isSv ? "Förlorare" : "Losers"} note={universeNote}>
        <MoverRows
          rows={movers?.losers ?? []}
          empty={loading ? waiting : isSv ? "Inga fallande bolag just nu." : "Nothing down right now."}
        />
      </RailCard>

      <article className={`dsCard ${styles.railCard} ${styles.newsCard}`}>
        <header className="dsCardHeader">
          <h2 className="dsCardTitle">{isSv ? "Marknadsnyheter" : "Market news"}</h2>
        </header>
        <div className={styles.railBody}>
          {news.length === 0 ? (
            <p className={styles.railEmpty}>{loading ? waiting : isSv ? "Inga nyheter just nu." : "No news right now."}</p>
          ) : (
            <ul className="dsRows">
              {news.map((item) => (
                <li key={`${item.link}-${item.publishedAt}`}>
                  <a className={`dsRow ${styles.newsRow}`} href={item.link} target="_blank" rel="noreferrer">
                    <span className="dsRowLabel">
                      <span className={styles.newsTitle}>{item.title}</span>
                      <span className="dsRowMeta">{item.source}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>
    </section>
  );
}
