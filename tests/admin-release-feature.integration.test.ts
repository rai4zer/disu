import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createLiveSessionCookie } from "./support/integration-session.ts";

type DbUser = {
  id: string;
  email: string;
};

type DbRole = {
  id: string;
  user_id: string;
  role: string;
};

type DbFeatureRequest = {
  id: string;
  status: "new" | "planned" | "done" | "rejected";
};

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = process.env.SUPABASE_KEY ?? "";
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
const sessionSecret = process.env.DISU_SESSION_SECRET ?? "";
const SESSION_COOKIE_NAME = "disu_session";
const hasApiTestEnv = Boolean(
  baseUrl &&
    apiKey &&
    appBaseUrl &&
    process.env.DISU_SESSION_SECRET &&
    process.env.QUANT_PYTHON_BIN &&
    process.env.PRIMER_PYTHON_BIN
);

async function restRequest<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: "return=representation",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json().catch(() => null)) as T | null;
  return { ok: response.ok, status: response.status, body };
}

test("admin role gates release endpoints and feature pagination works", { skip: !hasApiTestEnv }, async () => {
  const nonce = randomUUID().replace(/-/g, "").slice(0, 12);
  const userId = `usr_admintest_${nonce}`;
  const email = `${userId}@example.com`;
  const roleId = `url_test_${nonce}`;

  const featureIds = [
    `frq_test_${nonce}a`,
    `frq_test_${nonce}b`,
    `frq_test_${nonce}c`
  ];

  let releaseNoteId = "";

  try {
    const userInsert = await restRequest<DbUser[]>("users", {
      method: "POST",
      body: JSON.stringify([
        {
          id: userId,
          email,
          password_hash: "x".repeat(128),
          password_salt: "salt"
        }
      ])
    });
    assert.equal(userInsert.ok, true, `failed to insert user: ${JSON.stringify(userInsert.body)}`);

    const cookie = await createLiveSessionCookie({ baseUrl, apiKey, sessionSecret, userId, email });

    const meBefore = await fetch(`${appBaseUrl}/api/admin/me`, { headers: { cookie } });
    const meBeforeJson = (await meBefore.json()) as { authenticated: boolean; isAdmin: boolean };
    assert.equal(meBefore.status, 200);
    assert.equal(meBeforeJson.authenticated, true);
    assert.equal(meBeforeJson.isAdmin, false);

    const roleInsert = await restRequest<DbRole[]>("user_roles", {
      method: "POST",
      body: JSON.stringify([
        {
          id: roleId,
          user_id: userId,
          role: "admin"
        }
      ])
    });
    assert.equal(roleInsert.ok, true, `failed to insert role: ${JSON.stringify(roleInsert.body)}`);

    const meAfter = await fetch(`${appBaseUrl}/api/admin/me`, { headers: { cookie } });
    const meAfterJson = (await meAfter.json()) as { authenticated: boolean; isAdmin: boolean };
    assert.equal(meAfter.status, 200);
    assert.equal(meAfterJson.isAdmin, true);

    const createRelease = await fetch(`${appBaseUrl}/api/admin/release-notes`, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        slug: `admin-test-${nonce}`,
        status: "draft",
        translations: [
          { locale: "en", title: "Admin test", bodyMarkdown: "First draft" },
          { locale: "sv", title: "Admin test sv", bodyMarkdown: "Första utkast" }
        ]
      })
    });
    const createReleaseJson = (await createRelease.json()) as {
      ok: boolean;
      releaseNote?: { id: string; status: string };
    };
    assert.equal(createRelease.status, 201);
    assert.equal(createReleaseJson.ok, true);
    releaseNoteId = createReleaseJson.releaseNote?.id ?? "";
    assert.equal(Boolean(releaseNoteId), true);

    const patchRelease = await fetch(`${appBaseUrl}/api/admin/release-notes/${releaseNoteId}`, {
      method: "PATCH",
      headers: {
        cookie,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status: "published",
        translations: [
          { locale: "en", title: "Admin test", bodyMarkdown: "Updated text" },
          { locale: "sv", title: "Admin test sv", bodyMarkdown: "Uppdaterad text" }
        ]
      })
    });
    const patchReleaseJson = (await patchRelease.json()) as { ok: boolean; releaseNote?: { status: string } };
    assert.equal(patchRelease.status, 200);
    assert.equal(patchReleaseJson.ok, true);
    assert.equal(patchReleaseJson.releaseNote?.status, "published");

    const now = new Date().toISOString();
    const featureInsert = await restRequest<DbFeatureRequest[]>("feature_requests", {
      method: "POST",
      body: JSON.stringify([
        {
          id: featureIds[0],
          user_id: userId,
          message: "feature one",
          status: "planned",
          source_page: "/help/release-notes",
          created_at: now,
          updated_at: now
        },
        {
          id: featureIds[1],
          user_id: userId,
          message: "feature two",
          status: "planned",
          source_page: "/help/release-notes",
          created_at: new Date(Date.now() + 1000).toISOString(),
          updated_at: new Date(Date.now() + 1000).toISOString()
        },
        {
          id: featureIds[2],
          user_id: userId,
          message: "feature three",
          status: "done",
          source_page: "/help/release-notes",
          created_at: new Date(Date.now() + 2000).toISOString(),
          updated_at: new Date(Date.now() + 2000).toISOString()
        }
      ])
    });
    assert.equal(featureInsert.ok, true, `failed to insert feature requests: ${JSON.stringify(featureInsert.body)}`);

    const plannedPageOne = await fetch(`${appBaseUrl}/api/feature-requests?status=planned&limit=1&page=1`);
    const plannedPageOneJson = (await plannedPageOne.json()) as {
      ok: boolean;
      hasMore: boolean;
      requests: Array<{ status: string }>;
    };
    assert.equal(plannedPageOne.status, 200);
    assert.equal(plannedPageOneJson.ok, true);
    assert.equal(plannedPageOneJson.requests.length, 1);
    assert.equal(plannedPageOneJson.requests[0]?.status, "planned");
    assert.equal(plannedPageOneJson.hasMore, true);

    const plannedPageTwo = await fetch(`${appBaseUrl}/api/feature-requests?status=planned&limit=1&page=2`);
    const plannedPageTwoJson = (await plannedPageTwo.json()) as {
      ok: boolean;
      hasMore: boolean;
      requests: Array<{ status: string }>;
    };
    assert.equal(plannedPageTwo.status, 200);
    assert.equal(plannedPageTwoJson.ok, true);
    assert.equal(plannedPageTwoJson.requests.length, 1);
    assert.equal(plannedPageTwoJson.requests[0]?.status, "planned");
    assert.equal(plannedPageTwoJson.hasMore, false);
  } finally {
    await restRequest<unknown>(`release_note_translations?release_note_id=eq.${releaseNoteId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await restRequest<unknown>(`release_notes?id=eq.${releaseNoteId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });

    for (const id of featureIds) {
      await restRequest<unknown>(`feature_request_votes?feature_request_id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
      await restRequest<unknown>(`feature_request_comments?feature_request_id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
      await restRequest<unknown>(`feature_requests?id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }

    await restRequest<unknown>(`events?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await restRequest<unknown>(`user_sessions?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await restRequest<unknown>(`user_roles?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    await restRequest<unknown>(`users?id=eq.${userId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
});
