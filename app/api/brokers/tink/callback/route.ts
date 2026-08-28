import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { completeConnection, replaceDiscoveredAccounts } from "@/app/lib/brokers/store";
import { upsertConnectionSecret } from "@/app/lib/brokers/tokenVault";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";
import {
  discoverBrokerAccounts,
  exchangeCodeForAccessToken,
  parseTinkState,
  TINK_STATE_COOKIE
} from "@/app/lib/brokers/tink";

const TINK_PKCE_COOKIE = "disu_tink_pkce";

function clearCookies(response: NextResponse) {
  response.cookies.set(TINK_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/brokers/tink",
    maxAge: 0
  });
  response.cookies.set(TINK_PKCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/brokers/tink",
    maxAge: 0
  });
}

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  const state = (request.nextUrl.searchParams.get("state") ?? "").trim();
  const oauthError = (request.nextUrl.searchParams.get("error") ?? "").trim();
  const oauthErrorCode = (request.nextUrl.searchParams.get("error_code") ?? "").trim();
  const oauthErrorDescription = (request.nextUrl.searchParams.get("error_description") ?? "").trim();

  if (oauthError) {
    const url = new URL("/portfolio", request.url);
    url.searchParams.set("brokerError", oauthError);
    if (oauthErrorCode) {
      url.searchParams.set("brokerErrorCode", oauthErrorCode);
    }
    if (oauthErrorDescription) {
      url.searchParams.set("brokerErrorDescription", oauthErrorDescription);
    }
    return NextResponse.redirect(url);
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/portfolio?brokerError=missing_oauth_params", request.url));
  }

  try {
    const stateCookie = request.cookies.get(TINK_STATE_COOKIE)?.value ?? "";
    if (!stateCookie || stateCookie !== state) {
      throw new Error("Invalid OAuth state");
    }

    const payload = parseTinkState(state);
    const session = await getAuthenticatedSession(request);
    if (!session || session.userId !== payload.userId) {
      throw new Error("Session mismatch during broker callback");
    }

    const codeVerifier = request.cookies.get(TINK_PKCE_COOKIE)?.value ?? "";
    if (!codeVerifier) {
      throw new Error("Missing OAuth verifier");
    }

    const token = await exchangeCodeForAccessToken({
      code,
      codeVerifier,
      request
    });
    await upsertConnectionSecret({
      userId: payload.userId,
      connectionId: payload.connectionId,
      provider: "tink",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope
    });
    const accounts = await discoverBrokerAccounts({
      accessToken: token.accessToken,
      broker: payload.broker
    });

    await completeConnection(payload.userId, payload.connectionId, {
      externalAccountId: token.userRef ?? `${payload.broker.toUpperCase()}-TINK`,
      consentExpiresAt: token.expiresAt,
      authProvider: "tink",
      dataScope: "symbols_only",
      status: "awaiting_account_selection"
    });

    await replaceDiscoveredAccounts(payload.userId, payload.connectionId, accounts);
    void recordEvent({
      userId: payload.userId,
      action: "broker_connect",
      status: "success",
      metadata: {
        broker: payload.broker,
        connectionId: payload.connectionId,
        stage: "oauth_callback",
        discoveredAccounts: accounts.length
      }
    }).catch(() => {});

    void recordFunnelEvent(request, "broker_connect_complete", {
      userId: payload.userId,
      path: "/portfolio/accounts",
      properties: { broker: payload.broker, provider: "tink", count: accounts.length }
    });

    const response = NextResponse.redirect(
      new URL(`/portfolio/accounts?connectionId=${encodeURIComponent(payload.connectionId)}`, request.url)
    );
    clearCookies(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "broker_callback_failed";
    const url = new URL("/portfolio", request.url);
    url.searchParams.set("brokerError", message);
    if (oauthErrorCode) {
      url.searchParams.set("brokerErrorCode", oauthErrorCode);
    }
    if (oauthErrorDescription) {
      url.searchParams.set("brokerErrorDescription", oauthErrorDescription);
    }
    const response = NextResponse.redirect(url);
    const payload = state ? safeParseState(state) : null;
    if (payload?.userId) {
      void recordEvent({
        userId: payload.userId,
        action: "broker_connect",
        status: "failure",
        metadata: {
          broker: payload.broker,
          connectionId: payload.connectionId,
          stage: "oauth_callback",
          error: message,
          errorCode: oauthErrorCode || null,
          errorDescription: oauthErrorDescription || null
        }
      }).catch(() => {});
    }
    clearCookies(response);
    return response;
  }
}

function safeParseState(state: string): { userId: string; broker: string; connectionId: string } | null {
  try {
    return parseTinkState(state);
  } catch {
    return null;
  }
}
