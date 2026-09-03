"use client";

/**
 * The instrument detail tabs: overview, KPI, news, analysts.
 *
 * The tab strip is built from the payload's `sections`, not from a fixed list.
 * Only equities carry financials and analyst coverage, and an index carries no
 * news either, so a hardcoded four-tab layout would show gold an empty "KPI"
 * tab. An empty tab is a promise the data cannot keep
 * (docs/synthetic-data-policy.md).
 *
 * Every value here renders only when it exists. There is no "—" standing in for
 * a number we did compute and no 0 standing in for a number we did not: a
 * missing row is omitted from the list entirely, and a missing bar is a gap in
 * the chart.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import QuantPanel from "./quant-panel";
import SentimentPanel from "./sentiment-panel";
import PrimerPanel from "./primer-panel";
import type {
  InstrumentAnalysts,
  InstrumentDetail,
  InstrumentNews,
  StatementPeriod
} from "@/app/lib/market/instrument-types";
import type { GatedSection } from "@/app/lib/market/instrument-visibility";
import { placeraQuery, toolsFor } from "@/app/lib/market/instrument-tools";
import styles from "./page.module.css";

type Tab = "overview" | "kpi" | "news" | "analysts" | "quant" | "sentiment" | "primers";

/**
 * The analysis tabs, kept apart from the data tabs above.
 *
 * The four data tabs are already-fetched facts; these three *run something* —
 * a Python job that takes tens of seconds and can fail, or a forum fetch. A tab
 * strip that mixed them without a break would make clicking "Quant" feel like
 * clicking a broken "News".
 */
const TOOL_TABS: Tab[] = ["quant", "sentiment", "primers"];

const TAB_LABELS: Record<Tab, { en: string; sv: string }> = {
  overview: { en: "Overview", sv: "Översikt" },
  kpi: { en: "Key figures", sv: "Nyckeltal" },
  news: { en: "News", sv: "Nyheter" },
  analysts: { en: "Analysts", sv: "Analytiker" },
  quant: { en: "Quant", sv: "Quant" },
  sentiment: { en: "Sentiment", sv: "Sentiment" },
  primers: { en: "Primer", sv: "Primer" }
};

/** Compact money, in the instrument's own currency — never converted here. */
function money(value: number, currency: string | null): string {
  const abs = Math.abs(value);
  const [scaled, suffix] =
    abs >= 1e12 ? [value / 1e12, "T"] : abs >= 1e9 ? [value / 1e9, "B"] : abs >= 1e6 ? [value / 1e6, "M"] : [value, ""];
  const digits = suffix && Math.abs(scaled) < 100 ? 1 : 0;
  return `${scaled.toLocaleString("en-GB", { maximumFractionDigits: digits })}${suffix}${currency ? ` ${currency}` : ""}`;
}

