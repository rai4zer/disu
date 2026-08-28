import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FUNNEL_EVENTS,
  FUNNEL_EVENT_SPECS,
  MAX_COUNT_VALUE,
  MAX_EVENTS_PER_REQUEST,
  MAX_PATH_LENGTH,
  clientPostableEvents,
  isAnonId,
  isFunnelEventName,
  normalisePath,
  sanitiseProperties
} from "../app/lib/analytics/funnel.ts";
import { analyticsAllowed } from "../app/lib/analytics/funnel-store.ts";
import { CONSENT_VERSION, acceptAll, makeRecord, rejectAll, serialiseConsent } from "../app/lib/legal/consent.ts";
import { STORAGE_ENTRIES } from "../app/lib/legal/cookies.ts";
import { PERSONAL_DATA_TABLES } from "../app/lib/account/personal-data.ts";

// Guards the funnel stream (ROADMAP §2.6). Two things are being protected: that
// nothing is recorded without consent, and that a public write endpoint cannot
// be turned into a free-form store of whatever a caller feels like sending.

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/** Every .ts/.tsx file under app/, repo-relative. */
function walkApp(dir = "app"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkApp(relative));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(relative);
    }
  }
  return out;
}

const ROUTE = readRepoFile("app/api/analytics/events/route.ts");
const MIGRATION = readRepoFile("db/migrations/0020_analytics_events.sql");
const TRACK = readRepoFile("app/lib/analytics/track.ts");

function consentCarrier(cookie: string | undefined) {
  return { cookies: { get: (name: string) => (name === "disu_consent" && cookie ? { value: cookie } : undefined) } };
}

// --- The event set the roadmap asks for ----------------------------------

test("the minimum event set from ROADMAP §2.6 all exist", () => {
  // The list is quoted from the roadmap rather than derived from the code, so
  // deleting an event to make a test pass fails here instead.
  for (const name of [
    "landing_view",
    "signup_start",
    "signup_complete",
    "holding_added",
    "broker_connect_start",
    "broker_connect_complete",
    "primer_run",
    "quant_run",
    "session_start"
  ]) {
    assert.ok(isFunnelEventName(name), `${name} is in the roadmap's minimum set but not in the taxonomy`);
    assert.ok(FUNNEL_EVENT_SPECS[name as (typeof FUNNEL_EVENTS)[number]], `${name} has no spec`);
  }
});

test("holding_added carries the method the roadmap asks for", () => {
  const method = FUNNEL_EVENT_SPECS.holding_added.properties.method;
  assert.ok(method, "holding_added has no method property — the roadmap names it explicitly");
  assert.strictEqual(method.kind, "enum", "method must be a closed set, not free text");
});

test("every event declares an origin and every spec is reachable", () => {
  for (const name of FUNNEL_EVENTS) {
    const spec = FUNNEL_EVENT_SPECS[name];
    assert.ok(["client", "server"].includes(spec.origin), `${name} has no valid origin`);
    assert.ok(spec.measures.length > 0, `${name} does not say what it measures`);
  }
});

// --- The reason this stream exists at all --------------------------------

test("the two pre-account events are the client-postable ones", () => {
  // The whole point: recordEvent() needs a userId, so these two could never be
  // recorded through it. If they stop being client-postable the funnel loses its
  // top and the roadmap item is unfixed.
  assert.deepStrictEqual(clientPostableEvents().sort(), ["landing_view", "signup_start"]);
});

test("a client cannot post the events the funnel is judged on", () => {
  for (const name of ["signup_complete", "holding_added", "quant_run", "primer_run", "session_start"] as const) {
    assert.strictEqual(
      FUNNEL_EVENT_SPECS[name].origin,
      "server",
      `${name} is client-postable — a browser could forge the metric`
    );
  }
  assert.match(
    ROUTE,
    /FUNNEL_EVENT_SPECS\[event\.name\]\.origin !== "client"/,
    "the route does not enforce origin, so any event could be posted from a browser"
  );
});

// --- Consent ------------------------------------------------------------

test("no consent record means nothing may be recorded", () => {
  assert.strictEqual(analyticsAllowed(consentCarrier(undefined)), false, "absent cookie");
  assert.strictEqual(analyticsAllowed(consentCarrier("garbage")), false, "unparseable cookie");
  assert.strictEqual(
    analyticsAllowed(consentCarrier(serialiseConsent(makeRecord(rejectAll(), new Date().toISOString())))),
    false,
    "a refusal was treated as consent"
  );
});

test("analytics consent is what opens the gate, and marketing consent is not", () => {
  const now = new Date().toISOString();
  assert.strictEqual(analyticsAllowed(consentCarrier(serialiseConsent(makeRecord(acceptAll(), now)))), true);

  const marketingOnly = makeRecord({ ...rejectAll(), marketing: true }, now);
  assert.strictEqual(
    analyticsAllowed(consentCarrier(serialiseConsent(marketingOnly))),
    false,
    "consent to advertising was read as consent to analytics"
  );
});

