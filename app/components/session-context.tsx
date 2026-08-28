"use client";

import { createContext, useContext } from "react";

/** Resolved on the server in app/layout.tsx from the session cookie, so a page
    can render its signed-out variant on the first paint instead of fetching
    /api/auth/me and flashing the wrong state. Chrome-level only: it says
    whether a session exists, never what it may do. Every API handler still
    authorises for itself. */
const SignedInContext = createContext(false);

export function SessionProvider({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return <SignedInContext.Provider value={signedIn}>{children}</SignedInContext.Provider>;
}

export function useSignedIn(): boolean {
  return useContext(SignedInContext);
}
