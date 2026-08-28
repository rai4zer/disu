"use client";

import { LanguageProvider } from "@/app/i18n/language";
import ConsentProvider from "./consent-provider";
import { SessionProvider } from "./session-context";

export default function Providers({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  // ConsentProvider sits inside LanguageProvider because the banner and the
  // preference centre are translated, and outside everything else because the
  // footer's "Cookie settings" link and the tag loader both need to reach it.
  // SessionProvider is innermost: it only carries the server-resolved signed-in
  // flag down to the public pages that render a different body without one.
  return (
    <LanguageProvider>
      <ConsentProvider>
        <SessionProvider signedIn={signedIn}>{children}</SessionProvider>
      </ConsentProvider>
    </LanguageProvider>
  );
}
