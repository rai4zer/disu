/**
 * Builds a session cookie the live app will accept, for the smoke tests.
 *
 * A signed token alone stopped being enough once sessions became revocable
 * (ROADMAP §2.3): the payload must name a `user_sessions` row, and that row has
 * to exist and be live. So these helpers insert the row as well as sign the
 * token — a test that only signed a payload would now get a 401 and look like a
 * regression in whatever it was actually testing.
 */

import { createHmac, randomUUID } from "node:crypto";

export const SESSION_COOKIE_NAME = "disu_session";

type LiveSessionInput = {
  baseUrl: string;
  apiKey: string;
  sessionSecret: string;
  userId: string;
  email: string;
  ttlSeconds?: number;
};

export async function createLiveSessionCookie(input: LiveSessionInput): Promise<string> {
  const ttlSeconds = input.ttlSeconds ?? 3600;
  const sessionId = `ses_test_${randomUUID().replace(/-/g, "")}`;
  const now = new Date();

  const response = await fetch(`${input.baseUrl}/rest/v1/user_sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: input.apiKey,
      Authorization: `Bearer ${input.apiKey}`,
      Prefer: "return=minimal"
    },
    body: JSON.stringify([
      {
        id: sessionId,
        user_id: input.userId,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        revoked_at: null,
        revoked_reason: null
      }
    ])
  });
  if (!response.ok) {
    throw new Error(`failed to seed user_sessions row: HTTP ${response.status}`);
  }

  const payload = {
    userId: input.userId,
    email: input.email,
    sid: sessionId,
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = createHmac("sha256", input.sessionSecret).update(payloadB64).digest("base64url");
  return `${SESSION_COOKIE_NAME}=${payloadB64}.${signature}`;
}
