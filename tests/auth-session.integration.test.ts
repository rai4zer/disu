import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

type RegisterResponse = {
  ok: boolean;
  user?: {
    id: string;
    email: string;
  };
  error?: string;
};

type SessionResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
  };
};

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = process.env.SUPABASE_KEY ?? "";
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
const hasApiTestEnv = Boolean(
  baseUrl &&
    apiKey &&
    appBaseUrl &&
    process.env.DISU_SESSION_SECRET &&
    process.env.QUANT_PYTHON_BIN &&
    process.env.PRIMER_PYTHON_BIN
);

async function restRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: "return=representation",
      ...(init?.headers ?? {})
    }
  });
}

test("auth session reflects Supabase-backed user state", { skip: !hasApiTestEnv }, async () => {
  const nonce = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `auth-${nonce}@example.com`;
  const password = "test-pass-123";
  let userId = "";

  try {
    const registerRes = await fetch(`${appBaseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const registerJson = (await registerRes.json()) as RegisterResponse;
    assert.equal(registerRes.status, 200);
    assert.equal(registerJson.ok, true);
    userId = registerJson.user?.id ?? "";
    assert.equal(registerJson.user?.email, email);

    const setCookie = registerRes.headers.get("set-cookie") ?? "";
    assert.equal(setCookie.includes("disu_session="), true);

    const meRes = await fetch(`${appBaseUrl}/api/auth/me`, {
      headers: { cookie: setCookie }
    });
    const meJson = (await meRes.json()) as SessionResponse;
    assert.equal(meRes.status, 200);
    assert.equal(meJson.authenticated, true);
    assert.equal(meJson.user?.email, email);

    const deleteRes = await restRequest(`users?id=eq.${userId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    assert.equal(deleteRes.ok, true);

    const staleMeRes = await fetch(`${appBaseUrl}/api/auth/me`, {
      headers: { cookie: setCookie }
    });
    const staleMeJson = (await staleMeRes.json()) as SessionResponse;
    assert.equal(staleMeRes.status, 401);
    assert.equal(staleMeJson.authenticated, false);
  } finally {
    if (userId) {
      await restRequest(`events?user_id=eq.${userId}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
      await restRequest(`users?id=eq.${userId}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }
  }
});
