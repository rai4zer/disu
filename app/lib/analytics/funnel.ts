/**
 * The funnel event taxonomy: what may be recorded, from where, and with what.
 *
 * `recordEvent()` in `app/lib/db/events.ts` is an *audit log*. It answers "what
 * did this user do", it is keyed on a user id, and it is legally a
 * legitimate-interest security record. None of that fits a funnel, where the
 * whole question is what happens to people who do not have an account yet —
 * `landing_view` and `signup_start` have no user id by definition, so they
 * cannot be written through `userScoped()` at all (ROADMAP §2.6).
 *
 * So this is a second, deliberately separate stream: `analytics_events`, whose
 * `user_id` is nullable and whose subject is a step in a funnel rather than an
 * action on an account. Two rules make that safe rather than just convenient:
 *
 *  1. **Nothing is written without analytics consent.** The privacy policy
 *     states consent is the *only* basis DISU uses for analytics
 *     (`app/lib/legal/privacy-document.ts`, "Why we are allowed to hold it"),
 *     and that applies to a first-party stream exactly as it does to GA4.
 *     `app/lib/analytics/funnel-store.ts` reads the consent cookie off the
 *     request that caused the event and drops it otherwise — which is why every
 *     server-side funnel event fires in a request handler, never in the job
 *     worker where no consent is in scope.
 *  2. **The shape is closed.** The client-callable endpoint is unauthenticated
 *     by necessity, so an open `properties` bag would be a public write-anything
 *     column: free-text is a PII leak waiting to happen and unbounded keys make
 *     the data unqueryable. Every event declares its properties here, every
 *     value is an enum member, a slug or a count, and anything else is dropped.
 *
 * The `origin` field is the other half of that: `landing_view` and
 * `signup_start` are the only two events a browser may post. A client claiming
 * `signup_complete` would be forging the metric the whole funnel is measured
 * on, so the endpoint refuses it and the server records it instead.
 */

export const FUNNEL_EVENTS = [
  "landing_view",
  "signup_start",
  "signup_complete",
  "session_start",
  "holding_added",
  "broker_connect_start",
  "broker_connect_complete",
  "primer_run",
  "quant_run"
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

/** Where an event is allowed to come from. Enforced by the API route. */
export type FunnelOrigin = "client" | "server";

type PropertySpec =
  /** One of a fixed set of values. Anything else is dropped. */
  | { kind: "enum"; values: readonly string[] }
  /** A short lowercase token — a broker id, a provider name. Bounded, never free text. */
  | { kind: "slug" }
  /** A non-negative whole number, capped so a bad client cannot store nonsense. */
  | { kind: "count" };

export type FunnelEventSpec = {
  origin: FunnelOrigin;
  /** Why this event exists, for whoever reads the funnel later. */
  measures: string;
  properties: Record<string, PropertySpec>;
};

const SIGNUP_METHODS = ["password", "google"] as const;

/** How a holding got into the portfolio. The `method` the roadmap asks for. */
export const HOLDING_METHODS = ["manual", "broker_sync", "csv_import"] as const;

export const MAX_COUNT_VALUE = 100_000;

export const FUNNEL_EVENT_SPECS: Record<FunnelEventName, FunnelEventSpec> = {
  landing_view: {
    origin: "client",
    measures: "Top of funnel: someone reached a public page. The only event most visitors ever produce.",
    properties: {}
  },
  signup_start: {
    origin: "client",
    measures: "The sign-up form was opened. The gap to signup_complete is the form's drop-off.",
    properties: { method: { kind: "enum", values: SIGNUP_METHODS } }
  },
  signup_complete: {
    origin: "server",
    measures: "An account now exists. Server-only: this is the number the funnel is judged on.",
    properties: { method: { kind: "enum", values: SIGNUP_METHODS } }
  },
  session_start: {
    origin: "server",
    measures: "A sign-in succeeded. Returning-user activity, and the denominator for WAP.",
    properties: { method: { kind: "enum", values: SIGNUP_METHODS } }
  },
  holding_added: {
    origin: "server",
    measures: "Activation. An empty portfolio is a dead account, so this is the step that matters most.",
    properties: {
      method: { kind: "enum", values: HOLDING_METHODS },
      count: { kind: "count" }
    }
  },
  broker_connect_start: {
    origin: "server",
    measures: "A broker connection was begun. The pair with _complete is the connection flow's drop-off.",
    properties: { broker: { kind: "slug" }, provider: { kind: "slug" } }
  },
  broker_connect_complete: {
    origin: "server",
    measures: "A broker connection reached the point of having accounts to select.",
    properties: { broker: { kind: "slug" }, provider: { kind: "slug" }, count: { kind: "count" } }
  },
  primer_run: {
    origin: "server",
    measures: "A filing primer was requested. Recorded at enqueue, not completion — see the module header.",
    properties: {}
  },
  quant_run: {
    origin: "server",
    measures: "A quant run was requested. Recorded at enqueue, not completion — see the module header.",
    properties: {}
  }
};

export function isFunnelEventName(value: unknown): value is FunnelEventName {
  return typeof value === "string" && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

/** Events a browser is allowed to post. Everything else is server-recorded. */
export function clientPostableEvents(): FunnelEventName[] {
  return FUNNEL_EVENTS.filter((name) => FUNNEL_EVENT_SPECS[name].origin === "client");
}

export type FunnelProperties = Record<string, string | number>;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Keeps only the declared properties, in their declared shape.
 *
 * Silently drops rather than rejecting: a property that fails validation is a
 * bug or an attempt, and in both cases the *event* is still worth counting. The
 * alternative — throwing away a landing_view because someone appended junk —
 * would let a broken client quietly zero out the top of the funnel.
 */
export function sanitiseProperties(name: FunnelEventName, input: unknown): FunnelProperties {
  const spec = FUNNEL_EVENT_SPECS[name];
  const output: FunnelProperties = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return output;
  }

  const candidate = input as Record<string, unknown>;
  for (const [key, propertySpec] of Object.entries(spec.properties)) {
    // Own properties only. JSON.parse cannot produce an inherited key, so this
    // is not a live hole today — but the function is also called from server
    // handlers with hand-built objects, and reading through a prototype is never
    // what a validator means to do.
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
      continue;
    }
    const value = candidate[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (propertySpec.kind === "enum") {
      if (typeof value === "string" && propertySpec.values.includes(value)) {
        output[key] = value;
      }
      continue;
    }

    if (propertySpec.kind === "slug") {
      if (typeof value === "string" && SLUG_PATTERN.test(value)) {
        output[key] = value;
      }
      continue;
    }

    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= MAX_COUNT_VALUE) {
      output[key] = numeric;
    }
  }

  return output;
}

