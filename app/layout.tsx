import "./globals.css";
import "./design-system.css";
import "./theme-glass.css";
import "@fontsource/noto-sans-cuneiform/400.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppShell from "./components/app-shell";
import ClientErrorCapture from "./components/client-error-capture";
import ConsentBanner from "./components/consent-banner";
import ConsentTags from "./components/consent-tags";
import Providers from "./components/providers";
import { getAuthenticatedSessionFromToken, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";
import { ensureRuntimeEnv } from "@/app/lib/runtime/env";
import { GLASS_ENABLED } from "@/app/lib/theme/config";

export const metadata: Metadata = {
  title: "DISU Platform",
  description: "Investor workspace for portfolio tracking, sentiment, quant, primers, and broker connectivity"
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  ensureRuntimeEnv();

  // Chrome-level check — the routes themselves are gated in middleware.
  // Resolving it here (rather than fetching /api/auth/me from the client) keeps
  // the signed-in shell from flashing before the answer arrives.
  //
  // This is the authoritative check, not just a signature check, so a revoked
  // session cannot render the signed-in frame and then discover it is dead on
  // the first API call. It costs one query per page render, and only when a
  // cookie is actually present — signed-out visitors pay nothing. Middleware
  // stays signature-only because it runs on the Edge runtime.
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const signedIn = Boolean(await getAuthenticatedSessionFromToken(sessionToken));

  return (
    <html lang="en" className={GLASS_ENABLED ? "glass-enabled" : undefined}>
      <head>
        {/* Sets <html lang> before paint so the document reports the stored
            language rather than flipping once LanguageProvider hydrates.
            There is no theme to restore — the app is light-mode only — so the
            keys the old toggle wrote are dropped here instead, otherwise
            browsers keep a preference the cookie inventory no longer lists. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var ls=window.localStorage;ls.removeItem("theme");ls.removeItem("placera-theme");var l=ls.getItem("app_language")||ls.getItem("home_language");if(l==="en"||l==="sv"){document.documentElement.lang=l;}}catch(e){}})();`
          }}
        />
      </head>
      <body>
        <Providers signedIn={signedIn}>
          {/* Outside AppShell so the listeners are attached even when the shell
              itself is what breaks. */}
          <ClientErrorCapture />
          <AppShell signedIn={signedIn}>{children}</AppShell>
          <ConsentBanner />
          <ConsentTags />
        </Providers>
      </body>
    </html>
  );
}
