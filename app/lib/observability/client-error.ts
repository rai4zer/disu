/**
 * Shape and sanitation rules for browser-reported errors.
 *
 * Everything here runs on untrusted input: the request body arrives from a
 * page we do not control at the moment it arrives (a stale bundle, a hostile
 * client, a browser extension injecting frames). So this module is total —
 * every field is whitelisted, coerced, truncated and redacted, and anything
 * that cannot be made sense of makes the whole report `null` rather than
 * reaching the log sink half-formed.
 *
 * It is deliberately dependency-free so both the route handler and the client
 * reporter can import it, and so it is unit-testable under
 * `node --experimental-strip-types --test`.
 */

/** What produced the report. Anything else is rejected. */
export const CLIENT_ERROR_KINDS = ["error", "unhandledrejection", "react", "global"] as const;

export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** What the browser sends. Every field except `kind` and `message` is optional. */
export type ClientErrorInput = {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** Script URL from `window.onerror`. */
  source?: string;
  line?: number;
  column?: number;
  /** `location.pathname` — never the query string, see `sanitisePath()`. */
  path?: string;
  /** React `componentStack` from an error boundary. */
  componentStack?: string;
  /** Next.js error digest, which ties a client boundary to a server log line. */
  digest?: string;
  /** Milliseconds since page load, so a boot-time error is distinguishable. */
  sinceLoadMs?: number;
};

/** What the log sink receives. */
export type ClientErrorReport = Required<Pick<ClientErrorInput, "kind" | "message">> & {
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  path?: string;
  componentStack?: string;
  digest?: string;
  sinceLoadMs?: number;
  /** Stable grouping key: identical bugs collapse to one alert, not thousands. */
  fingerprint: string;
};

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_STACK_LENGTH = 4000;
export const MAX_COMPONENT_STACK_LENGTH = 2000;
export const MAX_PATH_LENGTH = 200;
export const MAX_SOURCE_LENGTH = 300;
export const MAX_DIGEST_LENGTH = 64;
/** Cap on the raw request body. A stack trace this long is a loop, not a bug report. */
export const MAX_BODY_BYTES = 16_384;

/**
 * Messages that carry no information and would otherwise dominate the feed.
 *
 * `Script error.` is what a cross-origin script gives you when it has no CORS
 * headers — no file, no line, no stack. `ResizeObserver loop…` is a benign
 * browser notification that every layout-animating page emits. Neither is
 * actionable, and both arrive in the thousands.
 */
const NOISE_PATTERNS = [
  /^script error\.?$/i,
  /^resizeobserver loop/i,
  /^network error$/i,
  /^load failed$/i
];

export function isNoiseMessage(message: string): boolean {
  const trimmed = message.trim();
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Strips the things that turn an error report into a personal-data leak.
 *
 * Stack frames and messages routinely embed URLs, and our URLs carry job ids,
 * reset tokens and — in a pasted-in string — email addresses. None of that is
 * needed to fix a bug, and once it is in a webhook payload it is in a third
 * party's retention policy. So it never leaves the process.
 */
export function redact(value: string): string {
  return value
    // Query strings and URL fragments that carry parameters — `?token=…`,
    // `#access_token=…`. Matched by the `=`, so a bare "?" in prose survives
    // and a stack frame's plain file URL keeps its path.
    .replace(/[?#][^\s"')]*=[^\s"')]*/g, (match) => `${match[0]}[redacted]`)
    // Bounded quantifiers, not `+`: an unbounded local part backtracks
    // quadratically over a long run of word characters, which turns a 16KB
    // report into CPU an attacker chose to spend.
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{2,63}/g, "[redacted-email]")
    .replace(/\b(?:eyJ|Bearer\s+)[\w.\-+/=]{8,}/gi, "[redacted-token]");
}

function sanitiseText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  // Truncate first. Redaction is linear, but there is no reason to run four
  // passes over a megabyte of stack trace that is about to be cut to 4KB.
  const cleaned = redact(value.slice(0, max)).trim();
  return cleaned ? truncate(cleaned, max) : undefined;
}

/**
 * Keeps the path, drops everything after it.
 *
 * A client that sends a full URL, a query string or a fragment gets it reduced
 * to the route — which is the only part that helps you find the broken page.
 */
export function sanitisePath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  let path = value.trim();
  if (!path) {
    return undefined;
  }
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return undefined;
    }
  }
  path = path.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) {
    return undefined;
  }
  return truncate(path, MAX_PATH_LENGTH);
}

