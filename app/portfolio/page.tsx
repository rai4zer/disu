"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import type { BrokerConnection, Position } from "@/app/lib/brokers/types";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";

type ProviderInfo = {
  id: string;
  name: string;
  implemented: boolean;
};

type BrokersResponse = {
  providers: ProviderInfo[];
  connections: BrokerConnection[];
};

type PositionsResponse = {
  positions: Position[];
  connections: BrokerConnection[];
};

type ConnectResponse = {
  authUrl?: string;
};

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value: string | null, isSv: boolean): string {
  if (!value) {
    return isSv ? "Aldrig" : "Never";
  }

  return new Intl.DateTimeFormat(isSv ? "sv-SE" : "en-US", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function PortfolioPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyBroker, setBusyBroker] = useState<string | null>(null);
  const [uploadingBroker, setUploadingBroker] = useState<string | null>(null);
  const [syncingConnection, setSyncingConnection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const loadBrokers = useCallback(async () => {
    const response = await fetch("/api/brokers", {
      method: "GET",
      cache: "no-store"
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(isSv ? "Kunde inte läsa in mäklarleverantörer" : "Could not load broker providers");
    }

    const data = (await response.json()) as BrokersResponse;
    setProviders(data.providers);
    setConnections(data.connections);
  }, [isSv]);

  const loadPositions = useCallback(async () => {
    const response = await fetch("/api/portfolio/positions", {
      method: "GET",
      cache: "no-store"
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(isSv ? "Kunde inte läsa in innehav" : "Could not load positions");
    }

    const data = (await response.json()) as PositionsResponse;
    setConnections(data.connections);
    setPositions(data.positions);
  }, [isSv]);

  const refresh = useCallback(async () => {
    setError(null);

    try {
      await Promise.all([loadBrokers(), loadPositions()]);
    } catch (refreshError) {
      if (refreshError instanceof Error && refreshError.message === "UNAUTHORIZED") {
        router.replace("/auth/login?next=/portfolio");
        return;
      }
      setError(isSv ? "Kunde inte läsa in mäklardata. Försök igen." : "Unable to load broker data. Try again.");
    } finally {
      setLoading(false);
    }
  }, [isSv, loadBrokers, loadPositions, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect(broker: string) {
    setBusyBroker(broker);
    setError(null);

    try {
      const response = await fetch("/api/brokers/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ broker })
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        throw new Error(isSv ? "Kunde inte ansluta mäklare" : "Could not connect broker");
      }

      const data = (await response.json()) as ConnectResponse;
      await loadBrokers();

      if (data.authUrl) {
        router.push(data.authUrl);
      }
    } catch {
      setError(isSv ? "Mäklaranslutning misslyckades." : "Broker connection failed.");
    } finally {
      setBusyBroker(null);
    }
  }

  async function handleSync(connectionId: string) {
    setSyncingConnection(connectionId);
    setError(null);

    try {
      const response = await fetch(`/api/brokers/${connectionId}/sync`, {
        method: "POST"
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        throw new Error(isSv ? "Kunde inte synkronisera" : "Could not sync");
      }

      await loadPositions();
    } catch {
      setError(isSv ? "Synk misslyckades för vald mäklaranslutning." : "Sync failed for selected broker connection.");
    } finally {
      setSyncingConnection(null);
    }
  }

  async function handleAvanzaCsvUpload(file: File) {
    setUploadingBroker("avanza");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/brokers/avanza/import", {
        method: "POST",
        body: formData
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? (isSv ? "Kunde inte importera fil" : "Unable to import file"));
      }

      await loadPositions();
      await loadBrokers();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : isSv ? "Avanza CSV-import misslyckades." : "Avanza CSV import failed.";
      setError(message);
    } finally {
      setUploadingBroker(null);
    }
  }

  const totalMarketValue = positions.reduce((sum, row) => sum + row.marketValue, 0);
  const totalQuantity = positions.reduce((sum, row) => sum + row.quantity, 0);
  const connectedCount = connections.filter((connection) => connection.status === "connected").length;
  const staleCount = connections.filter((connection) => connection.status !== "connected").length;
  const primaryCurrency = positions[0]?.currency ?? "SEK";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Portfölj" : "Portfolio"}
        subtitle={isSv ? "Koppla mäklare, synka konton och håll innehav uppdaterade." : "Connect brokers, sync accounts, and keep holdings execution-ready."}
      >
        <section className={`${styles.overview} appSection`} aria-label={isSv ? "Portföljöversikt" : "Portfolio snapshot"}>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Totalt marknadsvärde" : "Total market value"}</p>
            <p className={styles.kpiValue}>{formatMoney(totalMarketValue, primaryCurrency)}</p>
          </article>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Positioner" : "Positions"}</p>
            <p className={styles.kpiValue}>{positions.length}</p>
            <p className={styles.kpiMeta}>{totalQuantity.toLocaleString("sv-SE")} {isSv ? "aktier" : "shares"}</p>
          </article>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Anslutna mäklare" : "Connected brokers"}</p>
            <p className={styles.kpiValue}>{connectedCount}</p>
            <p className={styles.kpiMeta}>{isSv ? `${staleCount} behöver verifieras` : `${staleCount} needs verification`}</p>
          </article>
        </section>

        <section className={styles.actions}>
          <button className={styles.secondaryBtn} type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? (isSv ? "Uppdaterar..." : "Refreshing...") : isSv ? "Uppdatera data" : "Refresh data"}
          </button>
        </section>

        <section className={`${styles.connectors} appSection`}>
          <div className={styles.sectionHead}>
            <h2>{isSv ? "Mäklaranslutningar" : "Broker Connections"}</h2>
            <p>{isSv ? "Anslut leverantörer och importera kontopositioner." : "Connect providers and import account positions."}</p>
          </div>
        {loading && <p className={styles.helper}>{isSv ? "Läser in mäklarkonfiguration..." : "Loading broker configuration..."}</p>}
        {!loading && providers.length === 0 && <p className={styles.helper}>{isSv ? "Inga mäklarleverantörer är konfigurerade." : "No broker providers configured."}</p>}
        {!loading && providers.length > 0 && (
          <div className={styles.connectorGrid}>
            {providers.map((provider) => {
              const isBusy = busyBroker === provider.id;
              const providerConnections = connections.filter((connection) => connection.broker === provider.id);

              return (
                <article key={provider.id} className={styles.connectorCard}>
                  <div>
                    <h3>{provider.name}</h3>
                    <p>
                      {provider.id === "nordnet"
                        ? isSv ? "Vidarekopplar till kontoverifiering" : "Redirects to account verification"
                        : isSv ? "Verifiera konto, importera sedan CSV" : "Verify account, then import CSV"}
                    </p>
                  </div>
                  <button
                    className={styles.secondaryBtn}
                    type="button"
                    onClick={() => void handleConnect(provider.id)}
                    disabled={isBusy}
                  >
                    {isBusy ? (isSv ? "Startar..." : "Starting...") : isSv ? "Anslut" : "Connect"}
                  </button>
                  {provider.id === "avanza" && (
                    <label className={styles.uploadWrap}>
                      <span>{uploadingBroker === "avanza" ? (isSv ? "Importerar..." : "Importing...") : isSv ? "Importera Avanza CSV" : "Import Avanza CSV"}</span>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        disabled={uploadingBroker === "avanza"}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void handleAvanzaCsvUpload(file);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                  <p className={styles.helper}>{isSv ? "Anslutna konton" : "Connected accounts"}: {providerConnections.length}</p>
                </article>
              );
            })}
          </div>
        )}
        </section>

        <section className={`${styles.connections} appSection`}>
          <div className={styles.sectionHead}>
            <h2>{isSv ? "Aktiva anslutningar" : "Active Connections"}</h2>
            <p>{isSv ? "Verifiera och synka varje anslutet konto." : "Verify and sync each linked account."}</p>
          </div>
        {connections.length === 0 ? (
          <p className={styles.helper}>{isSv ? "Inga mäklare anslutna ännu." : "No brokers connected yet."}</p>
        ) : (
          <div className={styles.connectionList}>
            {connections.map((connection) => {
              const isSyncing = syncingConnection === connection.id;

              return (
                <article className={styles.connectionCard} key={connection.id}>
                  <div>
                    <p className={styles.connectionBroker}>{connection.broker.toUpperCase()}</p>
                    <p className={styles.connectionMeta}>{isSv ? "Konto" : "Account"}: {connection.externalAccountId ?? "N/A"}</p>
                    <p className={styles.connectionMeta}>{isSv ? "Senaste synk" : "Last sync"}: {formatDate(connection.lastSyncedAt, isSv)}</p>
                  </div>
                  <div className={styles.connectionActions}>
                    <span className={styles.statusBadge}>{connection.status}</span>
                    {connection.status === "connected" ? (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        disabled={isSyncing}
                        onClick={() => void handleSync(connection.id)}
                      >
                        {isSyncing ? (isSv ? "Synkar..." : "Syncing...") : isSv ? "Synka" : "Sync"}
                      </button>
                    ) : (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() =>
                          router.push(`/portfolio/authenticate?broker=${connection.broker}&connectionId=${connection.id}`)
                        }
                      >
                        {isSv ? "Verifiera" : "Verify"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        </section>

        <section className={`${styles.holdings} appSection`}>
          <div className={styles.sectionHead}>
            <h2>{isSv ? "Innehav" : "Holdings"}</h2>
            <p>{isSv ? "Öppna varje position i Sentiment, Quant eller Primers." : "Open each position in Sentiment, Quant, or Primers."}</p>
          </div>
          <div className={styles.tableHead}>
            <span>{isSv ? "Symbol" : "Symbol"}</span>
            <span>{isSv ? "Namn" : "Name"}</span>
            <span>{isSv ? "Antal" : "Qty"}</span>
            <span>{isSv ? "Marknadsvärde" : "Market Value"}</span>
            <span>{isSv ? "Åtgärder" : "Actions"}</span>
          </div>
          {positions.map((row) => (
            <div className={styles.tableRow} key={row.id}>
              <span className={styles.ticker}>{row.symbol}</span>
              <span>{row.name}</span>
              <span>{row.quantity}</span>
              <span>{formatMoney(row.marketValue, row.currency)}</span>
              <span className={styles.inlineActions}>
                <Link href="/sentiment">Sentiment</Link>
                <Link href="/quant">Quant</Link>
                <Link href="/primers">Primers</Link>
              </span>
            </div>
          ))}
          {!loading && positions.length === 0 && <p className={styles.emptyTable}>{isSv ? "Inga positioner importerade ännu." : "No positions imported yet."}</p>}
        </section>

        {error && <p className={`${styles.error} appError`}>{error}</p>}
      </Workspace>
    </main>
  );
}
