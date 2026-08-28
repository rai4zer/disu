"use client";

/**
 * Mount point for the global browser error listeners.
 *
 * Renders nothing — it exists because the listeners have to be attached from a
 * client component inside the root layout, and the layout itself is a server
 * component. Sits alongside the error boundaries rather than inside them:
 * `error.tsx` catches what React throws during render, this catches everything
 * outside it (event handlers, timers, rejected promises, third-party scripts).
 */

import { useEffect } from "react";
import { installClientErrorCapture } from "@/app/lib/observability/report-client-error";

export default function ClientErrorCapture() {
  useEffect(() => installClientErrorCapture(), []);
  return null;
}