function sanitisePositiveInt(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const rounded = Math.floor(value);
  return rounded > max ? max : rounded;
}

/**
 * The function name at the top of the stack, and nothing else.
 *
 * Not the file, not the line: bundle filenames carry a content hash and line
 * numbers move on every edit, so keying on them would split one bug into a new
 * group at every deploy — which is the failure mode that makes error grouping
 * useless. A symbol name survives both. When the top frame is anonymous there
 * is nothing stable to add, and the message alone carries the group.
 */
function topFrameSymbol(stack: string | undefined): string {
  if (!stack) {
    return "";
  }
  for (const line of stack.split("\n")) {
    const frame = line.trim();
    // V8: "at Row (https://…)", "at Object.render (…)".
    const v8 = /^at\s+(?!https?:|\/|<)([\w$.<>]+)\s*\(/.exec(frame);
    if (v8) {
      return v8[1];
    }
    // Firefox/Safari: "Row@https://…".
    const spidermonkey = /^([\w$.<>]+)@/.exec(frame);
    if (spidermonkey) {
      return spidermonkey[1];
    }
  }
  return "";
}

/**
 * Grouping key. Two reports share one only when they are the same bug: same
 * origin, same message shape, same top frame symbol. Digits are collapsed so
 * ids and offsets in a message do not fragment a group into singletons.
 */
export function fingerprintClientError(kind: string, message: string, stack?: string): string {
  const normalisedMessage = message.toLowerCase().replace(/\d+/g, "#");
  const raw = `${kind}|${normalisedMessage}|${topFrameSymbol(stack).toLowerCase()}`;
  // FNV-1a. Not a security hash — just a short, stable, dependency-free id.
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Turns an arbitrary parsed body into a report, or `null` if it is not one.
 *
 * `null` covers three cases the caller treats identically: the body is not an
 * object, the message is missing or empty, or the message is known noise. All
 * three are dropped silently — a client that sends rubbish should not be able
 * to make the endpoint answer differently, and it must never be told to retry.
 */
export function normaliseClientErrorReport(raw: unknown): ClientErrorReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const input = raw as Record<string, unknown>;

  const kind = CLIENT_ERROR_KINDS.includes(input.kind as ClientErrorKind)
    ? (input.kind as ClientErrorKind)
    : "error";

  const message = sanitiseText(input.message, MAX_MESSAGE_LENGTH);
  if (!message || isNoiseMessage(message)) {
    return null;
  }

  const stack = sanitiseText(input.stack, MAX_STACK_LENGTH);

  const report: ClientErrorReport = {
    kind,
    message,
    fingerprint: fingerprintClientError(kind, message, stack)
  };

  if (stack) {
    report.stack = stack;
  }
  const source = sanitiseText(input.source, MAX_SOURCE_LENGTH);
  if (source) {
    report.source = source;
  }
  const line = sanitisePositiveInt(input.line, 10_000_000);
  if (line !== undefined) {
    report.line = line;
  }
  const column = sanitisePositiveInt(input.column, 10_000_000);
  if (column !== undefined) {
    report.column = column;
  }
  const path = sanitisePath(input.path);
  if (path) {
    report.path = path;
  }
  const componentStack = sanitiseText(input.componentStack, MAX_COMPONENT_STACK_LENGTH);
  if (componentStack) {
    report.componentStack = componentStack;
  }
  const digest = sanitiseText(input.digest, MAX_DIGEST_LENGTH);
  if (digest) {
    report.digest = digest;
  }
  const sinceLoadMs = sanitisePositiveInt(input.sinceLoadMs, 86_400_000);
  if (sinceLoadMs !== undefined) {
    report.sinceLoadMs = sinceLoadMs;
  }

  return report;
}
