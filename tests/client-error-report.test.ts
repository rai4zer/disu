import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MESSAGE_LENGTH,
  fingerprintClientError,
  isNoiseMessage,
  normaliseClientErrorReport,
  redact,
  sanitisePath
} from "../app/lib/observability/client-error.ts";

/**
 * Guards client-side error capture (ROADMAP §2.6).
 *
 * Two properties matter and neither is visible from the outside once it has
 * regressed: reports carry no personal data into the webhook sink, and a
 * broken page cannot turn its own errors into a flood. Both are asserted here
 * rather than discovered in a third party's log retention.
 */

test("query strings, emails and tokens never survive into a report", () => {
  const dirty = "Failed https://app.disu.se/auth/reset?token=s3cret&uid=42 for user@example.com";
  const cleaned = redact(dirty);

  assert.ok(!cleaned.includes("s3cret"), "reset token reached the sink");
  assert.ok(!cleaned.includes("uid=42"), "query parameters reached the sink");
  assert.ok(!cleaned.includes("user@example.com"), "email address reached the sink");
  assert.ok(cleaned.includes("/auth/reset"), "the route is what makes a report actionable");

  const bearer = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
  assert.ok(!bearer.includes("eyJhbGciOiJIUzI1NiJ9"), "a JWT reached the sink");
});

test("a bare question mark in prose is not mistaken for a query string", () => {
  assert.strictEqual(redact("Is this loaded? apparently not"), "Is this loaded? apparently not");
});

test("stack frames keep their file paths", () => {
  const stack = "Error\n    at Portfolio (https://app.disu.se/_next/static/chunks/page-a1b2.js:9:14)";
  assert.strictEqual(redact(stack), stack);
});

test("only the route survives from the page URL", () => {
  assert.strictEqual(sanitisePath("https://app.disu.se/portfolio?tab=holdings#pos-9"), "/portfolio");
  assert.strictEqual(sanitisePath("/quant?ticker=VOLV-B"), "/quant");
  assert.strictEqual(sanitisePath("portfolio"), undefined, "a non-absolute path is not a route");
  assert.strictEqual(sanitisePath(42), undefined);
});

test("noise that no one can act on is dropped, not logged", () => {
  for (const message of ["Script error.", "script error", "ResizeObserver loop limit exceeded", "Network error"]) {
    assert.ok(isNoiseMessage(message), `${message} would flood the feed`);
    assert.strictEqual(normaliseClientErrorReport({ kind: "error", message }), null);
  }
});

test("a report is a whitelist: unknown fields cannot ride along", () => {
  const report = normaliseClientErrorReport({
    kind: "react",
    message: "Cannot read properties of undefined",
    path: "/dashboard",
    cookie: "disu_session=forged",
    localStorage: { token: "secret" }
  });

  assert.ok(report);
  assert.deepStrictEqual(Object.keys(report).sort(), ["fingerprint", "kind", "message", "path"]);
});

test("an unrecognised kind degrades to \"error\" instead of poisoning the group key", () => {
  const report = normaliseClientErrorReport({ kind: "../../etc/passwd", message: "boom" });
  assert.strictEqual(report?.kind, "error");
});

test("nonsense bodies produce no report at all", () => {
  for (const body of [null, undefined, 7, "boom", [], {}, { message: "   " }]) {
    assert.strictEqual(normaliseClientErrorReport(body), null);
  }
});

test("oversized fields are truncated rather than forwarded whole", () => {
  const report = normaliseClientErrorReport({
    kind: "error",
    message: "x".repeat(5_000),
    stack: "y".repeat(50_000)
  });

  assert.ok(report);
  assert.strictEqual(report.message.length, MAX_MESSAGE_LENGTH);
  assert.ok((report.stack ?? "").length <= 4_000);
});

