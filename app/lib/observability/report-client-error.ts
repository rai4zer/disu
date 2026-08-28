"use client";

/**
 * Browser side of client-error capture.
 *
 * Two jobs: catch what the app never handled (`error`, `unhandledrejection`,
 * and the React boundaries that call `reportClientError` directly), and get it
 * to `/api/observability/client-error` without ever making things worse.
 *
 * "Without making things worse" is most of the code here. An error reporter
 * that can itself throw, that reports its own failures, or that sends one
 * request per frame of a render loop is a bigger outage than the bug it was
 * meant to surface. So: every entry point is wrapped, the sender is never
 * instrumented, identical errors are sent once, and a page is capped at a
 * handful of reports whatever happens after that.
 */

import {
  fingerprintClientError,
  isNoiseMessage,
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  type ClientErrorInput,
  type ClientErrorKind
} from "@/app/lib/observability/client-error";

export const CLIENT_ERROR_ENDPOINT = "/api/observability/client-error";

/**
 * Ceiling per page load. A page that has thrown eight distinct errors is
 * broken in a way the ninth report will not clarify, and the point of the cap
 * is that a runaway loop costs the user's bandwidth once, not continuously.
 */
const MAX_REPORTS_PER_PAGE = 8;

const seenFingerprints = new Set<string>();
let sentCount = 0;
let installed = false;
/** Reentrancy guard: anything thrown while sending must not be reported. */
let sending = false;

function messageFrom(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message || value.name || "Error";
  }
  if (value && typeof value === "object") {
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage) {
      return maybeMessage;
    }
    try {
      return JSON.stringify(value).slice(0, MAX_MESSAGE_LENGTH);
    } catch {
      return "Unserialisable rejection value";
    }
  }
  return String(value ?? "Unknown error");
}

function stackFrom(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === "string") {
    return value.stack.slice(0, MAX_STACK_LENGTH);
  }
  return undefined;
}

function send(payload: ClientErrorInput): void {
  const body = JSON.stringify(payload);

  // `sendBeacon` survives the page going away, which matters because a large
  // share of client errors happen during a navigation that is already underway.
  // `keepalive` fetch is the fallback for the browsers that lack it (and for
  // the case where the beacon queue is full and it returns false).
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(CLIENT_ERROR_ENDPOINT, blob)) {
      return;
    }
  }

  void fetch(CLIENT_ERROR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    // The endpoint answers 204 and the page has nothing to do with the result.
    cache: "no-store"
  }).catch(() => {
    // Swallowed on purpose. A failed error report is not itself reportable —
    // that is the loop this whole module exists to avoid.
  });
}

/**
 * Reports one error. Safe to call from anywhere, including an error boundary
 * mid-render: it never throws and never blocks.
 */
export function reportClientError(
  error: unknown,
  extra?: Partial<Omit<ClientErrorInput, "message" | "stack">> & { kind?: ClientErrorKind }
): void {
  if (typeof window === "undefined" || sending) {
    return;
  }

  sending = true;
  try {
    if (sentCount >= MAX_REPORTS_PER_PAGE) {
      return;
    }

    const message = messageFrom(error).slice(0, MAX_MESSAGE_LENGTH);
    if (!message || isNoiseMessage(message)) {
      return;
    }

    const stack = stackFrom(error);
    const kind = extra?.kind ?? "error";

    // Same fingerprint function the server groups by, so "already reported"
    // here means exactly "would collapse into the same alert" there.
    const fingerprint = fingerprintClientError(kind, message, stack);
    if (seenFingerprints.has(fingerprint)) {
      return;
    }
    seenFingerprints.add(fingerprint);
    sentCount += 1;

    send({
      ...extra,
      kind,
      message,
      stack,
      path: extra?.path ?? window.location.pathname,
      sinceLoadMs: Math.round(
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0
      )
    });
  } catch {
    // A reporter that throws would turn a handled error into an unhandled one.
  } finally {
    sending = false;
  }
}

/**
 * Attaches the global listeners. Idempotent — React 18 strict mode mounts
 * effects twice in development, and double-attaching would double every report.
 *
 * Returns a detach function for that same reason.
 */
export function installClientErrorCapture(): () => void {
  if (typeof window === "undefined" || installed) {
    return () => {};
  }
  installed = true;

  const onError = (event: ErrorEvent) => {
    // A failed <img>/<script>/<link> fires "error" on the element and bubbles
    // to window as a bare Event with no message. Those are not exceptions —
    // reporting them would fill the feed with "Unknown error" every time an
    // ad blocker eats a resource.
    if (event.target && event.target !== window) {
      return;
    }
    reportClientError(event.error ?? event.message, {
      kind: "global",
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, { kind: "unhandledrejection" });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}

/** Test seam. Not reachable from the app. */
export function resetClientErrorReporterForTests(): void {
  seenFingerprints.clear();
  sentCount = 0;
  installed = false;
  sending = false;
}
