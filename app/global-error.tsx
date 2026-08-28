"use client";

/**
 * Last-resort boundary: the root layout itself threw.
 *
 * This replaces the whole document, so it must render its own `<html>` and
 * `<body>` and cannot rely on anything the layout normally provides — no
 * providers, no `globals.css` custom properties on a themed root. The fallback
 * styles carry literal fallbacks for exactly this case, and reporting still
 * works because it only needs `fetch`/`sendBeacon`.
 */

import ErrorFallback from "@/app/components/error-fallback";
import "./globals.css";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback error={error} reset={reset} scope="root" />
      </body>
    </html>
  );
}