test("the same bug fingerprints the same, a different one does not", () => {
  const stack = "Error\n    at Row (https://app.disu.se/_next/static/chunks/page-a1b2.js:9:14)";
  // Same bug, different deploy hash and different row id in the message.
  const rebuilt = "Error\n    at Row (https://app.disu.se/_next/static/chunks/page-c3d4.js:9:14)";

  assert.strictEqual(
    fingerprintClientError("react", "Row 12 is missing a key", stack),
    fingerprintClientError("react", "Row 908 is missing a key", rebuilt),
    "one bug would page you once per user and per deploy"
  );
  assert.notStrictEqual(
    fingerprintClientError("react", "Row 12 is missing a key", stack),
    fingerprintClientError("react", "Quote fetch failed", stack)
  );
});

// --- browser reporter -------------------------------------------------------

type Beacon = { url: string; body: string };

type Reporter = typeof import("../app/lib/observability/report-client-error.ts");
type Listeners = Map<string, (event: unknown) => void>;

async function withFakeBrowser(run: (beacons: Beacon[], reporter: Reporter, listeners: Listeners) => Promise<void> | void) {
  const beacons: Beacon[] = [];
  const listeners: Listeners = new Map();
  const pending: Promise<void>[] = [];

  const fakeWindow = {
    location: { pathname: "/portfolio" },
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
    removeEventListener: (type: string) => listeners.delete(type)
  };

  const original = {
    window: (globalThis as Record<string, unknown>).window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator")
  };

  (globalThis as Record<string, unknown>).window = fakeWindow;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      sendBeacon: (url: string, blob: Blob) => {
        pending.push(blob.text().then((body) => void beacons.push({ url, body })));
        return true;
      }
    }
  });

  const reporter = await import("../app/lib/observability/report-client-error.ts");
  reporter.resetClientErrorReporterForTests();

  try {
    await run(beacons, reporter, listeners);
    await Promise.all(pending);
  } finally {
    reporter.resetClientErrorReporterForTests();
    (globalThis as Record<string, unknown>).window = original.window;
    if (original.navigator) {
      Object.defineProperty(globalThis, "navigator", original.navigator);
    }
  }

  return { beacons, listeners };
}

test("the same error is reported once, not once per occurrence", async () => {
  const { beacons } = await withFakeBrowser(async (collected, reporter) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      reporter.reportClientError(new Error("render loop"), { kind: "react" });
    }
    await Promise.resolve();
    assert.ok(collected.length <= 1);
  });

  assert.strictEqual(beacons.length, 1, "a render loop would have sent 50 requests");
  const payload = JSON.parse(beacons[0].body);
  assert.strictEqual(payload.kind, "react");
  assert.strictEqual(payload.message, "render loop");
  assert.strictEqual(payload.path, "/portfolio");
});

test("a page that keeps failing stops reporting after the cap", async () => {
  const { beacons } = await withFakeBrowser((_collected, reporter) => {
    for (let index = 0; index < 40; index += 1) {
      // Distinct *shapes*, not distinct numbers: the fingerprint collapses
      // digits on purpose, so "failure 1" and "failure 2" are one group.
      reporter.reportClientError(new Error(`failure of kind ${String.fromCharCode(97 + index)}`));
    }
  });

  assert.strictEqual(beacons.length, 8, "the per-page cap is the only thing bounding a runaway page");
});

test("listeners attach once and ignore failed resource loads", async () => {
  const { beacons } = await withFakeBrowser((_collected, reporter, listeners) => {
    const detach = reporter.installClientErrorCapture();
    reporter.installClientErrorCapture();

    const onError = listeners.get("error");
    const onRejection = listeners.get("unhandledrejection");
    assert.ok(onError && onRejection, "global handlers were never attached");

    // A broken <img>: bubbles to window with a target and no error.
    onError({ target: { tagName: "IMG" }, message: "", error: null });
    onError({ target: null, message: "kaboom", error: new Error("kaboom") });
    onRejection({ reason: new Error("promise gave up") });

    detach();
    assert.strictEqual(listeners.size, 0, "detach left listeners behind");
  });

  assert.deepStrictEqual(
    beacons.map((beacon) => JSON.parse(beacon.body).message).sort(),
    ["kaboom", "promise gave up"]
  );
});
