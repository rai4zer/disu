import "./globals.css";
import "@fontsource/noto-sans-cuneiform/400.css";
import type { Metadata } from "next";
import AppShell from "./components/app-shell";
import Providers from "./components/providers";
import { ensureRuntimeEnv } from "@/app/lib/runtime/env";

export const metadata: Metadata = {
  title: "DISU - Investment Operations Platform",
  description: "Unified dashboard for sentiment, quant, and filings workflows"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  ensureRuntimeEnv();

  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
