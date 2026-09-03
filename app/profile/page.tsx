import { Suspense } from "react";
import AccountSecurity from "./account-security";
import { isGoogleSignInConfigured } from "@/app/lib/auth/google";

/**
 * Server component so the "Connect Google" button can be hidden on deployments
 * where the OAuth client has not been provisioned, matching the login page.
 * Everything else is fetched client-side from /api/account/security.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountSecurity googleEnabled={isGoogleSignInConfigured()} />
    </Suspense>
  );
}