test("consent from an older set of purposes does not authorise the funnel", () => {
  // The funnel was added to the `analytics` category after v1, so a v1 yes was an
  // answer to a different question. parseConsent() rejects it; assert the whole
  // chain, because this is the one place the version bump has to bite.
  const stale = encodeURIComponent(
    JSON.stringify({
      version: CONSENT_VERSION - 1,
      decidedAt: new Date().toISOString(),
      choices: { analytics: true }
    })
  );
  assert.strictEqual(analyticsAllowed(consentCarrier(stale)), false);
});

test("the route checks consent before it parses anything", () => {
  const consentAt = ROUTE.indexOf("analyticsAllowed(request)");
  const parseAt = ROUTE.indexOf("request.json()");
  assert.ok(consentAt !== -1, "the route does not check consent");
  assert.ok(parseAt !== -1, "the route does not read a body");
  assert.ok(consentAt < parseAt, "the body is parsed before consent is checked");
});

test("the client gate waits for the cookie to have been read", () => {
  // Firing on `allows(...)` while `ready` is false is firing on "not yet known",
  // which is how a consent gate quietly becomes decoration.
  assert.match(TRACK, /ready && allows\("analytics"\)/, "the client sends before consent is known");
  assert.ok(
    !/ensureAnonId\(\)[\s\S]{0,80}if \(!allowed\)/.test(TRACK),
    "the anonymous id is created before the consent check"
  );
});

