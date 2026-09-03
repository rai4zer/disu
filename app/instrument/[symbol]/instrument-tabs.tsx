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

import { useMemo, useState } from "react";
import type {
  InstrumentAnalysts,
  InstrumentDetail,
  InstrumentNews,
  StatementPeriod
} from "@/app/lib/market/instrument-types";
import styles from "./page.module.css";

type Tab = "overview" | "kpi" | "news" | "analysts";

const TAB_LABELS: Record<Tab, { en: string; sv: string }> = {
  overview: { en: "Overview", sv: "Översikt" },
  kpi: { en: "Key figures", sv: "Nyckeltal" },
  news: { en: "News", sv: "Nyheter" },
  analysts: { en: "Analysts", sv: "Analytiker" }
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

function Overview({ detail, sv }: { detail: InstrumentDetail; sv: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const p = detail.profile;

  return (
    <div className={styles.panel}>
      {p.summary ? (
        <section className={styles.section}>
          <h2>{sv ? "Om bolaget" : "About"}</h2>
          {/* The issuer's own description, passed through unedited. Never
              paraphrased or model-generated — see the bridge module. */}
          <p className={styles.summary}>{p.summary}</p>
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

export default function InstrumentTabs({ detail, sv }: { detail: InstrumentDetail; sv: boolean }) {
  const available = (["overview", "kpi", "news", "analysts"] as Tab[]).filter((tab) => detail.sections[tab]);
  const [active, setActive] = useState<Tab>(available[0] ?? "overview");
  const current = available.includes(active) ? active : available[0];

  if (available.length === 0) return null;

  return (
    <>
      <div className={styles.tabs} role="tablist">
        {available.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={tab === current}
            className={tab === current ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setActive(tab)}
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
    </>
  );
}
