import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const GOOGLE_STATE_COOKIE = "disu_google_state";
export const GOOGLE_PKCE_COOKIE = "disu_google_pkce";
export const GOOGLE_NONCE_COOKIE = "disu_google_nonce";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const STATE_TTL_MS = 1000 * 60 * 10;
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 10;

/**
 * `signin` — the login page: resolve or create an account and mint a session.
 * `link`   — account settings: attach this Google identity to the account that
 *            is *already* signed in, and mint nothing.
 *
 * The two are deliberately not the same code path. A sign-in links only when the
 * verified Google email already matches an account, which is safe without a
 * session; an explicit link is authorised by the live session instead, so it can
 * attach a Google address that differs from the account email.
 */
export type GoogleFlowMode = "signin" | "link";

type StatePayload = {
  nextPath: string;
  issuedAt: number;
  nonce: string;
  mode: GoogleFlowMode;
  /**
   * Set in `link` mode only. The callback refuses the link unless the live
   * session still belongs to this user, so a link started in one account cannot
   * complete in another after a sign-out/sign-in in between.
   */
  linkUserId: string | null;
};

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

type IdTokenClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  nonce?: string;
};

export class GoogleAuthError extends Error {
  /** Stable slug surfaced to the login page via `?googleError=`. */
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

function requiredEnv(name: "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GoogleAuthError("google_not_configured", `Missing required env var: ${name}`);
  }
  return value;
}

export function getGoogleClientId(): string {
  return requiredEnv("GOOGLE_OAUTH_CLIENT_ID");
}

function getGoogleClientSecret(): string {
  return requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET");
}

/**
 * Lets the login page hide the Google button entirely on deployments where the
 * OAuth client has not been provisioned, instead of showing a button that
 * redirects into an error.
 */
export function isGoogleSignInConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
}

export function getGoogleRedirectUri(request: NextRequest): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${request.nextUrl.origin}/api/auth/google/callback`;
}

function getSigningSecret(): string {
  const secret = process.env.DISU_SESSION_SECRET?.trim();
  if (!secret) {
    throw new GoogleAuthError("google_not_configured", "Missing required env var: DISU_SESSION_SECRET");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Only same-origin relative paths are allowed back out of the callback, so a
 * crafted `?next=https://evil.example` cannot turn sign-in into an open
 * redirect. `//host` is rejected too — browsers read it as protocol-relative.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export function createGoogleState(input: {
  nextPath: string;
  mode?: GoogleFlowMode;
  linkUserId?: string | null;
}): string {
  const mode: GoogleFlowMode = input.mode === "link" ? "link" : "signin";
  const payload: StatePayload = {
    nextPath: sanitizeNextPath(input.nextPath),
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("hex"),
    mode,
    linkUserId: mode === "link" ? (input.linkUserId ?? null) : null
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseGoogleState(encoded: string): StatePayload {
  const [body, signature] = encoded.split(".");
  if (!body || !signature || !safeEqual(sign(body), signature)) {
    throw new GoogleAuthError("invalid_state", "Invalid Google OAuth state signature");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    throw new GoogleAuthError("invalid_state", "Malformed Google OAuth state payload");
  }

  if (!payload.nonce || !Number.isFinite(payload.issuedAt)) {
    throw new GoogleAuthError("invalid_state", "Invalid Google OAuth state payload");
  }
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new GoogleAuthError("expired_state", "Expired Google OAuth state");
  }

  // Anything that is not explicitly a link is a sign-in: the weaker of the two
  // flows, so an unrecognised value cannot be used to reach the linking path.
  const mode: GoogleFlowMode = payload.mode === "link" ? "link" : "signin";
  const linkUserId = mode === "link" ? (payload.linkUserId ?? null) : null;
  if (mode === "link" && !linkUserId) {
    throw new GoogleAuthError("invalid_state", "Link-mode Google OAuth state names no user");
  }

  return { ...payload, mode, linkUserId, nextPath: sanitizeNextPath(payload.nextPath) };
}

export function buildGoogleAuthorizeUrl(input: { request: NextRequest; state: string }): {
  url: string;
  codeVerifier: string;
  nonce: string;
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(16).toString("hex");

  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", getGoogleClientId());
  url.searchParams.set("redirect_uri", getGoogleRedirectUri(input.request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // We only ever read the id_token, so there is nothing to refresh: skip the
  // consent screen for returning users and never ask for offline access.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  return { url: url.toString(), codeVerifier, nonce };
}

export async function exchangeCodeForIdToken(input: {
  code: string;
  codeVerifier: string;
  request: NextRequest;
}): Promise<string> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGoogleRedirectUri(input.request),
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleAuthError(
      "token_exchange_failed",
      `Google token exchange failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`
    );
  }

  const payload = (await response.json().catch(() => null)) as { id_token?: string } | null;
  if (!payload?.id_token) {
    throw new GoogleAuthError("token_exchange_failed", "Google token response contained no id_token");
  }

  return payload.id_token;
}

/**
 * Validates the claims of an id_token that came *directly* from Google's token
 * endpoint over TLS. Per Google's OpenID Connect guidance, a token fetched that
 * way needs no JWKS signature check — the TLS channel plus the client_secret in
 * the exchange already establish provenance — but the claims still have to be
 * checked so a token minted for a different app or a stale/replayed
 * authorization can't be accepted. Never call this on a token that arrived from
 * a browser.
 */
export function verifyGoogleIdToken(idToken: string, expectedNonce: string): GoogleIdentity {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new GoogleAuthError("invalid_id_token", "id_token is not a JWT");
  }

  let claims: IdTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as IdTokenClaims;
  } catch {
    throw new GoogleAuthError("invalid_id_token", "id_token payload is not valid JSON");
  }

  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) {
    throw new GoogleAuthError("invalid_id_token", `Unexpected id_token issuer: ${claims.iss ?? "none"}`);
  }
  if (!claims.aud || !safeEqual(claims.aud, getGoogleClientId())) {
    throw new GoogleAuthError("invalid_id_token", "id_token audience does not match this OAuth client");
  }
  if (!Number.isFinite(claims.exp) || claims.exp! * 1000 <= Date.now()) {
    throw new GoogleAuthError("invalid_id_token", "id_token has expired");
  }
  if (!claims.nonce || !safeEqual(claims.nonce, expectedNonce)) {
    throw new GoogleAuthError("invalid_id_token", "id_token nonce does not match this sign-in attempt");
  }
  if (!claims.sub) {
    throw new GoogleAuthError("invalid_id_token", "id_token has no subject");
  }

  const email = claims.email?.trim().toLowerCase();
  if (!email) {
    throw new GoogleAuthError("email_missing", "Google did not return an email address");
  }

  // Google serialises this as a real boolean on the id_token but as the string
  // "true" on the userinfo endpoint; accept either shape.
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";

  return {
    sub: claims.sub,
    email,
    emailVerified,
    name: claims.name?.trim() || null
  };
}
