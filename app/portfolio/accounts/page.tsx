"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Workspace from "@/app/components/workspace";
import UiState from "@/app/components/ui-state";
import { useLanguage } from "@/app/i18n/language";
import type { BrokerConnection, BrokerConnectionAccount, BrokerDataScope } from "@/app/lib/brokers/types";
import styles from "./page.module.css";

type AccountsResponse = {
  connection: BrokerConnection;
  accounts: BrokerConnectionAccount[];
};

export default function BrokerAccountsSelectionPage() {
  return (
    <Suspense fallback={null}>
      <BrokerAccountsSelectionContent />
    </Suspense>
  );
}

function accountTypeLabel(type: BrokerConnectionAccount["accountType"], isSv: boolean): string {
  if (type === "isk") return "ISK";
  if (type === "kf") return "KF";
  if (type === "af") return "AF";
  return isSv ? "Övrigt" : "Other";
}

function BrokerAccountsSelectionContent() {
  const router = useRouter();
  const { language } = useLanguage();
  const isSv = language === "sv";
  const searchParams = useSearchParams();
  const connectionId = (searchParams.get("connectionId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<BrokerConnection | null>(null);
  const [accounts, setAccounts] = useState<BrokerConnectionAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dataScope, setDataScope] = useState<BrokerDataScope>("symbols_only");

  useEffect(() => {
    if (!connectionId) {
      setError(isSv ? "Saknar anslutnings-ID." : "Missing connection id.");
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/brokers/${encodeURIComponent(connectionId)}/accounts`, {
          method: "GET",
          cache: "no-store"
        });

        if (response.status === 401) {
          router.replace(`/auth/login?next=${encodeURIComponent(`/portfolio/accounts?connectionId=${connectionId}`)}`);
          return;
        }
        if (!response.ok) {
          throw new Error(isSv ? "Kunde inte läsa konton." : "Could not load accounts.");
        }

        const payload = (await response.json()) as AccountsResponse;
        setConnection(payload.connection);
        setAccounts(payload.accounts);
        setSelectedIds(new Set(payload.accounts.filter((item) => item.selected).map((item) => item.providerAccountId)));
        setDataScope(payload.connection.dataScope);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : isSv ? "Okänt fel" : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [connectionId, isSv, router]);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  async function handleSave() {
    if (!connectionId) return;

    setSaving(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`/api/brokers/${encodeURIComponent(connectionId)}/accounts`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          selectedAccountIds: [...selectedIds],
          dataScope
        })
      });
      window.clearTimeout(timeout);

      if (response.status === 401) {
        router.replace(`/auth/login?next=${encodeURIComponent(`/portfolio/accounts?connectionId=${connectionId}`)}`);
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? (isSv ? "Kunde inte spara val." : "Could not save selection."));
      }

      window.location.assign("/portfolio");
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === "AbortError") {
        setError(isSv ? "Tidsgränsen för att spara nåddes. Försök igen." : "Saving timed out. Please try again.");
        return;
      }
      setError(saveError instanceof Error ? saveError.message : isSv ? "Okänt fel" : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Välj konton" : "Choose accounts"}
        subtitle={
          isSv
            ? "Välj vilka konton som ska kopplas in till DISU och vilken datanivå som ska importeras."
            : "Choose which accounts to connect to DISU and what data level to import."
        }
        size="narrow"
      >
        {loading ? (
          <UiState kind="loading" message={isSv ? "Hämtar konton..." : "Loading accounts..."} />
        ) : null}

        {!loading && error ? <UiState kind="error" message={error} /> : null}

        {!loading && !error ? (
          <section className={`${styles.card} appSection`}>
            <p className={styles.kicker}>{connection?.broker.toUpperCase() ?? "BROKER"}</p>

            <h2>{isSv ? "Konto-urval" : "Account selection"}</h2>

            <p className={styles.note}>
              {isSv
                ? "Standard är symboler-only (ingen net worth, antal eller anskaffningsvärde)."
                : "Default is symbols-only (no net worth, share count, or cost basis)."}
            </p>

            <div className={styles.scopeGrid}>
              <label className={styles.scopeOption}>
                <input
                  type="radio"
                  name="dataScope"
                  value="symbols_only"
                  checked={dataScope === "symbols_only"}
                  onChange={() => setDataScope("symbols_only")}
                />
                <span>
                  <strong>{isSv ? "Symboler (rekommenderat)" : "Symbols only (recommended)"}</strong>
                  <small>{isSv ? "Importerar endast ticker-symboler." : "Imports ticker symbols only."}</small>
                </span>
              </label>

              <label className={styles.scopeOption}>
                <input
                  type="radio"
                  name="dataScope"
                  value="positions_plus"
                  checked={dataScope === "positions_plus"}
                  onChange={() => setDataScope("positions_plus")}
                />
                <span>
                  <strong>{isSv ? "Positioner+" : "Positions+"}</strong>
                  <small>{isSv ? "Importerar symbol, antal och anskaffningsvärde." : "Imports symbol, quantity, and cost basis."}</small>
                </span>
              </label>
            </div>

            <div className={styles.accounts}>
              {accounts.map((account) => {
                const checked = selectedIds.has(account.providerAccountId);
                return (
                  <label key={account.id} className={styles.accountRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) {
                            next.add(account.providerAccountId);
                          } else {
                            next.delete(account.providerAccountId);
                          }
                          return next;
                        });
                      }}
                    />
                    <span className={styles.accountText}>
                      <strong>{account.providerAccountName}</strong>
                      <small>{accountTypeLabel(account.accountType, isSv)}</small>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className={styles.actions}>
              <button
                className="appButton"
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || selectedCount === 0}
              >
                {saving ? (isSv ? "Sparar..." : "Saving...") : isSv ? "Spara och fortsätt" : "Save and continue"}
              </button>
              <button className="appButtonSecondary" type="button" onClick={() => router.push("/portfolio")}>
                {isSv ? "Avbryt" : "Cancel"}
              </button>
            </div>
          </section>
        ) : null}
      </Workspace>
    </main>
  );
}
