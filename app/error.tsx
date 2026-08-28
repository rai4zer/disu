"use client";

/**
 * Route-level error boundary.
 *
 * Next.js renders this in place of the page when a client render throws, with
 * the layout — and therefore the nav, the footer and the providers — still
 * around it. Its other job is to report: without a boundary here, a render
 * crash showed the user a blank frame and left nothing behind.
 */

import ErrorFallback from "@/app/components/error-fallback";

export default function RouteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} scope="route" />;
}
