"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import type { PlaceraEntity, PlaceraPayload, SentimentSummary } from "./types";
import Workspace from "@/app/components/workspace";
import { resolveTickerSymbol } from "@/app/lib/ticker-suggestions";
import { buildForumSummary } from "./summary";
import { useLanguage } from "@/app/i18n/language";
import UiState from "@/app/components/ui-state";
import StockChart from "@/app/components/stock-chart";
const SENTIMENT_TICKER_PREF_KEY = "pref.sentiment.ticker";

const QUICK_PICKS: Array<{ symbol: string; name: string; flag: string }> = [
  { symbol: "AAPL", name: "Apple", flag: "🇺🇸" },
  { symbol: "MSFT", name: "Microsoft", flag: "🇺🇸" },
  { symbol: "NVDA", name: "NVIDIA", flag: "🇺🇸" },
  { symbol: "AMZN", name: "Amazon", flag: "🇺🇸" },
  { symbol: "GOOGL", name: "Alphabet", flag: "🇺🇸" },
  { symbol: "META", name: "Meta", flag: "🇺🇸" },
  { symbol: "TSLA", name: "Tesla", flag: "🇺🇸" },
  { symbol: "AVGO", name: "Broadcom", flag: "🇺🇸" },
  { symbol: "ASML", name: "ASML", flag: "🇳🇱" },
  { symbol: "NVO", name: "Novo Nordisk", flag: "🇩🇰" },
  { symbol: "SAP", name: "SAP", flag: "🇩🇪" },
  { symbol: "TM", name: "Toyota", flag: "🇯🇵" },
  { symbol: "SHOP", name: "Shopify", flag: "🇨🇦" },
  { symbol: "BABA", name: "Alibaba", flag: "🇨🇳" }
];

type ClusterSpot = { fx: number; fy: number; tilt: number; delayMs: number };

// The picks fan out over two concentric semi-circles (inner arc = the first, most
// prominent names) and pop in from the middle outwards. Positions are emitted as
// fractions of the arc radii so CSS can shrink the whole dome per breakpoint, and
// everything is derived from the index — never random — so SSR markup matches.
function buildCluster(total: number): ClusterSpot[] {
  const outerCount = Math.min(total, Math.max(1, Math.round(total * 0.71)));
  const rings = [
    { count: total - outerCount, radius: 0.5, from: 152, to: 28 },
    { count: outerCount, radius: 1, from: 172, to: 8 }
  ];

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const spots: ClusterSpot[] = [];

  for (const ring of rings) {
    for (let index = 0; index < ring.count; index += 1) {
      const t = ring.count === 1 ? 0.5 : index / (ring.count - 1);
      const angle = ring.from + (ring.to - ring.from) * t;
      const radians = (angle * Math.PI) / 180;
      spots.push({
        fx: round(Math.cos(radians) * ring.radius),
        fy: round(Math.sin(radians) * ring.radius),
        // Lean each chip along the tangent so the arc reads as an arc.
        tilt: round((90 - angle) / 14),
        delayMs: 0
      });
    }
  }

  spots
    .map((spot, index) => ({ index, distance: Math.hypot(spot.fx, spot.fy * 0.45) }))
    .sort((a, b) => a.distance - b.distance)
    .forEach((entry, rank) => {
      spots[entry.index].delayMs = rank * 38;
    });

  return spots;
}

const CLUSTER = buildCluster(QUICK_PICKS.length);
const CLUSTER_IN_MS = Math.max(...CLUSTER.map((spot) => spot.delayMs));
// Leaving reverses the entrance: the outermost blips wink out first, then the arc's
// space collapses. Must outlast the CSS exit (120ms delay + 440ms collapse).
const CLUSTER_EXIT_MS = 580;

function blipStyle(index: number): CSSProperties {
  const spot = CLUSTER[index];
  return {
    "--blip-fx": spot.fx,
    "--blip-fy": spot.fy,
    "--blip-tilt": `${spot.tilt}deg`,
    "--blip-delay": `${spot.delayMs}ms`,
    "--blip-out-delay": `${Math.round((CLUSTER_IN_MS - spot.delayMs) * 0.35)}ms`
  } as CSSProperties;
}

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