test("no call site reaches the endpoint around the consent gate", () => {
  // The gate is in app/lib/analytics. A component posting to the endpoint itself,
  // or a handler inserting into the table itself, would be outside it — and would
  // work, which is exactly why it has to be caught here.
  const offenders: string[] = [];
  // The GDPR register has to name the table — that is its whole job, and the
  // build fails if it does not (scripts/check-delivery-readiness.mjs).
  const registers = [path.join("app", "lib", "account", "personal-data.ts")];
  for (const file of walkApp()) {
    if (file.startsWith(path.join("app", "lib", "analytics"))) continue;
    if (file === path.join("app", "api", "analytics", "events", "route.ts")) continue;
    if (registers.includes(file)) continue;
    const source = readRepoFile(file);
    if (source.includes("/api/analytics/events")) {
      offenders.push(`${file} posts to the endpoint directly`);
    }
    if (/["']analytics_events["']/.test(source)) {
      offenders.push(`${file} names the table directly`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test("the client events are wired where the funnel says they are", () => {
  // A taxonomy with no call site is a metric that reads as zero rather than as
  // missing, which is the worst of the three states.
  assert.match(readRepoFile("app/page.tsx"), /useFunnelEvent\("landing_view"\)/);
  assert.match(
    readRepoFile("app/auth/login/login-form.tsx"),
    /useFunnelEvent\("signup_start"/,
    "the sign-up form does not record signup_start"
  );
});

// --- The closed shape of a public write endpoint -------------------------

test("undeclared properties are dropped", () => {
  const cleaned = sanitiseProperties("holding_added", {
    method: "manual",
    ticker: "VOLV-B",
    email: "someone@example.com",
    value: 148_000
  });
  assert.deepStrictEqual(cleaned, { method: "manual" }, "an undeclared key reached the row");
});

test("an enum property accepts only its declared values", () => {
  assert.deepStrictEqual(sanitiseProperties("signup_complete", { method: "google" }), { method: "google" });
  assert.deepStrictEqual(sanitiseProperties("signup_complete", { method: "sms" }), {});
  assert.deepStrictEqual(sanitiseProperties("signup_complete", { method: 1 }), {});
});

test("a slug property rejects anything that is not a short token", () => {
  assert.deepStrictEqual(sanitiseProperties("broker_connect_start", { broker: "avanza" }), { broker: "avanza" });
  for (const bad of ["Avanza Bank AB", "a".repeat(64), "-leading", "with space", ""]) {
    assert.deepStrictEqual(
      sanitiseProperties("broker_connect_start", { broker: bad }),
      {},
      `${JSON.stringify(bad)} was accepted as a slug`
    );
  }
});

test("a count property is a bounded non-negative integer", () => {
  assert.deepStrictEqual(sanitiseProperties("holding_added", { count: 3 }), { count: 3 });
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_COUNT_VALUE + 1, "many"]) {
    assert.deepStrictEqual(
      sanitiseProperties("holding_added", { count: bad }),
      {},
      `${String(bad)} was accepted as a count`
    );
  }
});

test("a bad property does not take the event down with it", () => {
  // Dropping the property is right; dropping the event would let a broken client
  // silently zero out a funnel step.
  assert.deepStrictEqual(sanitiseProperties("holding_added", { method: "nonsense", count: 2 }), { count: 2 });
});

test("properties survive nothing at all being sent", () => {
  for (const input of [undefined, null, "string", 42, []]) {
    assert.deepStrictEqual(sanitiseProperties("landing_view", input), {});
  }
});

test("an inherited property is not read as if it were sent", () => {
  // Checked against an event that actually declares `method`, so the assertion
  // exercises the lookup rather than an empty spec.
  const inherited = Object.create({ method: "manual" }) as Record<string, unknown>;
  assert.deepStrictEqual(sanitiseProperties("holding_added", inherited), {});
});

test("an event with no declared properties stores none", () => {
  assert.deepStrictEqual(sanitiseProperties("landing_view", { method: "manual", anything: 1 }), {});
});

// --- Paths --------------------------------------------------------------

test("a query string never reaches the row", () => {
  // The reason this matters: /auth/reset-password?token=… and the OAuth callback
  // both carry live credentials in the query.
  assert.strictEqual(normalisePath("/auth/reset-password?token=abc123secret"), "/auth/reset-password");
  assert.strictEqual(normalisePath("/auth/login?next=/dashboard#top"), "/auth/login");
  assert.strictEqual(normalisePath("https://disu.se/quant?ticker=VOLV-B"), "/quant");
});

test("identifier segments collapse so the path stays a route", () => {
  assert.strictEqual(normalisePath("/portfolio/8f14e45f-ea1a-4a2f-9c1f-3b1f0e2d4a55"), "/portfolio/:id");
  assert.strictEqual(normalisePath("/jobs/12345"), "/jobs/:id");
  assert.strictEqual(normalisePath("/portfolio/accounts"), "/portfolio/accounts");
  assert.strictEqual(normalisePath("/"), "/");
});

test("a path is bounded and anything unusable is dropped", () => {
  const long = normalisePath(`/${"segment/".repeat(40)}`);
  assert.ok(long !== null && long.length <= MAX_PATH_LENGTH, "an unbounded path reached the row");
  for (const bad of ["relative/path", "", "   ", 42, null, undefined, "javascript:alert(1)"]) {
    assert.strictEqual(normalisePath(bad), null, `${JSON.stringify(bad)} was accepted as a path`);
  }
});

// --- Identifiers and volume ---------------------------------------------

test("only a real random id is accepted as an anonymous id", () => {
  assert.ok(isAnonId("8f14e45f-ea1a-4a2f-9c1f-3b1f0e2d4a55"));
  for (const bad of ["", "anon", "8f14e45f", "'; drop table analytics_events; --", 42, null]) {
    assert.strictEqual(isAnonId(bad), false, `${JSON.stringify(bad)} was accepted as an anon id`);
  }
});

test("the endpoint is rate limited and bounded per request", () => {
  assert.ok(MAX_EVENTS_PER_REQUEST > 0 && MAX_EVENTS_PER_REQUEST <= 50);
  assert.match(ROUTE, /consumeRateLimit\(/, "an unauthenticated write endpoint with no rate limit");
  assert.match(ROUTE, /MAX_EVENTS_PER_REQUEST/, "a request can carry an unbounded number of events");
  // The limiter must run before the consent check, or a caller with no consent
  // gets an unmetered endpoint to hammer.
  assert.ok(
    ROUTE.indexOf("consumeRateLimit(") < ROUTE.indexOf("analyticsAllowed(request)"),
    "the rate limit is applied after the consent check"
  );
});

// --- The registers this feature is obliged to appear in ------------------

test("the anonymous id is declared in the cookie register", () => {
  const entry = STORAGE_ENTRIES.find((candidate) => candidate.name === "disu_anon_id");
  assert.ok(entry, "the funnel's anonymous id is not in app/lib/legal/cookies.ts");
  assert.strictEqual(entry.category, "analytics", "an identifier for measurement is not an essential cookie");
  assert.strictEqual(entry.medium, "sessionStorage");
});

test("the funnel table is in the GDPR register with an erasure policy", () => {
  const entry = PERSONAL_DATA_TABLES.find((candidate) => candidate.table === "analytics_events");
  assert.ok(entry, "analytics_events is not declared in app/lib/account/personal-data.ts");
  assert.strictEqual(entry.column, "user_id");
  assert.strictEqual(entry.erasure, "erase", "funnel rows are nobody else's content — erase, do not keep de-linked");
});

test("the schema keeps user_id nullable and refuses an unattributable row", () => {
  // Nullable user_id is the entire reason this table exists rather than a column
  // on `events`. A `not null` here would re-create the problem being fixed.
  assert.ok(
    !/user_id\s+text\s+not null/.test(MIGRATION),
    "user_id is not null — landing_view and signup_start cannot be recorded"
  );
  assert.match(MIGRATION, /references users\(id\) on delete cascade/, "erasure would leave rows behind");
  assert.match(
    MIGRATION,
    /check \(anon_id is not null or user_id is not null\)/,
    "a row belonging to nobody at all would be accepted and be unqueryable"
  );
  assert.match(MIGRATION, /enable row level security/, "RLS is not enabled on the new table");
});
