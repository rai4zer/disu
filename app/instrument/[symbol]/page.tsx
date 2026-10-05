"use client";

/**
 * Instrument detail page: one page per equity, index, commodity, FX cross and
 * crypto pair.
 *
 * The page is deliberately thin. It fetches once, renders the header from the
 * profile, and hands the rest to `InstrumentTabs`, which decides its own tab
 * list from what the payload actually contains — only equities have financials
 * and analyst coverage (docs/contracts/instrument-profile.schema.json).
 *
 * The first viewer of a symbol waits on a Python spawn (~3s) because this data
 * cannot be swept in advance: the symbol is whatever they opened. Hence the
 * explicit loading state, and hence `instrument-cache.ts`, which means the next
 * viewer reads a row instead.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StockChart from "@/app/components/stock-chart";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import type { InstrumentDetail } from "@/app/lib/market/instrument-types";
import type { GatedSection } from "@/app/lib/market/instrument-visibility";
import { toolsFor } from "@/app/lib/market/instrument-tools";
import AnalysisActions from "./analysis-actions";
import InstrumentTabs from "./instrument-tabs";
import TradePanel from "./trade-panel";
import { usePrimerRun, useQuantRun } from "./use-tool-runs";
import styles from "./page.module.css";

type Payload = InstrumentDetail & { ok: true; fetchedAt: string; cached: boolean; gated?: GatedSection[] };

/** What kind of thing this is, said plainly rather than as a raw enum. */
const TYPE_LABEL: Record<string, { en: string; sv: string }> = {
  EQUITY: { en: "Share", sv: "Aktie" },
  INDEX: { en: "Index", sv: "Index" },
  FUTURE: { en: "Commodity", sv: "Råvara" },
  CURRENCY: { en: "Currency", sv: "Valuta" },
  CRYPTOCURRENCY: { en: "Crypto", sv: "Krypto" }
};

export default function InstrumentPage({ params }: { params: { symbol: string } }) {
  const { language } = useLanguage();
  const router = useRouter();
  const search = useSearchParams();
  const sv = language === "sv";
  const symbol = decodeURIComponent(params.symbol ?? "").toUpperCase();

  const [detail, setDetail] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/instruments/${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const body = (await response.json()) as Payload | { ok: false; error?: string };
      if (!response.ok || !("ok" in body) || body.ok !== true) {
        setDetail(null);
        setError(
          ("error" in body && body.error) ||
            (sv ? "Kunde inte ladda instrumentet." : "Could not load this instrument.")
        );
        return;
      }
      setDetail(body);
    } catch {
      setDetail(null);
      setError(sv ? "Kunde inte ladda instrumentet." : "Could not load this instrument.");
    } finally {
      setLoading(false);
    }
  }, [symbol, sv]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = detail?.profile;
  const typeLabel = profile?.quoteType ? TYPE_LABEL[profile.quoteType] : undefined;

  // Both tools are owned here rather than inside the tab that draws them: the
  // rail starts a run, the chart draws the quant one, and the tab shows either
  // in full. One run, three readers (`use-tool-runs.ts`).
  const quant = useQuantRun(symbol, sv);
  const primer = usePrimerRun(symbol, sv);

  const tools = useMemo(
    () => (profile ? toolsFor(symbol, profile) : { quant: false, sentiment: false, primers: false }),
    [profile, symbol]
  );

  const tabsRef = useRef<HTMLDivElement | null>(null);

  /** Open a tool's tab and put it on screen — the output lands there, not in the rail. */
  const openTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(Array.from(search.entries()));
      next.set("tab", tab);
      router.replace(`?${next.toString()}`, { scroll: false });
      // After the tab has actually switched, so the scroll targets the panel
      // that is about to be tall rather than the one leaving.
      window.requestAnimationFrame(() => {
        tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [router, search]
  );

  const runPrimer = useCallback(() => {
    openTab("primers");
    primer.run();
  }, [openTab, primer]);

  return (
    <Workspace title={profile?.name ?? symbol} subtitle={symbol}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.crumbs}>
            <Link href="/dashboard">{sv ? "Översikt" : "Dashboard"}</Link>
            <span aria-hidden="true">/</span>
            <span>{symbol}</span>
          </div>
          <div className={styles.badges}>
            {typeLabel ? <span className={styles.badge}>{sv ? typeLabel.sv : typeLabel.en}</span> : null}
            {profile?.exchange ? <span className={styles.badge}>{profile.exchange}</span> : null}
            {profile?.sector ? <span className={styles.badge}>{profile.sector}</span> : null}
          </div>
        </header>

        {/* Two columns from `.layout` down: the chart and everything below it in
            the reading column, the trade ticket in the rail beside them. The
            rail is what the narrowed reading column buys — the chart used to run
            the full width and left that space empty. Below 1060px the grid
            collapses and the ticket falls in under the tabs.

            The chart and the ticket are their own grid row so the ticket can
            stretch to the chart's height: the two cards sit side by side and
            the eye reads a ragged bottom edge between them as a mistake. Row
            two carries the rest of each column. */}
        <div className={styles.layout}>
          <div className={styles.chartCell}>
            {/* The chart is the existing component and reads the existing history
                route, so it works for any symbol the page can be opened for. */}
            {/* The quant run is drawn here, past the last candle, rather than
                only in its tab: the projection is a statement about this price
                series and reads as one only against it. */}
            <StockChart symbol={symbol} dense projection={quant.rows} />
          </div>

          {/* Renders from the symbol alone, so it is there on the first paint
              rather than waiting on the profile fetch. The currency arrives
              later and only labels the amounts.

              The two tools ride in the ticket's foot rather than in a card
              under it: the ticket is stretched to the chart's height anyway, so
              that foot is free space sitting on the chart's bottom edge — the
              most visible row in the rail, and the one the tools were losing by
              being in a second card below it. */}
          <div className={styles.ticketCell}>
            <TradePanel
              symbol={symbol}
              currency={profile?.currency ?? null}
              sv={sv}
              footer={
                <AnalysisActions
                  quant={quant}
                  primer={primer}
                  showPrimer={tools.primers}
                  onQuant={quant.run}
                  onPrimer={runPrimer}
                  sv={sv}
                />
              }
            />
          </div>

          <div className={styles.main}>
            {loading ? (
              <UiState
                kind="loading"
                message={
                  sv
                    ? "Hämtar instrumentet… Första gången ett instrument öppnas hämtas det direkt från källan."
                    : "Loading instrument… The first time an instrument is opened it is fetched from the source."
                }
              />
            ) : null}

            {!loading && error ? (
              <div className={styles.errorBlock}>
                <UiState kind="error" message={error} />
                <button type="button" className={styles.retry} onClick={() => void load()}>
                  {sv ? "Försök igen" : "Try again"}
                </button>
              </div>
            ) : null}

            {!loading && detail ? (
              <div ref={tabsRef}>
                <InstrumentTabs detail={detail} sv={sv} primer={primer} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Workspace>
  );
}