function bucketTitle(bucket: PlaceraEntity["sentiment_bucket"], isSv: boolean): string {
  if (bucket === "positive") return isSv ? "Positiv" : "Positive";
  if (bucket === "negative") return isSv ? "Negativ" : "Negative";
  return isSv ? "Neutral" : "Neutral";
}

type TickerProfile = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  marketCap: number | null;
  price: number | null;
  changePercent: number | null;
  peRatio: number | null;
  volume: number | null;
};

function formatMarketCap(value: number | null, isSv: boolean): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const units: Array<[number, string]> = [
    [1e12, isSv ? "bn" : "T"],
    [1e9, isSv ? "mdr" : "B"],
    [1e6, isSv ? "mn" : "M"]
  ];
  for (const [threshold, suffix] of units) {
    if (value >= threshold) {
      return `${(value / threshold).toFixed(value / threshold >= 100 ? 0 : 1)} ${suffix}`;
    }
  }
  return value.toLocaleString(isSv ? "sv-SE" : "en-US", { maximumFractionDigits: 0 });
}

function formatPrice(value: number | null, currency: string | null, isSv: boolean): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const formatted = value.toLocaleString(isSv ? "sv-SE" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

// A negative or missing trailing P/E means the company has no meaningful multiple.
function formatRatio(value: number | null, isSv: boolean): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return value.toLocaleString(isSv ? "sv-SE" : "en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatVolume(value: number | null, isSv: boolean): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const units: Array<[number, string]> = [
    [1e9, isSv ? "mdr" : "B"],
    [1e6, isSv ? "mn" : "M"],
    [1e3, isSv ? "tn" : "K"]
  ];
  for (const [threshold, suffix] of units) {
    if (value >= threshold) {
      const scaled = value / threshold;
      return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${suffix}`;
    }
  }
  return value.toLocaleString(isSv ? "sv-SE" : "en-US", { maximumFractionDigits: 0 });
}

/**
 * Bull charges and butts when the mood is positive, bear rears up and slams its
 * paws down when negative, and a crab sidesteps when the market is going nowhere
 * ("crab market" is the trader's own word for sideways chop).
 */
function MoodFigure({ mood }: { mood: "positive" | "neutral" | "negative" }) {
  if (mood === "positive") {
    return (
      <svg viewBox="0 0 72 64" className={styles.moodFigure} aria-hidden="true">
        <g className={styles.figBull}>
          <path className={styles.figDust} d="M8 30 H18" />
          <path className={styles.figDust} d="M6 38 H16" />
          <rect x="22" y="27" width="28" height="15" rx="7.5" />
          <circle cx="53" cy="29" r="8" />
          <path d="M47 22 C45 15 39 13 35 17" />
          <path d="M59 22 C61 15 67 13 70 17" />
          <path d="M50 31 H56" />
          <path className={styles.figLegA} d="M27 42 V51" />
          <path className={styles.figLegB} d="M34 42 V51" />
          <path className={styles.figLegA} d="M41 42 V51" />
          <path className={styles.figLegB} d="M47 42 V51" />
          <path d="M22 31 C18 30 17 27 18 24" />
        </g>
      </svg>
    );
  }

  if (mood === "negative") {
    return (
      <svg viewBox="0 0 72 64" className={styles.moodFigure} aria-hidden="true">
        <g className={styles.figBear}>
          <circle cx="36" cy="18" r="9" />
          <circle cx="29" cy="10" r="3" />
          <circle cx="43" cy="10" r="3" />
          <path d="M32 20 H40" />
          <rect x="27" y="27" width="18" height="19" rx="8" />
          <path className={styles.figPawLeft} d="M27 32 L16 40" />
          <path className={styles.figPawRight} d="M45 32 L56 40" />
          <path d="M31 46 V54" />
          <path d="M41 46 V54" />
        </g>
        <g className={styles.figImpact}>
          <path d="M10 46 L6 42" />
          <path d="M12 50 H5" />
          <path d="M62 46 L66 42" />
          <path d="M60 50 H67" />
        </g>
        <path className={styles.figGround} d="M8 56 H64" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 72 64" className={styles.moodFigure} aria-hidden="true">
      <g className={styles.figCrab}>
        <path d="M20 36 C20 27 27 22 36 22 C45 22 52 27 52 36 C52 41 45 44 36 44 C27 44 20 41 20 36 Z" />
        <path d="M30 24 V16" />
        <path d="M42 24 V16" />
        <circle cx="30" cy="14" r="2.4" />
        <circle cx="42" cy="14" r="2.4" />
        <path d="M29 34 H33" />
        <path d="M39 34 H43" />
        <g className={styles.figClawLeft}>
          <path d="M20 32 L12 26" />
          <path d="M12 26 L7 23 L10 29 Z" />
        </g>
        <g className={styles.figClawRight}>
          <path d="M52 32 L60 26" />
          <path d="M60 26 L65 23 L62 29 Z" />
        </g>
        <path className={styles.figLegA} d="M24 42 L19 50" />
        <path className={styles.figLegB} d="M31 44 L29 52" />
        <path className={styles.figLegA} d="M41 44 L43 52" />
        <path className={styles.figLegB} d="M48 42 L53 50" />
      </g>
    </svg>
  );
}

export default function PlaceraPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const [companyLookup, setCompanyLookup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlaceraPayload | null>(null);
  const [profile, setProfile] = useState<TickerProfile | null>(null);
  // The ticker the lookup actually resolved to — the chart needs a symbol, not a company name.
  const [resolvedSymbol, setResolvedSymbol] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ bucket: string; entity: PlaceraEntity } | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // The pick cluster greets you once per visit, then clears out on the first lookup.
  const [picksPhase, setPicksPhase] = useState<"visible" | "leaving" | "gone">("visible");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedTicker = window.localStorage.getItem(SENTIMENT_TICKER_PREF_KEY);
    if (savedTicker) {
      setCompanyLookup(savedTicker);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const trimmed = companyLookup.trim().toUpperCase();
    if (trimmed) {
      window.localStorage.setItem(SENTIMENT_TICKER_PREF_KEY, trimmed);
      return;
    }
    window.localStorage.removeItem(SENTIMENT_TICKER_PREF_KEY);
  }, [companyLookup]);

  useEffect(() => {
    if (picksPhase !== "leaving") {
      return;
    }
    const timer = window.setTimeout(() => setPicksPhase("gone"), CLUSTER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [picksPhase]);

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

  const summary = useMemo(
    () => (data ? buildForumSummary(data, isSv, profile?.name ?? companyDisplay) : null),
    [companyDisplay, data, isSv, profile]
  );
  async function loadProfile(symbol: string) {
    try {
      const response = await fetch(`/api/tickers/profile?symbol=${encodeURIComponent(symbol)}`);
      const payload = (await response.json()) as { ok: boolean; profile?: TickerProfile | null };
      setProfile(payload.ok ? payload.profile ?? null : null);
    } catch {
      setProfile(null);
    }
  }

  async function runLookup(rawInput: string) {
    setLoading(true);
    setError(null);
    setPreview(null);
    setSummaryExpanded(false);

    try {
      const params = new URLSearchParams();
      const lookupRaw = rawInput.trim();
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
      setProfile(null);
      setResolvedSymbol(lookup.toUpperCase());
      void loadProfile(lookup.toUpperCase());
    } catch (err) {
      const message = err instanceof Error ? err.message : isSv ? "Okänt fel" : "Unknown error";
      setError(message);
      setData(null);
      setProfile(null);
      setResolvedSymbol(null);
    } finally {
      setLoading(false);
    }
  }

  function dismissPicks() {
    setPicksPhase((current) => (current === "visible" ? "leaving" : current));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dismissPicks();
    await runLookup(companyLookup);
  }

  async function onQuickPick(symbol: string) {
    dismissPicks();
    setCompanyLookup(symbol);
    await runLookup(symbol);
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Sentiment" : "Sentiment"}
        subtitle={isSv ? "Se hur marknadens samtal om ett bolag utvecklas." : "See how market conversations around a company are trending."}
      >
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.searchRow}>
            <div className={styles.searchField}>
              <label className={styles.srOnly} htmlFor="companyLookup">
                {isSv ? "Ticker" : "Ticker"}
              </label>
              <input
                id="companyLookup"
                className={styles.searchInput}
                value={companyLookup}
                onChange={(event) => setCompanyLookup(event.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <button className={styles.runButton} type="submit" disabled={loading}>
              <svg viewBox="0 0 24 24" className={styles.runIcon} aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16 L21 21" />
              </svg>
              {loading ? (isSv ? "Laddar..." : "Loading...") : isSv ? "Kör" : "Run"}
            </button>
          </div>

          {picksPhase === "gone" ? null : (
          <div className={`${styles.quickPicks} ${picksPhase === "leaving" ? styles.quickPicksLeaving : ""}`}>
            <div className={styles.quickCluster}>
              {QUICK_PICKS.map((pick, index) => (
                <span key={pick.symbol} className={styles.quickSlot} style={blipStyle(index)}>
                  <button
                    type="button"
                    className={`${styles.quickPick} ${
                      companyLookup.trim().toUpperCase() === pick.symbol ? styles.quickPickActive : ""
                    }`}
                    onClick={() => void onQuickPick(pick.symbol)}
                    disabled={loading}
                    title={pick.name}
                  >
                    <span className={styles.quickFlag} aria-hidden="true">
                      {pick.flag}
                    </span>
                    {pick.symbol}
                  </button>
                </span>
              ))}
            </div>
          </div>
          )}
        </form>

        {error ? <UiState kind="error" message={error} className={styles.error} /> : null}

        {data ? (
          <>
            <section className={styles.deck}>
              <article className={`${styles.deckCard} ${styles.mainCard} ${styles[`mainCard_${data.sentiment.label}`]}`}>
                <div className={styles.mainTop}>
                  <div className={styles.moodStage}>
                    <MoodFigure mood={data.sentiment.label} />
                  </div>
                  <div className={styles.mainIdentity}>
                    <p className={styles.mainEyebrow}>{isSv ? "Marknadsläge" : "Market mood"}</p>
                    <h3 className={styles.mainMood}>{badgeLabel(data.sentiment.badge, isSv)}</h3>
                    <p className={styles.mainScore}>
                      {isSv ? "Poäng" : "Score"} {data.sentiment.score}
                      <span className={styles[`confidence_${data.sentiment.confidence.level}`]}>
                        {" · "}
                        {data.sentiment.confidence.level} ({data.sentiment.confidence.score})
                      </span>
                    </p>
                  </div>
                </div>

                <div className={styles.mainCompany}>
                  <strong className={styles.mainCompanyName}>{profile?.name ?? companyDisplay}</strong>
                  <span className={styles.mainCompanyMeta}>
                    {profile?.symbol ?? companyDisplay.toUpperCase()}
                    {profile?.exchange ? ` · ${profile.exchange}` : ""}
                  </span>
                </div>

                <dl className={styles.mainStats}>
                  <div className={styles.mainStat}>
                    <dt>{isSv ? "Börsvärde" : "Market cap"}</dt>
                    <dd>{formatMarketCap(profile?.marketCap ?? null, isSv)}</dd>
                  </div>
                  <div className={styles.mainStat}>
                    <dt>{isSv ? "Kurs" : "Price"}</dt>
                    <dd>
                      {formatPrice(profile?.price ?? null, profile?.currency ?? null, isSv)}
                      {profile?.changePercent !== null && profile?.changePercent !== undefined ? (
                        <span className={profile.changePercent >= 0 ? styles.deltaUp : styles.deltaDown}>
                          {profile.changePercent >= 0 ? "+" : ""}
                          {profile.changePercent.toFixed(2)}%
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className={styles.mainStat}>
                    <dt>{isSv ? "P/E-tal" : "P/E ratio"}</dt>
                    <dd>{formatRatio(profile?.peRatio ?? null, isSv)}</dd>
                  </div>
                  <div className={styles.mainStat}>
                    <dt>{isSv ? "Volym" : "Volume"}</dt>
                    <dd>{formatVolume(profile?.volume ?? null, isSv)}</dd>
                  </div>
                </dl>
              </article>

              {(["negative", "neutral", "positive"] as const).map((bucket) => {
                const items = grouped[bucket];
                const active = preview?.bucket === bucket ? preview.entity : null;
                // Duration scales with volume so the pass rate stays readable; the card box never moves.
                const duration = Math.max(24, Math.min(180, items.length * 5));

                return (
                  <article
                    key={bucket}
                    className={`${styles.deckCard} ${styles.laneCard} ${styles[`lane_${bucket}`]}`}
                    onMouseLeave={() => setPreview(null)}
                  >
                    <header className={styles.laneHeader}>
                      <h3>{bucketTitle(bucket, isSv)}</h3>
                    </header>

                    <div className={styles.laneViewport}>
                      {items.length === 0 ? (
                        <p className={styles.emptyLane}>
                          {isSv ? "Inga kommentarer i denna kategori." : "No comments in this bucket."}
                        </p>
                      ) : (
                        <div className={styles.laneTrack} style={{ animationDuration: `${duration}s` }}>
                          {/* Two identical passes so the vertical scroll loops seamlessly. */}
                          {[0, 1].map((pass) =>
                            items.map((entity) => (
                              <button
                                type="button"
                                key={`${pass}-${entity.entity_type}-${entity.id}`}
                                className={styles.commentCard}
                                onMouseEnter={() => setPreview({ bucket, entity })}
                                onFocus={() => setPreview({ bucket, entity })}
                                aria-hidden={pass === 1 ? true : undefined}
                                tabIndex={pass === 1 ? -1 : undefined}
                              >
                                <span className={styles.commentMeta}>
                                  <span className={entity.entity_type === "post" ? styles.badgePost : styles.badgeReply}>
                                    {entity.entity_type === "post" ? (isSv ? "inlägg" : "post") : isSv ? "svar" : "reply"}
                                  </span>
                                </span>
                                <span className={styles.commentText}>
                                  {entity.content || (isSv ? "(Inget innehåll)" : "(No content)")}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}

                      {active ? (
                        <div className={styles.commentPreview}>
                          <div className={styles.commentPreviewHead}>
                            <span className={active.entity_type === "post" ? styles.badgePost : styles.badgeReply}>
                              {active.entity_type === "post" ? (isSv ? "inlägg" : "post") : isSv ? "svar" : "reply"}
                            </span>
                          </div>
                          <p className={styles.commentPreviewMeta}>
                            {active.author_name ? `${active.author_name} · ` : ""}
                            {formatDate(active.created, isSv)}
                          </p>
                          <p className={styles.commentPreviewBody}>
                            {active.content || (isSv ? "(Inget innehåll)" : "(No content)")}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>

            {resolvedSymbol ? <StockChart symbol={resolvedSymbol} name={profile?.name ?? null} /> : null}

            {summary ? (
              <section className={styles.summaryCard}>
                <div className={styles.summaryInner}>
                  <div className={styles.summaryHead}>
                    <span className={styles.summaryMark} aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 2.5 L14.6 9.4 L21.5 12 L14.6 14.6 L12 21.5 L9.4 14.6 L2.5 12 L9.4 9.4 Z" />
                      </svg>
                    </span>
                    <h3>{isSv ? "Sammanfattning" : "Summary"}</h3>
                  </div>
                  <p className={styles.summaryText}>{summaryExpanded ? summary.full : summary.short}</p>
                  <div className={styles.summaryFoot}>
                    <span>
                      {isSv
                        ? `Baserat på ${summary.entityCount} kommentarer · ${data.lookback_days} dagar`
                        : `Based on ${summary.entityCount} comments · ${data.lookback_days} days`}
                    </span>
                    <button
                      type="button"
                      className={styles.summaryToggle}
                      onClick={() => setSummaryExpanded((current) => !current)}
                    >
                      {summaryExpanded ? (isSv ? "Visa mindre" : "View less") : isSv ? "Visa mer" : "View more"}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

          </>
        ) : null}
      </Workspace>
    </main>
  );
}
