"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLanguage } from "@/app/i18n/language";

type Props = {
  className?: string;
};

export default function LogoutButton({ className }: Props) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/auth/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void handleLogout()} disabled={busy}>
      {busy ? (isSv ? "Loggar ut..." : "Signing out...") : isSv ? "Logga ut" : "Sign out"}
    </button>
  );
}
