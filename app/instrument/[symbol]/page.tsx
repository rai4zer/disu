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
import { useCallback, useEffect, useState } from "react";
import StockChart from "@/app/components/stock-chart";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import type { InstrumentDetail } from "@/app/lib/market/instrument-types";
import type { GatedSection } from "@/app/lib/market/instrument-visibility";
import InstrumentTabs from "./instrument-tabs";
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

        {/* The chart is the existing component and reads the existing history
            route, so it works for any symbol the page can be opened for. */}
        <section className={styles.chartCard}>
          <StockChart symbol={symbol} />
        </section>

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

        {!loading && detail ? <InstrumentTabs detail={detail} sv={sv} /> : null}
      </div>
    </Workspace>
  );
}
