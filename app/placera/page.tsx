"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";
import type { PlaceraEntity, PlaceraPayload, SentimentSummary } from "./types";
import Workspace from "@/app/components/workspace";
import { resolveTickerSymbol } from "@/app/lib/ticker-suggestions";
import TickerAutocomplete from "@/app/components/ticker-autocomplete";
import { useLanguage } from "@/app/i18n/language";

function formatDate(value: string | null, isSv: boolean): string {
  if (!value) {
    return isSv ? "Ej tillgängligt" : "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(isSv ? "sv-SE" : "en-US");
}

function badgeLabel(badge: SentimentSummary["badge"], isSv: boolean): string {
  if (badge === "armageddon") return "Armageddon";
  if (badge === "strong_bear") return isSv ? "Starkt björnläge" : "Strong Bear";
  if (badge === "bear") return isSv ? "Björnläge" : "Bear";
  if (badge === "bull") return isSv ? "Tjurmarknad" : "Bull";
  if (badge === "strong_bull") return isSv ? "Stark tjurmarknad" : "Strong Bull";
  if (badge === "exuberance") return isSv ? "Eufori" : "Euphoria";
  return isSv ? "Neutral" : "Neutral";
}

function badgeFigure(
  badge: SentimentSummary["badge"]
): "bear_walk" | "bear_attack" | "bull_walk" | "bull_gore" | "mushroom" | "rocket" | "neutral" {
  if (badge === "armageddon") return "mushroom";
  if (badge === "strong_bear") return "bear_attack";
  if (badge === "bear") return "bear_walk";
  if (badge === "strong_bull") return "bull_gore";
  if (badge === "bull") return "bull_walk";
  if (badge === "exuberance") return "rocket";
  return "neutral";
}

function BadgeIcon({ figure }: { figure: ReturnType<typeof badgeFigure> }) {
  if (figure === "mushroom") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconMushroom}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <path d="M14 30 C14 19 22 12 32 12 C42 12 50 19 50 30 C50 38 43 43 35 44 C34 46 36 49 39 52 H25 C28 49 30 46 29 44 C21 43 14 38 14 30 Z" />
          <path d="M29 30 L35 30 L34 44 L30 44 Z" />
          <path d="M23 52 H41" />
        </g>
      </svg>
    );
  }

  if (figure === "bear_walk") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconWalk}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <rect x="20" y="28" width="28" height="14" rx="7" />
          <circle cx="18" cy="31" r="6" />
          <circle cx="14" cy="25" r="2.5" />
          <circle cx="22" cy="25" r="2.5" />
          <path className={styles.legA} d="M24 42 V50" />
          <path className={styles.legB} d="M32 42 V50" />
          <path className={styles.legA} d="M40 42 V50" />
          <path d="M48 32 C51 32 52 30 52 28" />
        </g>
      </svg>
    );
  }

  if (figure === "bear_attack") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconBearAttack}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <circle cx="32" cy="31" r="10" />
          <circle cx="28" cy="21" r="3" />
          <circle cx="36" cy="21" r="3" />
          <path d="M27 33 H37" />
          <path className={styles.pawLeft} d="M19 20 L25 27" />
          <path className={styles.pawRight} d="M45 20 L39 27" />
          <path d="M26 42 V50" />
          <path d="M38 42 V50" />
        </g>
      </svg>
    );
  }

  if (figure === "bull_walk") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconWalk}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <rect x="20" y="29" width="28" height="13" rx="6.5" />
          <circle cx="18" cy="31" r="6" />
          <path d="M12 27 C13 22 17 21 21 25" />
          <path d="M17 25 C21 21 25 22 26 27" />
          <path className={styles.legA} d="M24 42 V50" />
          <path className={styles.legB} d="M33 42 V50" />
          <path className={styles.legA} d="M42 42 V50" />
          <path d="M48 33 C51 33 52 31 52 29" />
        </g>
      </svg>
    );
  }

  if (figure === "bull_gore") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconBullGore}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <circle cx="33" cy="32" r="10" />
          <path d="M27 24 C24 18 18 17 14 21" />
          <path d="M39 24 C42 18 48 17 52 21" />
          <path d="M27 34 H39" />
          <path d="M28 42 V50" />
          <path d="M38 42 V50" />
          <path className={styles.goreMotion} d="M46 30 H56" />
          <path className={styles.goreMotion} d="M48 35 H58" />
        </g>
      </svg>
    );
  }

  if (figure === "rocket") {
    return (
      <svg viewBox="0 0 64 64" className={`${styles.badgeIcon} ${styles.iconRocket}`} aria-hidden="true">
        <g className={styles.iconCore}>
          <path d="M32 10 C38 16 39 28 32 41 C25 28 26 16 32 10 Z" />
          <circle cx="32" cy="22" r="3" />
          <path d="M26 33 L20 39 L27 39" />
          <path d="M38 33 L44 39 L37 39" />
          <path className={styles.flame} d="M30 41 H34 L32 52 Z" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" className={styles.badgeIcon} aria-hidden="true">
      <g className={styles.iconCore}>
        <circle cx="32" cy="32" r="18" />
        <path d="M24 32 H40" />
      </g>
    </svg>
  );
}

