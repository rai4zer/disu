import { Suspense } from "react";
import LoginForm from "./login-form";
import { isGoogleSignInConfigured } from "@/app/lib/auth/google";

/**
 * Server component so the Google button can be hidden on deployments where the
 * OAuth client has not been provisioned, rather than rendering a button that
 * only redirects into an error.
 */
export default function LoginPage() {
  const googleEnabled = isGoogleSignInConfigured();

  return (
    <Suspense fallback={null}>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
