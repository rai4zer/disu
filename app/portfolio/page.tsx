"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import type { BrokerConnection, BrokerProvider } from "@/app/lib/brokers/types";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import UiState from "@/app/components/ui-state";
import TickerAutocomplete from "@/app/components/ticker-autocomplete";
import { inferCurrencyFromTicker } from "@/app/lib/market/market-provider";

type ProviderInfo = {
  id: BrokerProvider;
  name: string;
  integration: "tink" | "csv" | "direct_api";
  implemented: boolean;
  connectable: boolean;
  note: string;
};

type BrokersResponse = {
  providers: ProviderInfo[];
  connections: BrokerConnection[];
};

type PositionsResponse = {
  positions: PortfolioPosition[];
  totals: PortfolioTotals;
  connections: BrokerConnection[];
};

type ConnectResponse = {
  authUrl?: string;
};

type DiagnosticsResponse = {
  report: {
    token: {
      expiresAt: string | null;
      isExpired: boolean;
      scope: string | null;
    };
    selectedAccounts: string[];
    accountsEndpoint: {
      ok: boolean;
      status: number;
      count: number;
      rawCount?: number;
      topLevelKeys?: string[];
      sampleItemKeys?: string[];
      error?: string;
    };
    investmentAccountsEndpoint: {
      ok: boolean;
      status: number;
      count: number;
      rawCount?: number;
      topLevelKeys?: string[];
      sampleItemKeys?: string[];
      error?: string;
    };
    holdingsEndpoints: Array<{
      path: string;
      ok: boolean;
      status: number;
      count: number;
      rawCount?: number;
      topLevelKeys?: string[];
      sampleItemKeys?: string[];
      error?: string;
    }>;
  };
};

type PortfolioPosition = {
  id: string;
  source: "broker" | "manual";
  ticker: string;
  symbol: string;
  name: string;
  shares: number;
  quantity: number;
  avgCost: number | null;
  currentPrice: number | null;
  positionValue: number | null;
  marketValue: number;
  unrealizedPnl: number | null;
  accountType: "ISK" | "AF" | "KF" | "Other" | null;
  broker: string | null;
  currency: string;
  asOf: string;
  connectionId: string | null;
  previousClose?: number | null;
  dayChangePct?: number | null;
  dayChangeAmount?: number | null;
  priceSource?: "yahoo" | "finnhub" | "placeholder" | "broker" | "unavailable";
  // True when currentPrice is a placeholder rather than observed market data.
  synthetic?: boolean;
  // positionValue converted into the display currency, or null when no FX rate
  // was available. Never summed here — see PortfolioTotals.
  valueInDisplayCurrency?: number | null;
};

/**
 * Mirrors PortfolioTotals in app/lib/portfolio/portfolio-positions.ts. The
 * server computes it next to the rows so this page never has to add two
 * currencies together — which is exactly what it used to do (ROADMAP §2.7).
 * `tests/portfolio-currency.test.ts` asserts the two shapes stay in step.
 */
type PortfolioTotals = {
  displayCurrency: string;
  total: number;
  positionCount: number;
  convertedCount: number;
  unconvertedCount: number;
  unconvertedCurrencies: string[];
  syntheticCount: number;
  unavailableCount: number;
};

type CreatePositionResponse = {
  position: PortfolioPosition;
};

type PositionFormErrors = Partial<Record<"ticker" | "shares" | "averageCost" | "submit", string>>;
type EditPositionResponse = {
  position: PortfolioPosition;
};
type EditDraft = {
  ticker: string;
  shares: string;
  avgCost: string;
  accountType: PortfolioPosition["accountType"];
  broker: string;
  currency: string;
};

// CSV providers we can actually take a file for. Avanza is the only importer
// today (/api/brokers/avanza/import); a CSV provider without an endpoint would
// otherwise render a file picker that posts the file nowhere.
const CSV_IMPORT_ENDPOINTS = new Set<string>(["avanza"]);

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

function formatConnectionStatus(status: BrokerConnection["status"], isSv: boolean): string {
  if (status === "connected") return isSv ? "Ansluten" : "Connected";
  if (status === "awaiting_account_selection") return isSv ? "Välj konton" : "Choose accounts";
  if (status === "pending") return isSv ? "Pågår" : "In progress";
  if (status === "error") return isSv ? "Fel" : "Error";
  return status;
}

function getAccountPillLabel(row: PortfolioPosition): string {
  const account = row.accountType ?? "Other";
  const broker = row.broker?.trim() || row.name;
  return `${account}-${broker}`;
}

function getAccountPillClass(stylesObj: Record<string, string>, accountType: PortfolioPosition["accountType"]): string {
  if (accountType === "AF") return `${stylesObj.accountBadge} ${stylesObj.accountBadgeAf}`;
  if (accountType === "ISK") return `${stylesObj.accountBadge} ${stylesObj.accountBadgeIsk}`;
  return stylesObj.accountBadge;
}

