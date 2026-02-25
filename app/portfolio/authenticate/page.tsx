"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import Workspace from "@/app/components/workspace";

export default function AuthenticateBrokerPage() {
  return (
    <Suspense fallback={null}>
      <AuthenticateBrokerPageContent />
    </Suspense>
  );
}

function AuthenticateBrokerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const broker = (searchParams.get("broker") ?? "broker").toUpperCase();
  const connectionId = searchParams.get("connectionId") ?? "";

  const [accountId, setAccountId] = useState("");
  const [consentExpiry, setConsentExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!connectionId || accountId.trim().length === 0) {
      setError("Connection ID and account ID are required.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/brokers/${connectionId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          externalAccountId: accountId.trim(),
          consentExpiresAt: consentExpiry ? new Date(consentExpiry).toISOString() : null
        })
      });

      if (response.status === 401) {
        router.replace(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      if (!response.ok) {
        throw new Error("Authentication failed");
      }

      router.push("/portfolio");
    } catch {
      setError("Could not verify broker connection. Check details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={`Verify ${broker} account`}
        subtitle="This is the auth handoff placeholder. Later this step will redirect to official broker auth and BankID/OAuth."
        size="narrow"
      >
      <p className={styles.kicker}>Authenticator</p>

      <form className={`${styles.card} appForm appSection`} onSubmit={(event) => void handleSubmit(event)}>
        <label className={`${styles.field} appField`}>
          <span>Connection ID</span>
          <input className="appInput" value={connectionId} readOnly />
        </label>

        <label className={`${styles.field} appField`}>
          <span>Broker account ID</span>
          <input
            className="appInput"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder="e.g. 123456789"
            required
          />
        </label>

        <label className={`${styles.field} appField`}>
          <span>Consent expiry (optional)</span>
          <input
            className="appInput"
            value={consentExpiry}
            onChange={(event) => setConsentExpiry(event.target.value)}
            type="date"
          />
        </label>

        {error && <p className={`${styles.error} appError`}>{error}</p>}

        <div className={styles.actions}>
          <button className="appButton" type="submit" disabled={busy}>
            {busy ? "Verifying..." : "Verify and continue"}
          </button>
          <Link className="appButtonSecondary" href="/portfolio">Cancel</Link>
        </div>
      </form>
      </Workspace>
    </main>
  );
}
