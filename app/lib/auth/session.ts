import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { ensureRuntimeEnv } from "@/app/lib/runtime/env";

export const SESSION_COOKIE_NAME = "disu_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  email: string;
  exp: number;
};

type PublicSession = {
  userId: string;
  email: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function getSessionSecret(): string {
  ensureRuntimeEnv();
  return process.env.DISU_SESSION_SECRET!;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(session: PublicSession): string {
  const payload: SessionPayload = {
    ...session,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string): PublicSession | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  if (signPayload(payloadB64) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return null;
    }
    if (!payload.userId || !payload.email) {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest): PublicSession | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

export function getSessionCookieMaxAge(): number {
  return SESSION_TTL_SECONDS;
}