function count(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function ratio(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** The overview blurb is a teaser, not the filing. */
const SUMMARY_WORD_LIMIT = 70;

/** Words whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set([
  "inc", "corp", "co", "ltd", "llc", "plc", "sa", "nv", "ab", "us", "mr", "mrs", "ms", "dr", "st", "jr", "sr", "no"
]);

/**
 * Cut the issuer's description to a teaser — trimmed, never reworded.
 *
 * We walk back to the last sentence that ends inside the budget so the blurb
 * lands on a period instead of a dangling clause, and only fall back to an
 * ellipsis when the opening sentence is longer than the whole budget. A period
 * counts as a sentence end when the next word starts a new one, which is what
 * keeps "Apple Inc. designs..." in one piece; ABBREVIATIONS covers the rest.
 */
function teaser(text: string, limit: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= limit) return words.join(" ");

  const head = words.slice(0, limit);
  for (let i = head.length - 1; i >= limit / 2; i--) {
    if (!/[.!?]["')\]]?$/.test(head[i])) continue;
    if (ABBREVIATIONS.has(head[i].replace(/[^A-Za-z]/g, "").toLowerCase())) continue;
    const next = head[i + 1] ?? words[limit];
    if (!/^["'(\[]?[A-Z0-9]/.test(next)) continue;
    return head.slice(0, i + 1).join(" ");
  }
  return `${head.join(" ")}…`;
}

/** A definition row that renders only when there is something to say. */
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * A grouped bar chart over reporting periods.
 *
 * Bars are scaled against the largest absolute value across every series, so
 * the series stay comparable to each other. A period missing a series draws no
 * bar at all rather than a zero-height one — on a chart those look identical
 * and mean opposite things.
 */
function StatementChart({
  periods,
  series,
  currency
}: {
  periods: StatementPeriod[];
  series: Array<{ key: keyof StatementPeriod; label: string; className: string }>;
  currency: string | null;
}) {
  const max = useMemo(() => {
    let out = 0;
    for (const period of periods) {
      for (const { key } of series) {
        const value = period[key];
        if (typeof value === "number") out = Math.max(out, Math.abs(value));
      }
    }
    return out;
  }, [periods, series]);

  if (periods.length === 0 || max === 0) return null;

  return (
    <div className={styles.chart}>
      <div className={styles.chartPlot}>
        {periods.map((period) => (
          <div key={period.period} className={styles.chartGroup}>
            <div className={styles.chartBars}>
              {series.map(({ key, label, className }) => {
                const value = period[key];
                if (typeof value !== "number") return null;
                return (
                  <div
                    key={String(key)}
                    className={`${styles.bar} ${styles[className]}`}
                    style={{ height: `${Math.max(1, (Math.abs(value) / max) * 100)}%` }}
                    title={`${label}: ${money(value, currency)}`}
                  />
                );
              })}
            </div>
            <span className={styles.chartLabel}>{period.period.slice(0, 4)}</span>
          </div>
        ))}
      </div>
      <ul className={styles.legend}>
        {series.map(({ key, label, className }) => (
          <li key={String(key)}>
            <span className={`${styles.swatch} ${styles[className]}`} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What signing in adds, named specifically.
 *
 * Rendered once at the foot of the overview rather than as locked, empty tabs.
 * A tab that opens onto a wall is the same broken promise as an empty KPI tab
 * on gold — and naming the three things ("revenue, earnings, balance sheet")
 * is a better reason to sign up than a padlock is.
 */
function SignInPrompt({ gated, sv }: { gated: GatedSection[]; sv: boolean }) {
  if (gated.length === 0) return null;

  const names: Record<GatedSection, { en: string; sv: string }> = {
    kpi: { en: "revenue, earnings and the balance sheet", sv: "omsättning, vinst och balansräkning" },
    analysts: { en: "analyst recommendations and price targets", sv: "analytikerrekommendationer och riktkurser" },
    valuation: { en: "valuation figures like P/E and market cap", sv: "värderingsmått som P/E och börsvärde" }
  };
  const list = gated.map((key) => (sv ? names[key].sv : names[key].en));
  const joined =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} ${sv ? "och" : "and"} ${list[list.length - 1]}`;

  return (
    <div className={styles.gate}>
      <p className={styles.gateText}>
        {sv ? "Skapa ett konto för att se " : "Create a free account to see "}
        {joined}.
      </p>
      <Link href="/auth/login?mode=register" className={styles.gateCta}>
        {sv ? "Skapa konto" : "Create account"}
      </Link>
    </div>
  );
}

function Overview({ detail, sv }: { detail: InstrumentDetail & { gated?: GatedSection[] }; sv: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const p = detail.profile;

  return (
    <div className={styles.panel}>
      {p.summary ? (
        <section className={styles.section}>
          <h2>{sv ? "Om bolaget" : "About"}</h2>
          {/* The issuer's own description, cut to a teaser but never reworded:
              no paraphrase, no model-generated prose — see the bridge module.
              The full filing is the issuer's to publish, not ours to reprint. */}
          <p className={styles.summary}>{teaser(p.summary, SUMMARY_WORD_LIMIT)}</p>
        </section>
      ) : null}

      <button type="button" className={styles.expand} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? (sv ? "Visa mindre" : "Show less") : sv ? "Mer" : "Expand"}
      </button>

      {expanded ? (
        <dl className={styles.facts}>
          <Fact label={sv ? "Kortnamn" : "Ticker"} value={detail.symbol} />
          <Fact label={sv ? "Marknadsplats" : "Exchange"} value={p.exchange} />
          <Fact label={sv ? "Valuta" : "Currency"} value={p.currency} />
          <Fact label={sv ? "VD" : "CEO"} value={p.ceo} />
          <Fact label={sv ? "Sektor" : "Sector"} value={p.sector} />
          <Fact label={sv ? "Bransch" : "Industry"} value={p.industry} />
          <Fact label={sv ? "Land" : "Country"} value={p.country} />
          <Fact label={sv ? "Anställda" : "Employees"} value={p.employees ? count(p.employees) : null} />
          <Fact label={sv ? "Antal aktier" : "Shares outstanding"} value={p.sharesOutstanding ? count(p.sharesOutstanding) : null} />
          <Fact label={sv ? "Börsvärde" : "Market cap"} value={p.marketCap ? money(p.marketCap, p.currency) : null} />
          <Fact label="P/E" value={p.peRatio !== null ? ratio(p.peRatio) : null} />
          <Fact label={sv ? "P/E framåt" : "Forward P/E"} value={p.forwardPe !== null ? ratio(p.forwardPe) : null} />
          <Fact label="P/B" value={p.priceToBook !== null ? ratio(p.priceToBook) : null} />
          <Fact label={sv ? "Vinst/aktie" : "EPS"} value={p.eps !== null ? ratio(p.eps) : null} />
          <Fact label="Beta" value={p.beta !== null ? ratio(p.beta) : null} />
          <Fact
            label={sv ? "52v högst/lägst" : "52w high/low"}
            value={
              p.fiftyTwoWeekHigh && p.fiftyTwoWeekLow
                ? `${ratio(p.fiftyTwoWeekLow)} – ${ratio(p.fiftyTwoWeekHigh)}`
                : null
            }
          />
          {p.website ? (
            <div className={styles.fact}>
              <dt>{sv ? "Hemsida" : "Website"}</dt>
              <dd>
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow">
                  {p.website.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <SignInPrompt gated={detail.gated ?? []} sv={sv} />
    </div>
  );
}

function Kpi({ detail, sv }: { detail: InstrumentDetail; sv: boolean }) {
  const currency = detail.profile.currency;
  const income = detail.financials?.income ?? [];
  const balance = detail.financials?.balance ?? [];

  return (
    <div className={styles.panel}>
      {income.length > 0 ? (
        <section className={styles.section}>
          <h2>{sv ? "Resultaträkning" : "Income statement"}</h2>
          <StatementChart
            periods={income}
            currency={currency}
            series={[
              { key: "revenue", label: sv ? "Omsättning" : "Revenue", className: "seriesA" },
              { key: "operatingIncome", label: sv ? "Rörelseresultat" : "Operating result", className: "seriesB" },
              { key: "netIncome", label: sv ? "Vinst" : "Earnings", className: "seriesC" }
            ]}
          />
        </section>
      ) : null}

      {balance.length > 0 ? (
        <section className={styles.section}>
          <h2>{sv ? "Balansräkning" : "Balance sheet"}</h2>
          <StatementChart
            periods={balance}
            currency={currency}
            series={[
              { key: "assets", label: sv ? "Tillgångar" : "Assets", className: "seriesA" },
              { key: "equity", label: sv ? "Eget kapital" : "Equity", className: "seriesB" },
              { key: "debt", label: sv ? "Skulder" : "Debt", className: "seriesC" }
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}

function News({ items, sv }: { items: InstrumentNews[]; sv: boolean }) {
  return (
    <div className={styles.panel}>
      <ul className={styles.news}>
        {items.map((item, idx) => (
          <li key={`${item.title}-${idx}`} className={styles.newsItem}>
            <div className={styles.newsMeta}>
              {item.publisher ? <span className={styles.publisher}>{item.publisher}</span> : null}
              {item.publishedAt ? (
                <time dateTime={item.publishedAt}>
                  {new Date(item.publishedAt).toLocaleString(sv ? "sv-SE" : "en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short"
                  })}
                </time>
              ) : null}
            </div>
            {/* Headline only — no summary, no sentiment. Characterising someone
                else's story next to our price chart attributes an editorial
                claim to us. */}
            {item.link ? (
              <a href={item.link} target="_blank" rel="noopener noreferrer nofollow" className={styles.newsTitle}>
                {item.title}
              </a>
            ) : (
              <span className={styles.newsTitle}>{item.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Analysts({ analysts, currency, sv }: { analysts: InstrumentAnalysts; currency: string | null; sv: boolean }) {
  const recs = analysts.recommendations;
  const target = analysts.priceTarget;
  const rows: Array<[string, number]> = recs
    ? ([
        [sv ? "Köp" : "Buy", recs.strongBuy ?? 0],
        [sv ? "Övervikt" : "Overweight", recs.buy ?? 0],
        [sv ? "Behåll" : "Hold", recs.hold ?? 0],
        [sv ? "Undervikt" : "Underweight", recs.sell ?? 0],
        [sv ? "Sälj" : "Sell", recs.strongSell ?? 0]
      ] as Array<[string, number]>)
    : [];
  const maxRec = rows.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div className={styles.panel}>
      <p className={styles.disclaimer}>
        {sv
          ? "Analytikerestimat är sammanställda från tredje part och utgör inte investeringsrådgivning."
          : "Analyst estimates are compiled from third parties and are not investment advice."}
      </p>

      {rows.length > 0 && maxRec > 0 ? (
        <section className={styles.section}>
          <h2>{sv ? "Rekommendationer" : "Recommendations"}</h2>
          <ul className={styles.recs}>
            {rows.map(([label, value]) => (
              <li key={label}>
                <span className={styles.recLabel}>{label}</span>
                <span className={styles.recTrack}>
                  <span className={styles.recFill} style={{ width: `${(value / maxRec) * 100}%` }} />
                </span>
                <span className={styles.recCount}>{value}</span>
              </li>
            ))}
          </ul>
          {analysts.analystCount ? (
            <p className={styles.note}>
              {analysts.analystCount} {sv ? "analytiker" : "analysts"}
            </p>
          ) : null}
        </section>
      ) : null}

      {target ? (
        <section className={styles.section}>
          <h2>{sv ? "Riktkurser" : "Price targets"}</h2>
          <dl className={styles.facts}>
            <Fact label={sv ? "Lägst" : "Low"} value={target.low ? `${ratio(target.low)}${currency ? ` ${currency}` : ""}` : null} />
            <Fact label={sv ? "Snitt" : "Mean"} value={target.mean ? `${ratio(target.mean)}${currency ? ` ${currency}` : ""}` : null} />
            <Fact label={sv ? "Median" : "Median"} value={target.median ? `${ratio(target.median)}${currency ? ` ${currency}` : ""}` : null} />
            <Fact label={sv ? "Högst" : "High"} value={target.high ? `${ratio(target.high)}${currency ? ` ${currency}` : ""}` : null} />
          </dl>
        </section>
      ) : null}
    </div>
  );
}

export default function InstrumentTabs({
  detail,
  sv
}: {
  detail: InstrumentDetail & { gated?: GatedSection[] };
  sv: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // Data tabs come from what the payload holds; tool tabs from what each tool
  // can reach. Both are derived rather than fixed, so an index shows two tabs
  // and a US equity six — and no instrument ever shows seven, because primers
  // (SEC) and sentiment (Placera) are mutually exclusive by geography.
  const tools = useMemo(() => toolsFor(detail.symbol, detail.profile), [detail.symbol, detail.profile]);

  const dataTabs = (["overview", "kpi", "news", "analysts"] as const).filter((tab) => detail.sections[tab]) as Tab[];
  const toolTabs = TOOL_TABS.filter((tab) => tools[tab as keyof typeof tools]);
  const available = [...dataTabs, ...toolTabs];

  // The tab is held in state and mirrored into the URL, rather than read from
  // the URL alone.
  //
  // Both halves are needed. The URL is what makes "look at this" a link someone
  // can send once a tab holds a job result, and what survives a reload. But
  // driving the UI *from* the URL alone makes every click wait on a router
  // round-trip, and a click that does not paint immediately reads as a dead
  // button. So state answers the click and the URL follows.
  const requested = params.get("tab") as Tab | null;
  const [chosen, setChosen] = useState<Tab | null>(null);
  const picked = chosen ?? requested;
  const current = picked && available.includes(picked) ? picked : available[0];

  const select = useCallback(
    (tab: Tab) => {
      setChosen(tab);
      const next = new URLSearchParams(Array.from(params.entries()));
      next.set("tab", tab);
      // `scroll: false` keeps the reader where they are. Switching tabs is not
      // navigation to a new page and should not jump to the top of one.
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );

  if (available.length === 0) return null;

  return (
    <>
      <div className={styles.tabs} role="tablist">
        {dataTabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={tab === current}
            className={tab === current ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => select(tab)}
          >
            {sv ? TAB_LABELS[tab].sv : TAB_LABELS[tab].en}
          </button>
        ))}

        {dataTabs.length > 0 && toolTabs.length > 0 ? <span className={styles.tabDivider} aria-hidden="true" /> : null}

        {toolTabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={tab === current}
            className={tab === current ? `${styles.tab} ${styles.tabTool} ${styles.tabActive}` : `${styles.tab} ${styles.tabTool}`}
            onClick={() => select(tab)}
          >
            {sv ? TAB_LABELS[tab].sv : TAB_LABELS[tab].en}
          </button>
        ))}
      </div>

      {current === "overview" ? <Overview detail={detail} sv={sv} /> : null}
      {current === "kpi" ? <Kpi detail={detail} sv={sv} /> : null}
      {current === "news" ? <News items={detail.news} sv={sv} /> : null}
      {current === "analysts" && detail.analysts ? (
        <Analysts analysts={detail.analysts} currency={detail.profile.currency} sv={sv} />
      ) : null}
      {current === "quant" ? <QuantPanel symbol={detail.symbol} sv={sv} /> : null}
      {current === "sentiment" ? (
        // Placera resolves a company by name, not by ticker, and not by the
        // *legal* name Yahoo reports — "AB Volvo (publ)" 404s where "Volvo"
        // resolves, measured against the live endpoint.
        <SentimentPanel companyQuery={placeraQuery(detail.profile.name ?? detail.symbol)} sv={sv} />
      ) : null}
      {current === "primers" ? <PrimerPanel symbol={detail.symbol} sv={sv} /> : null}
    </>
  );
}