export default function PortfolioPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyBroker, setBusyBroker] = useState<string | null>(null);
  const [uploadingBroker, setUploadingBroker] = useState<string | null>(null);
  const [syncingConnection, setSyncingConnection] = useState<string | null>(null);
  const [diagnosingConnection, setDiagnosingConnection] = useState<string | null>(null);
  const [removingConnection, setRemovingConnection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticSummary, setDiagnosticSummary] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  // Computed by the server alongside the rows. Null until the first load, and
  // after an optimistic edit that has not been reconciled yet.
  const [totals, setTotals] = useState<PortfolioTotals | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [savingPosition, setSavingPosition] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [formErrors, setFormErrors] = useState<PositionFormErrors>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [ticker, setTicker] = useState("");
  const [sharesInput, setSharesInput] = useState("");
  const [avgCostInput, setAvgCostInput] = useState("");
  const [accountType, setAccountType] = useState<PortfolioPosition["accountType"]>(null);
  const [brokerInput, setBrokerInput] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    setTotals(data.totals ?? null);
  }, [isSv]);

  const refresh = useCallback(async () => {
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const brokerError = (params.get("brokerError") ?? "").trim();
    if (!brokerError) {
      return;
    }
    const errorCode = (params.get("brokerErrorCode") ?? "").trim();
    const errorDescription = (params.get("brokerErrorDescription") ?? "").trim();
    const base = isSv ? "Bankanslutningen misslyckades. Försök igen." : "Bank connection failed. Please try again.";
    const detailParts = [brokerError, errorCode, errorDescription].filter(Boolean);
    setError(detailParts.length > 0 ? `${base} (${detailParts.join(" | ")})` : base);
  }, [isSv]);

  useEffect(() => {
    const connectable = providers.filter((provider) => provider.integration !== "csv");
    if (connectable.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId("");
      }
      return;
    }
    const exists = connectable.some((provider) => provider.id === selectedProviderId);
    if (!exists) {
      setSelectedProviderId(connectable[0].id);
    }
  }, [providers, selectedProviderId]);

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
    setDiagnosticSummary(null);

    try {
      const response = await fetch(`/api/brokers/${connectionId}/sync`, {
        method: "POST"
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        if (payload.code === "tink_reconsent_required") {
          throw new Error(
            isSv
              ? "Bankanslutningen behöver godkännas på nytt. Klicka Anslut och verifiera igen."
              : "Bank connection requires re-consent. Click Connect and authenticate again."
          );
        }
        if (payload.code === "tink_mock_accounts_selected") {
          throw new Error(
            isSv
              ? "Valda konton är testkonton. Anslut banken igen för att hämta riktiga konton från Tink."
              : "Selected accounts are mock test accounts. Reconnect broker to load real Tink accounts."
          );
        }
        throw new Error(payload.error ?? (isSv ? "Kunde inte synkronisera" : "Could not sync"));
      }

      await loadPositions();
      await loadBrokers();
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : isSv
            ? "Synk misslyckades för vald mäklaranslutning."
            : "Sync failed for selected broker connection."
      );
    } finally {
      setSyncingConnection(null);
    }
  }

  async function handleRemove(connectionId: string, providerName: string) {
    const confirmed = window.confirm(
      isSv
        ? `Ta bort anslutningen till ${providerName}? Synkade innehav från den tas också bort. Manuella innehav påverkas inte.`
        : `Remove the ${providerName} connection? Positions synced from it are removed too. Manual holdings are not affected.`
    );
    if (!confirmed) {
      return;
    }

    setRemovingConnection(connectionId);
    setError(null);
    setDiagnosticSummary(null);

    try {
      const response = await fetch(`/api/brokers/${connectionId}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? (isSv ? "Kunde inte ta bort anslutningen" : "Could not remove connection"));
      }

      await loadBrokers();
      await loadPositions();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : isSv
            ? "Kunde inte ta bort anslutningen."
            : "Could not remove connection."
      );
    } finally {
      setRemovingConnection(null);
    }
  }

  async function handleDiagnose(connectionId: string) {
    setDiagnosingConnection(connectionId);
    setError(null);
    setDiagnosticSummary(null);

    try {
      const response = await fetch(`/api/brokers/${connectionId}/diagnostics`, {
        method: "GET",
        cache: "no-store"
      });

      if (response.status === 401) {
        router.replace("/auth/login?next=/portfolio");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? (isSv ? "Diagnostik misslyckades." : "Diagnostics failed."));
      }

      const payload = (await response.json()) as DiagnosticsResponse;
      const report = payload.report;
      const holdingsPart = report.holdingsEndpoints
        .map((item) => {
          const raw = typeof item.rawCount === "number" ? item.rawCount : item.count;
          const keys = item.topLevelKeys?.length ? ` keys=${item.topLevelKeys.join(",")}` : "";
          const sample = item.sampleItemKeys?.length ? ` item=${item.sampleItemKeys.join(",")}` : "";
          return `${item.path}=${item.status}/${item.count} raw=${raw}${keys}${sample}${item.error ? `(${item.error})` : ""}`;
        })
        .join(" | ");
      const summary = [
        `tokenExpired=${report.token.isExpired}`,
        `scope=${report.token.scope ?? "none"}`,
        `accounts=${report.accountsEndpoint.status}/${report.accountsEndpoint.count} raw=${report.accountsEndpoint.rawCount ?? report.accountsEndpoint.count}`,
        `investmentAccounts=${report.investmentAccountsEndpoint.status}/${report.investmentAccountsEndpoint.count} raw=${
          report.investmentAccountsEndpoint.rawCount ?? report.investmentAccountsEndpoint.count
        }`,
        `holdings=${holdingsPart || "none"}`
      ].join(" | ");
      setDiagnosticSummary(summary);
    } catch (diagnoseError) {
      setError(diagnoseError instanceof Error ? diagnoseError.message : isSv ? "Diagnostik misslyckades." : "Diagnostics failed.");
    } finally {
      setDiagnosingConnection(null);
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
      const message =
        uploadError instanceof Error ? uploadError.message : isSv ? "Avanza CSV-import misslyckades." : "Avanza CSV import failed.";
      setError(message);
    } finally {
      setUploadingBroker(null);
    }
  }

  function resetAddForm() {
    setTicker("");
    setSharesInput("");
    setAvgCostInput("");
    setAccountType(null);
    setBrokerInput("");
    setCurrency("USD");
    setFormErrors({});
  }

  async function handleAddPosition() {
    const nextErrors: PositionFormErrors = {};
    const normalizedTicker = ticker.trim().toUpperCase();
    const shares = Number(sharesInput);
    const averageCost = avgCostInput.trim().length ? Number(avgCostInput) : null;
    const normalizedCurrency = currency.trim().toUpperCase();

    if (!/^[A-Z0-9.\-]{1,16}$/.test(normalizedTicker)) {
      nextErrors.ticker = isSv ? "Ange en giltig ticker." : "Enter a valid ticker.";
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      nextErrors.shares = isSv ? "Ange antal större än 0." : "Shares must be greater than 0.";
    }
    if (averageCost !== null && (!Number.isFinite(averageCost) || averageCost < 0)) {
      nextErrors.averageCost = isSv ? "Snittkurs måste vara 0 eller högre." : "Average cost must be 0 or higher.";
    }

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticPrice = 0;
    const optimisticValue = shares * optimisticPrice;
    const optimisticPnl = averageCost === null ? null : shares * (optimisticPrice - averageCost);
    const optimisticRow: PortfolioPosition = {
      id: optimisticId,
      source: "manual",
      ticker: normalizedTicker,
      symbol: normalizedTicker,
      name: normalizedTicker,
      shares,
      quantity: shares,
      avgCost: averageCost,
      currentPrice: optimisticPrice,
      positionValue: optimisticValue,
      marketValue: optimisticValue,
      unrealizedPnl: optimisticPnl,
      accountType,
      broker: brokerInput.trim() || null,
      currency: normalizedCurrency || inferCurrencyFromTicker(normalizedTicker),
      asOf: new Date().toISOString(),
      connectionId: null
    };

    setSavingPosition(true);
    setPositions((rows) => [optimisticRow, ...rows]);

    try {
      const response = await fetch("/api/portfolio/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: normalizedTicker,
          shares,
          average_cost: averageCost,
          account_type: accountType,
          broker: brokerInput.trim() || null,
          currency: normalizedCurrency || inferCurrencyFromTicker(normalizedTicker)
        })
      });
      const payload = (await response.json().catch(() => ({}))) as CreatePositionResponse & { error?: string };
      if (!response.ok || !payload.position) {
        throw new Error(payload.error ?? (isSv ? "Kunde inte spara positionen." : "Could not save position."));
      }
      setPositions((rows) => [payload.position, ...rows.filter((row) => row.id !== optimisticId)]);
      resetAddForm();
    } catch (submitError) {
      setPositions((rows) => rows.filter((row) => row.id !== optimisticId));
      setFormErrors((current) => ({
        ...current,
        submit: submitError instanceof Error ? submitError.message : isSv ? "Kunde inte spara positionen." : "Could not save position."
      }));
    } finally {
      setSavingPosition(false);
    }
  }

  function startEditPosition(row: PortfolioPosition) {
    if (row.source !== "manual") {
      return;
    }
    setEditingPositionId(row.id);
    setEditDraft({
      ticker: row.ticker,
      shares: String(row.shares),
      avgCost: row.avgCost === null ? "" : String(row.avgCost),
      accountType: row.accountType,
      broker: row.broker ?? "",
      currency: row.currency
    });
    setEditErrors((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
  }

  function cancelEditPosition() {
    setEditingPositionId(null);
    setEditDraft(null);
  }

  async function saveEditPosition(positionId: string) {
    if (!editDraft) {
      return;
    }

    const normalizedTicker = editDraft.ticker.trim().toUpperCase();
    const shares = Number(editDraft.shares);
    const averageCost = editDraft.avgCost.trim().length ? Number(editDraft.avgCost) : null;
    const normalizedCurrency = editDraft.currency.trim().toUpperCase();

    if (!/^[A-Z0-9.\-]{1,16}$/.test(normalizedTicker)) {
      setEditErrors((current) => ({ ...current, [positionId]: isSv ? "Ogiltig ticker." : "Invalid ticker." }));
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setEditErrors((current) => ({ ...current, [positionId]: isSv ? "Antal måste vara > 0." : "Shares must be > 0." }));
      return;
    }
    if (averageCost !== null && (!Number.isFinite(averageCost) || averageCost < 0)) {
      setEditErrors((current) => ({
        ...current,
        [positionId]: isSv ? "Snittkurs måste vara 0 eller högre." : "Average cost must be 0 or higher."
      }));
      return;
    }

    setSavingEditId(positionId);
    setEditErrors((current) => {
      const next = { ...current };
      delete next[positionId];
      return next;
    });

    try {
      const response = await fetch(`/api/portfolio/positions/${encodeURIComponent(positionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: normalizedTicker,
          shares,
          average_cost: averageCost,
          account_type: editDraft.accountType,
          broker: editDraft.broker.trim() || null,
          currency: normalizedCurrency || inferCurrencyFromTicker(normalizedTicker)
        })
      });
      const payload = (await response.json().catch(() => ({}))) as EditPositionResponse & { error?: string };
      if (!response.ok || !payload.position) {
        throw new Error(payload.error ?? (isSv ? "Kunde inte uppdatera positionen." : "Could not update position."));
      }

      setPositions((rows) => rows.map((row) => (row.id === positionId ? payload.position : row)));
      setEditingPositionId(null);
      setEditDraft(null);
    } catch (updateError) {
      setEditErrors((current) => ({
        ...current,
        [positionId]: updateError instanceof Error ? updateError.message : isSv ? "Kunde inte uppdatera." : "Could not update."
      }));
    } finally {
      setSavingEditId(null);
    }
  }

  async function deletePosition(positionId: string) {
    const currentRows = positions;
    const row = currentRows.find((entry) => entry.id === positionId);
    if (!row || row.source !== "manual") {
      return;
    }

    setDeletingId(positionId);
    setEditErrors((current) => {
      const next = { ...current };
      delete next[positionId];
      return next;
    });
    setPositions((rows) => rows.filter((entry) => entry.id !== positionId));

    try {
      const response = await fetch(`/api/portfolio/positions/${encodeURIComponent(positionId)}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? (isSv ? "Kunde inte ta bort positionen." : "Could not delete position."));
      }
      if (editingPositionId === positionId) {
        cancelEditPosition();
      }
    } catch (deleteError) {
      setPositions(currentRows);
      setEditErrors((current) => ({
        ...current,
        [positionId]: deleteError instanceof Error ? deleteError.message : isSv ? "Kunde inte ta bort." : "Could not delete."
      }));
    } finally {
      setDeletingId(null);
    }
  }

  // The total comes from the server, already converted into one currency.
  // It used to be `positions.reduce((sum, row) => sum + row.positionValue, 0)`
  // labelled with `positions[0].currency` — which added SEK to USD and then
  // named the result after whichever holding happened to sort first, so the
  // same portfolio showed a different total after a re-sort (ROADMAP §2.7, D5).
  // A total is only a number when every term shares a unit.
  //
  // A total that includes placeholder-priced rows is itself partly synthetic and
  // must say so (docs/synthetic-data-policy.md).
  const syntheticCount = totals?.syntheticCount ?? positions.filter((row) => row.synthetic === true).length;
  const totalQuantity = positions.reduce((sum, row) => sum + row.shares, 0);
  const connectedCount = connections.filter((connection) => connection.status === "connected").length;
  const staleCount = connections.filter((connection) => connection.status !== "connected").length;
  const manualPositionsCount = positions.filter((row) => row.source === "manual").length;
  // Split by integration: a CSV provider is a file upload (ladder step 2), a
  // Tink/API provider is an OAuth redirect (step 3). They were in one control,
  // which is why the file import was only reachable by picking Avanza from a
  // dropdown labelled "connect bank or broker".
  const csvProviders = useMemo(
    () => providers.filter((provider) => provider.integration === "csv" && CSV_IMPORT_ENDPOINTS.has(provider.id)),
    [providers]
  );
  const connectProviders = useMemo(() => providers.filter((provider) => provider.integration !== "csv"), [providers]);
  const selectedProvider = connectProviders.find((provider) => provider.id === selectedProviderId) ?? null;
  const connectionByBroker = useMemo(
    () => new Map(connections.map((connection) => [connection.broker, connection])),
    [connections]
  );
  const connectedRows = useMemo(
    () =>
      providers
        .map((provider) => ({ provider, connection: connectionByBroker.get(provider.id) ?? null }))
        .filter((row) => row.connection !== null),
    [providers, connectionByBroker]
  );

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Portfölj" : "Portfolio"}
        subtitle={
          isSv
            ? "Lägg till innehav på tio sekunder, importera en fil eller koppla din bank."
            : "Add a holding in ten seconds, import a file, or connect your bank."
        }
      >
        <section className={`${styles.overview} appSection`} aria-label={isSv ? "Portföljöversikt" : "Portfolio snapshot"}>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Totalt marknadsvärde" : "Total market value"}</p>
            <p className={styles.kpiValue}>
              {totals === null ? "—" : formatMoney(totals.total, totals.displayCurrency)}
            </p>
            {totals !== null && totals.unavailableCount > 0 ? (
              <p className={styles.kpiSynthetic}>
                {isSv
                  ? `Live marknadsdata saknas för ${totals.unavailableCount} innehav — de ingår inte i summan.`
                  : `Live market data is unavailable for ${totals.unavailableCount} holding(s) — they are not included in the total.`}
              </p>
            ) : null}
            {totals !== null && totals.unconvertedCount > 0 ? (
              <p className={styles.kpiSynthetic}>
                {isSv
                  ? `Visar ${totals.convertedCount} av ${totals.positionCount} innehav. Saknar växelkurs för ${totals.unconvertedCurrencies.join(", ")}.`
                  : `Covers ${totals.convertedCount} of ${totals.positionCount} holdings. No exchange rate for ${totals.unconvertedCurrencies.join(", ")}.`}
              </p>
            ) : null}
            {syntheticCount > 0 ? (
              <p className={styles.kpiSynthetic}>
                {isSv
                  ? `Inkluderar ${syntheticCount} innehav med platshållarkurs — inte marknadsdata.`
                  : `Includes ${syntheticCount} holding(s) priced with a placeholder — not market data.`}
              </p>
            ) : null}
          </article>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Positioner" : "Positions"}</p>
            <p className={styles.kpiValue}>{positions.length}</p>
            <p className={styles.kpiMeta}>
              {totalQuantity.toLocaleString("sv-SE")} {isSv ? "aktier" : "shares"}
            </p>
          </article>
          <article className={styles.kpiCard}>
            <p className={styles.kpiLabel}>{isSv ? "Anslutna leverantörer" : "Connected providers"}</p>
            <p className={styles.kpiValue}>{connectedCount}</p>
            <p className={styles.kpiMeta}>{isSv ? `${staleCount} väntar` : `${staleCount} pending`}</p>
          </article>
        </section>

        <section className={styles.actions}>
          <div className={styles.actionButtons}>
            <button className={styles.secondaryBtn} type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? (isSv ? "Uppdaterar..." : "Refreshing...") : isSv ? "Uppdatera data" : "Refresh data"}
            </button>
          </div>
        </section>

        {/* The activation ladder, ordered by friction ascending (ROADMAP §9.4).
            Search-and-add first because it costs ten seconds and no trust; the
            bank connection last because it costs BankID and a lot of trust. The
            page used to open with the connection, which is the reverse. */}
        <section id="add-holding" className={`${styles.addPosition} appSection`}>
          <div className={styles.sectionHead}>
            <h2>
              <span className={styles.stepBadge}>1</span>
              {isSv ? "Lägg till ett innehav" : "Add a holding"}
            </h2>
            <p>
              {isSv
                ? "Tio sekunder. Sök på bolaget och ange antal aktier — resten är valfritt."
                : "Ten seconds. Search for the company and enter how many shares — the rest is optional."}
            </p>
          </div>

          <div className={styles.addGrid}>
            <div className={`${styles.field} appField`}>
              <label htmlFor="manualTicker">Ticker</label>
              <TickerAutocomplete
                id="manualTicker"
                value={ticker}
                onChange={(value) => {
                  setTicker(value.toUpperCase());
                  if (!value.trim()) {
                    setCurrency("USD");
                  }
                }}
                onPickSuggestion={(suggestion) => {
                  if (suggestion.currency) {
                    setCurrency(suggestion.currency.toUpperCase());
                  } else {
                    setCurrency(inferCurrencyFromTicker(suggestion.symbol));
                  }
                }}
                className="appInput"
                placeholder={isSv ? "AAPL eller Apple" : "AAPL or Apple"}
                required
              />
              {formErrors.ticker ? <p className={styles.fieldError}>{formErrors.ticker}</p> : null}
            </div>

            <div className={`${styles.field} appField`}>
              <label htmlFor="manualShares">{isSv ? "Antal" : "Shares"}</label>
              <input
                id="manualShares"
                className="appInput"
                type="number"
                step="any"
                inputMode="decimal"
                value={sharesInput}
                onChange={(event) => setSharesInput(event.target.value)}
                placeholder={isSv ? "t.ex. 10" : "e.g. 10"}
                required
              />
              {formErrors.shares ? <p className={styles.fieldError}>{formErrors.shares}</p> : null}
            </div>

            {/* Average cost is the field people abandon on, because they often do
                not know it (ROADMAP §9.4). It stays visible so nobody has to hunt
                for it, and it says "optional" on the label — not just in a
                placeholder — so nobody stops to look it up. */}
            <div className={`${styles.field} appField`}>
              <label htmlFor="manualAvgCost">
                {isSv ? "Snittkurs" : "Average cost"}{" "}
                <span className={styles.optionalTag}>{isSv ? "valfritt" : "optional"}</span>
              </label>
              <input
                id="manualAvgCost"
                className="appInput"
                type="number"
                step="any"
                inputMode="decimal"
                value={avgCostInput}
                onChange={(event) => setAvgCostInput(event.target.value)}
                placeholder={isSv ? "Vet du inte? Hoppa över." : "Don't know it? Skip it."}
                aria-describedby="manualAvgCostHint"
              />
              <p id="manualAvgCostHint" className={styles.fieldHint}>
                {isSv
                  ? "Utan den visar vi värde men ingen avkastning. Du kan fylla i den när som helst."
                  : "Without it we show value but no return. You can fill it in whenever."}
              </p>
              {formErrors.averageCost ? <p className={styles.fieldError}>{formErrors.averageCost}</p> : null}
            </div>

            <div className={styles.formActions}>
              <button className="appButton" type="button" onClick={() => void handleAddPosition()} disabled={savingPosition}>
                {savingPosition ? (isSv ? "Sparar..." : "Saving...") : isSv ? "Spara innehav" : "Save holding"}
              </button>
              <button className={styles.linkButton} type="button" onClick={() => setShowOptionalFields((current) => !current)}>
                {showOptionalFields ? (isSv ? "Dölj fler fält" : "Hide optional fields") : isSv ? "Fler fält" : "More fields"}
              </button>
            </div>
          </div>

          {showOptionalFields ? (
            <div className={styles.optionalGrid}>
              <div className={`${styles.field} appField`}>
                <label htmlFor="manualAccountType">{isSv ? "Kontotyp" : "Account type"}</label>
                <select
                  id="manualAccountType"
                  className="appInput"
                  value={accountType ?? ""}
                  onChange={(event) =>
                    setAccountType(
                      event.target.value ? (event.target.value as PortfolioPosition["accountType"]) : null
                    )
                  }
                >
                  <option value="">{isSv ? "Ej satt" : "Not set"}</option>
                  <option value="ISK">ISK</option>
                  <option value="AF">AF</option>
                  <option value="KF">KF</option>
                  <option value="Other">{isSv ? "Other" : "Other"}</option>
                </select>
              </div>

              <div className={`${styles.field} appField`}>
                <label htmlFor="manualBroker">{isSv ? "Mäklare" : "Broker"}</label>
                <input
                  id="manualBroker"
                  className="appInput"
                  type="text"
                  value={brokerInput}
                  onChange={(event) => setBrokerInput(event.target.value)}
                  placeholder={isSv ? "Valfritt" : "Optional"}
                />
              </div>

              <div className={`${styles.field} appField`}>
                <label htmlFor="manualCurrency">{isSv ? "Valuta" : "Currency"}</label>
                <select id="manualCurrency" className="appInput" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                  {["USD", "EUR", "SEK", "DKK", "NOK", "GBP", "CHF"].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {manualPositionsCount > 0 ? (
            <p className={styles.helper}>
              {isSv ? `${manualPositionsCount} manuella innehav` : `${manualPositionsCount} manual holdings`}
            </p>
          ) : null}

          {formErrors.submit ? <UiState kind="error" message={formErrors.submit} className={styles.error} /> : null}
        </section>

        {csvProviders.length > 0 ? (
          <section id="import-holdings" className={`${styles.importer} appSection`}>
            <div className={styles.sectionHead}>
              <h2>
                <span className={styles.stepBadge}>2</span>
                {isSv ? "Importera en fil" : "Import a file"}
              </h2>
              <p>
                {isSv
                  ? "Har du en exportfil från din depå? Ungefär en minut för hela portföljen."
                  : "Have an export from your broker? About a minute for the whole portfolio."}
              </p>
            </div>
            <div className={styles.importActions}>
              {csvProviders.map((provider) => (
                <label key={provider.id} className={styles.uploadWrap}>
                  <span>
                    {uploadingBroker === provider.id
                      ? isSv
                        ? "Importerar..."
                        : "Importing..."
                      : isSv
                        ? `Importera ${provider.name} CSV`
                        : `Import ${provider.name} CSV`}
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={uploadingBroker !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleAvanzaCsvUpload(file);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        <section className={`${styles.connectors} appSection`}>
          <div className={styles.sectionHead}>
            <h2>
              <span className={styles.stepBadge}>3</span>
              {isSv ? "Koppla din bank eller mäklare" : "Connect your bank or broker"}
            </h2>
            <p>
              {isSv
                ? "Håll portföljen uppdaterad automatiskt. Tar ett par minuter och kräver BankID."
                : "Keep your portfolio updated automatically. A couple of minutes, and it needs BankID."}
            </p>
          </div>
          {/* Trust copy at the moment of hesitation, before the BankID redirect
              rather than after it (ROADMAP §9.4). */}
          <p className={styles.trustNote}>
            {isSv
              ? "Åtkomsten är skrivskyddad: vi kan se innehav och saldon, aldrig flytta dina pengar. Du kan koppla bort när som helst, och vi sparar innehav, konto-id och synktid — inga inloggningsuppgifter."
              : "The access is read-only: we can see holdings and balances, never move your money. You can disconnect at any time, and we store holdings, account ids, and sync times — never your credentials."}
          </p>
          {loading && <UiState kind="loading" message={isSv ? "Läser in konfiguration..." : "Loading configuration..."} />}
          {!loading && connectProviders.length === 0 && (
            <UiState kind="empty" message={isSv ? "Inga leverantörer är konfigurerade." : "No providers configured."} />
          )}
          {!loading && connectProviders.length > 0 && (
            <div className={styles.connectStack}>
              <div className={styles.connectHubBody}>
                <select
                  className={styles.providerSelect}
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                >
                  {connectProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <div className={styles.hubActions}>
                  <button
                    className={styles.secondaryBtn}
                    type="button"
                    onClick={() => selectedProvider && void handleConnect(selectedProvider.id)}
                    disabled={!selectedProvider || busyBroker === selectedProvider.id || !selectedProvider.connectable}
                  >
                    {selectedProvider && busyBroker === selectedProvider.id
                      ? isSv
                        ? "Startar..."
                        : "Starting..."
                      : selectedProvider?.connectable
                        ? isSv
                          ? "Anslut"
                          : "Connect"
                        : isSv
                          ? "Kommer snart"
                          : "Coming soon"}
                  </button>
                </div>
              </div>

              <div className={styles.connectionsHead}>
                <h3>{isSv ? "Anslutna konton" : "Connected accounts"}</h3>
                <p>
                  {connectedRows.length === 0
                    ? isSv
                      ? "Inga"
                      : "None"
                    : isSv
                      ? `${connectedRows.length} aktiva`
                      : `${connectedRows.length} active`}
                </p>
              </div>

              {connectedRows.length === 0 ? (
                <UiState
                  kind="empty"
                  message={isSv ? "Anslut en bank eller mäklare för att börja." : "Connect a bank or broker to begin."}
                />
              ) : (
                <div className={styles.connectionList}>
                  {connectedRows.map(({ provider, connection }) => {
                    if (!connection) return null;
                    const isSyncing = syncingConnection === connection.id;
                    const isDiagnosing = diagnosingConnection === connection.id;
                    const isRemoving = removingConnection === connection.id;
                    const busy = isSyncing || isDiagnosing || isRemoving;
                    return (
                      <div key={provider.id} className={styles.connectionCard}>
                        <div>
                          <p className={styles.connectionBroker}>{provider.name}</p>
                          <p className={styles.connectionMeta}>
                            {formatConnectionStatus(connection.status, isSv)} · {formatDate(connection.lastSyncedAt, isSv)}
                          </p>
                        </div>
                        <div className={styles.connectionActions}>
                          <button className={styles.secondaryBtn} type="button" onClick={() => void handleConnect(provider.id)}>
                            {isSv ? "Återanslut" : "Reconnect"}
                          </button>
                          {connection.status === "awaiting_account_selection" ? (
                            <button
                              className={styles.secondaryBtn}
                              type="button"
                              onClick={() => router.push(`/portfolio/accounts?connectionId=${encodeURIComponent(connection.id)}`)}
                            >
                              {isSv ? "Välj konton" : "Choose accounts"}
                            </button>
                          ) : null}
                          {connection.status === "connected" ? (
                            <button
                              className={styles.secondaryBtn}
                              type="button"
                              disabled={isSyncing}
                              onClick={() => void handleSync(connection.id)}
                            >
                              {isSyncing ? (isSv ? "Synkar..." : "Syncing...") : isSv ? "Synka" : "Sync"}
                            </button>
                          ) : null}
                          {connection.authProvider === "tink" ? (
                            <button
                              className={styles.secondaryBtn}
                              type="button"
                              disabled={isDiagnosing}
                              onClick={() => void handleDiagnose(connection.id)}
                            >
                              {isDiagnosing ? (isSv ? "Diagnostiserar..." : "Diagnosing...") : isSv ? "Diagnostik" : "Diagnose"}
                            </button>
                          ) : null}
                          <button
                            className={styles.dangerBtn}
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRemove(connection.id, provider.name)}
                          >
                            {isRemoving ? (isSv ? "Tar bort..." : "Removing...") : isSv ? "Ta bort" : "Remove"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <section className={`${styles.holdings} appSection`}>
          <div className={styles.sectionHead}>
            <h2>{isSv ? "Portföljtabell" : "Portfolio table"}</h2>
            <p>{isSv ? "Manuella och synkade innehav i samma vy." : "Manual and synced positions in one view."}</p>
          </div>
          <div className={styles.tableHead}>
            <span>{isSv ? "Ticker" : "Ticker"}</span>
            <span>{isSv ? "Antal" : "Shares"}</span>
            <span>{isSv ? "Snittkurs" : "Avg Cost"}</span>
            <span>{isSv ? "Nuvarande pris" : "Current Price"}</span>
            <span>{isSv ? "Positionsvärde" : "Position Value"}</span>
            <span>{isSv ? "PnL" : "PnL"}</span>
            <span>{isSv ? "Kontotyp" : "Account Type"}</span>
          </div>
          {positions.map((row) => (
            <div className={styles.tableRow} key={row.id}>
              <span className={styles.ticker}>
                {editingPositionId === row.id && editDraft ? (
                  <input
                    className={`${styles.rowInput} appInput`}
                    type="text"
                    value={editDraft.ticker}
                    onChange={(event) =>
                      setEditDraft((current) => (current ? { ...current, ticker: event.target.value.toUpperCase() } : current))
                    }
                  />
                ) : (
                  row.ticker
                )}
                {row.source === "manual" ? <small className={styles.manualBadge}>{isSv ? "Manuell" : "Manual"}</small> : null}
              </span>
              <span>
                {editingPositionId === row.id && editDraft ? (
                  <input
                    className={`${styles.rowInput} appInput`}
                    type="number"
                    step="any"
                    value={editDraft.shares}
                    onChange={(event) => setEditDraft((current) => (current ? { ...current, shares: event.target.value } : current))}
                  />
                ) : (
                  row.shares.toLocaleString("sv-SE")
                )}
              </span>
              <span>
                {editingPositionId === row.id && editDraft ? (
                  <input
                    className={`${styles.rowInput} appInput`}
                    type="number"
                    step="any"
                    value={editDraft.avgCost}
                    onChange={(event) => setEditDraft((current) => (current ? { ...current, avgCost: event.target.value } : current))}
                    placeholder="—"
                  />
                ) : row.avgCost === null ? (
                  // "Prompt later" for the field we let people skip on the way in
                  // (ROADMAP §9.4): the row asks for it once there is a row to ask
                  // about, and only where it can actually be filled in.
                  row.source === "manual" ? (
                    <button
                      className={styles.addCostBtn}
                      type="button"
                      onClick={() => startEditPosition(row)}
                      title={
                        isSv
                          ? "Lägg till snittkurs för att se avkastning"
                          : "Add an average cost to see return"
                      }
                    >
                      {isSv ? "Lägg till" : "Add"}
                    </button>
                  ) : (
                    "—"
                  )
                ) : (
                  formatMoney(row.avgCost, row.currency)
                )}
              </span>
              <span className={row.synthetic ? styles.syntheticCell : undefined}>
                {row.currentPrice === null
                  ? (isSv ? "Kurs saknas" : "No price")
                  : formatMoney(row.currentPrice, row.currency)}
                {row.synthetic ? (
                  <span
                    className={styles.syntheticFlag}
                    title={
                      isSv
                        ? "Platshållarkurs — inte marknadsdata"
                        : "Placeholder price — not market data"
                    }
                  >
                    {isSv ? "platshållare" : "placeholder"}
                  </span>
                ) : null}
              </span>
              <span>
                {row.positionValue === null
                  ? (isSv ? "—" : "—")
                  : formatMoney(row.positionValue, row.currency)}
              </span>
              <span className={row.unrealizedPnl !== null && row.unrealizedPnl < 0 ? styles.pillNeg : styles.pillPos}>
                {row.unrealizedPnl === null ? "—" : formatMoney(row.unrealizedPnl, row.currency)}
              </span>
              <span className={styles.accountCell}>
                {editingPositionId === row.id && editDraft ? (
                  <select
                    className={`${styles.rowInput} appInput`}
                    value={editDraft.accountType ?? ""}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current ? { ...current, accountType: event.target.value ? (event.target.value as PortfolioPosition["accountType"]) : null } : current
                      )
                    }
                  >
                    <option value="">{isSv ? "Ej satt" : "Not set"}</option>
                    <option value="ISK">ISK</option>
                    <option value="AF">AF</option>
                    <option value="KF">KF</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <span className={styles.accountRow}>
                    <span className={getAccountPillClass(styles, row.accountType)}>{getAccountPillLabel(row)}</span>
                    {row.source === "manual" ? (
                      <span className={styles.rowActions}>
                        <button className={styles.rowBtnGhost} type="button" onClick={() => startEditPosition(row)}>
                          {isSv ? "Redigera" : "Edit"}
                        </button>
                      </span>
                    ) : null}
                  </span>
                )}
                <span className={styles.accountControls}>
                  {editingPositionId === row.id && editDraft ? (
                    <>
                      <span className={styles.rowEditMeta}>
                        <input
                          className={`${styles.rowInput} appInput`}
                          type="text"
                          value={editDraft.broker}
                          onChange={(event) => setEditDraft((current) => (current ? { ...current, broker: event.target.value } : current))}
                          placeholder={isSv ? "Mäklare" : "Broker"}
                        />
                        <select
                          className={`${styles.rowInput} appInput`}
                          value={editDraft.currency}
                          onChange={(event) => setEditDraft((current) => (current ? { ...current, currency: event.target.value } : current))}
                        >
                          {["USD", "EUR", "SEK", "DKK", "NOK", "GBP", "CHF"].map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </span>
                      <span className={styles.editToolbar}>
                        <button
                          className={styles.rowBtn}
                          type="button"
                          disabled={savingEditId === row.id}
                          onClick={() => void saveEditPosition(row.id)}
                        >
                          {savingEditId === row.id ? (isSv ? "Sparar..." : "Saving...") : isSv ? "Spara" : "Save"}
                        </button>
                        <button className={styles.rowBtnGhost} type="button" onClick={cancelEditPosition}>
                          {isSv ? "Tillbaka" : "Back"}
                        </button>
                        <button
                          className={styles.rowBtnDanger}
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => void deletePosition(row.id)}
                        >
                          {deletingId === row.id ? (isSv ? "Tar bort..." : "Deleting...") : isSv ? "Ta bort" : "Delete"}
                        </button>
                      </span>
                    </>
                  ) : null}
                </span>
                {editErrors[row.id] ? <span className={styles.rowError}>{editErrors[row.id]}</span> : null}
              </span>
            </div>
          ))}
          {!loading && positions.length === 0 && (
            <UiState
              kind="empty"
              message={isSv ? "Inga positioner importerade ännu." : "No positions imported yet."}
              className={styles.emptyTable}
            />
          )}
          <div className={styles.tableActions}>
            <a className={styles.secondaryBtn} href="#add-holding">
              {isSv ? "Lägg till innehav" : "Add a holding"}
            </a>
          </div>
        </section>

        {diagnosticSummary && <UiState kind="empty" message={diagnosticSummary} className={styles.error} />}
        {error && <UiState kind="error" message={error} className={styles.error} />}
      </Workspace>
    </main>
  );
}