export const MAX_PATH_LENGTH = 96;

/**
 * Reduces a URL to the route it belongs to.
 *
 * A raw pathname is not safe to store. Query strings carry reset tokens, OAuth
 * codes and email addresses; a path segment carries a connection id or a job id,
 * which re-identifies the person the anonymous id was supposed to keep
 * anonymous. So the query and fragment are discarded outright and any segment
 * that looks like an identifier collapses to `:id` — which is also the only form
 * that aggregates: `/portfolio/:id` is a funnel step, ten thousand distinct
 * paths are not.
 */
export function normalisePath(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  // Accept an absolute URL as well as a bare path; take the pathname either way.
  let pathname = input.trim();
  if (!pathname) {
    return null;
  }
  const schemeless = /^[a-z][a-z0-9+.-]*:\/\//i.test(pathname);
  if (schemeless) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return null;
    }
  }
  pathname = pathname.split("?")[0].split("#")[0];
  if (!pathname.startsWith("/")) {
    return null;
  }

  const segments = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .slice(0, 4)
    .map((segment) => (looksLikeIdentifier(segment) ? ":id" : segment.toLowerCase().slice(0, 24)));

  const normalised = `/${segments.join("/")}`;
  return normalised.slice(0, MAX_PATH_LENGTH);
}

function looksLikeIdentifier(segment: string): boolean {
  if (segment.length >= 16) {
    return true;
  }
  if (/^\d+$/.test(segment)) {
    return true;
  }
  // A mixed alphanumeric run of any length is far more likely a short id than a
  // route name; DISU's routes are words.
  return /\d/.test(segment) && /[a-z]/i.test(segment);
}

export const ANON_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAnonId(value: unknown): value is string {
  return typeof value === "string" && ANON_ID_PATTERN.test(value);
}

/** How many events one request may carry. Keeps a batch from becoming a bulk write. */
export const MAX_EVENTS_PER_REQUEST = 10;