function bucketTitle(bucket: PlaceraEntity["sentiment_bucket"], isSv: boolean): string {
  if (bucket === "positive") return isSv ? "Positiv" : "Positive";
  if (bucket === "negative") return isSv ? "Negativ" : "Negative";
  return isSv ? "Neutral" : "Neutral";
}

export default function PlaceraPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const [companyLookup, setCompanyLookup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlaceraPayload | null>(null);

  const companyDisplay = useMemo(() => {
    if (!data) {
      return "-";
    }
    return data.companyQuery || companyLookup.trim() || (isSv ? "Valt bolag" : "Selected company");
  }, [companyLookup, data, isSv]);

  const grouped = useMemo(() => {
    if (!data) {
      return { positive: [], neutral: [], negative: [] } as Record<
        PlaceraEntity["sentiment_bucket"],
        PlaceraEntity[]
      >;
    }

    return {
      positive: data.entities.filter((entity) => entity.sentiment_bucket === "positive"),
      neutral: data.entities.filter((entity) => entity.sentiment_bucket === "neutral"),
      negative: data.entities.filter((entity) => entity.sentiment_bucket === "negative")
    };
  }, [data]);

  const repliesCount = useMemo(
    () => data?.entities.filter((entity) => entity.entity_type === "reply").length ?? 0,
    [data]
  );
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const lookupRaw = companyLookup.trim();
      let lookup = (resolveTickerSymbol(lookupRaw) ?? lookupRaw).trim();
      if (!/^[A-Z0-9.\-]{1,12}$/i.test(lookup) && lookupRaw.length >= 2) {
        try {
          const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(lookupRaw)}&limit=1`);
          const payload = (await response.json()) as { ok: boolean; suggestions?: Array<{ symbol?: string }> };
          if (payload.ok) {
            const firstSymbol = String(payload.suggestions?.[0]?.symbol ?? "").trim().toUpperCase();
            if (/^[A-Z0-9.\-]{1,12}$/.test(firstSymbol)) {
              lookup = firstSymbol;
            }
          }
        } catch {
          // keep current lookup if suggestions cannot be fetched.
        }
      }
      if (lookup.length === 0) {
        throw new Error(isSv ? "Bolag krävs" : "Company lookup is required");
      }
      params.set(lookup.includes("-") ? "companyId" : "companyQuery", lookup);

      const response = await fetch(`/api/placera?${params.toString()}`);
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json?.error ?? (isSv ? "Kunde inte hämta Placera-data" : "Failed to fetch Placera data"));
      }

      setData(json as PlaceraPayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : isSv ? "Okänt fel" : "Unknown error";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Sentiment" : "Sentiment"}
        subtitle={isSv ? "Se hur marknadens samtal om ett bolag utvecklas." : "See how market conversations around a company are trending."}
      >
        <form className={`${styles.form} appForm appSection`} onSubmit={onSubmit}>
          <div className={`${styles.field} appField`}>
            <label htmlFor="companyLookup">{isSv ? "Ticker" : "Ticker"}</label>
            <TickerAutocomplete
              id="companyLookup"
              className="appInput"
              value={companyLookup}
              onChange={setCompanyLookup}
              placeholder={isSv ? "AAPL eller Apple" : "AAPL or Apple"}
              required
            />
          </div>

          <button className={`${styles.button} appButton`} type="submit" disabled={loading}>
            {loading ? (isSv ? "Laddar..." : "Loading...") : isSv ? "Kör" : "Run"}
          </button>
        </form>

        <p className={styles.windowHint}>
          {isSv ? "Fast fönster: senaste 90 dagarna av inlägg och svar." : "Fixed window: last 90 days of posts and replies."}
        </p>

        {error ? <div className={`${styles.error} appError`}>{error}</div> : null}

        {data ? (
          <>
            <section className={styles.overview}>
              <article className={styles.badgeCard}>
                <div className={styles.badgeArtWrap}>
                  <BadgeIcon figure={badgeFigure(data.sentiment.badge)} />
                </div>
                <div className={styles.badgeMeta}>
                  <p className={styles.badgeTitle}>{isSv ? "Marknadsläge" : "Market Mood"}</p>
                  <h3>{badgeLabel(data.sentiment.badge, isSv)}</h3>
                  <p className={styles.badgeSubline}>{isSv ? "Poäng" : "Score"} {data.sentiment.score}</p>
                </div>
              </article>

              <article className={styles.kpiGrid}>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Bolag" : "Company"}</span>
                  <strong>{companyDisplay}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Urvalsstorlek" : "Sample Size"}</span>
                  <strong>{data.sentiment.total_entities}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Inlägg" : "Posts"}</span>
                  <strong>{data.posts.length}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Svar" : "Replies"}</span>
                  <strong>{repliesCount}</strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Säkerhet" : "Confidence"}</span>
                  <strong className={styles[`confidence_${data.sentiment.confidence.level}`]}>
                    {data.sentiment.confidence.level} ({data.sentiment.confidence.score})
                  </strong>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.metricLabel}>{isSv ? "Fönster" : "Window"}</span>
                  <strong>{data.lookback_days} {isSv ? "dagar" : "days"}</strong>
                </div>
              </article>
            </section>

            <section className={styles.distributionPanel}>
              <div className={styles.distributionTrack} aria-hidden="true">
                <div
                  className={styles.distributionPositive}
                  style={{ width: `${data.sentiment.distribution.positive.percent}%` }}
                />
                <div
                  className={styles.distributionNeutral}
                  style={{ width: `${data.sentiment.distribution.neutral.percent}%` }}
                />
                <div
                  className={styles.distributionNegative}
                  style={{ width: `${data.sentiment.distribution.negative.percent}%` }}
                />
              </div>
              <div className={styles.distributionLabels}>
                <span>{isSv ? "Positiv" : "Positive"} {data.sentiment.distribution.positive.percent}%</span>
                <span>{isSv ? "Neutral" : "Neutral"} {data.sentiment.distribution.neutral.percent}%</span>
                <span>{isSv ? "Negativ" : "Negative"} {data.sentiment.distribution.negative.percent}%</span>
              </div>
            </section>

            <section className={styles.lanes}>
              {(["positive", "neutral", "negative"] as const).map((bucket) => (
                <article key={bucket} className={`${styles.lane} ${styles[`lane_${bucket}`]}`}>
                  <header className={styles.laneHeader}>
                    <h3>{bucketTitle(bucket, isSv)}</h3>
                    <span>{grouped[bucket].length}</span>
                  </header>
                  <div className={styles.laneBody}>
                    {grouped[bucket].length === 0 ? (
                      <p className={styles.emptyLane}>{isSv ? "Inga kommentarer i denna kategori." : "No comments in this bucket."}</p>
                    ) : (
                      grouped[bucket].map((entity) => (
                        <article className={styles.entityCard} key={`${entity.entity_type}-${entity.id}`}>
                          <div className={styles.entityHeader}>
                            <span className={entity.entity_type === "post" ? styles.badgePost : styles.badgeReply}>
                              {entity.entity_type === "post" ? (isSv ? "inlägg" : "post") : isSv ? "svar" : "reply"}
                            </span>
                            <span>{formatDate(entity.created, isSv)}</span>
                            <span className={styles.entityScore}>{entity.sentiment_score}</span>
                          </div>
                          {entity.author_name ? <div className={styles.entityAuthor}>{entity.author_name}</div> : null}
                          <p className={styles.entityContent}>{entity.content || (isSv ? "(Inget innehåll)" : "(No content)")}</p>
                        </article>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}
      </Workspace>
    </main>
  );
}
