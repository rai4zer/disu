import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getConnection } from "@/app/lib/brokers/store";
import { buildTinkAuthorizeUrl, createTinkState, TINK_STATE_COOKIE } from "@/app/lib/brokers/tink";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

const TINK_PKCE_COOKIE = "disu_tink_pkce";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.redirect(new URL("/auth/login?next=/portfolio", request.url));
    }

    const connectionId = (request.nextUrl.searchParams.get("connectionId") ?? "").trim();
    const langRaw = (request.nextUrl.searchParams.get("lang") ?? "").trim().toLowerCase();
    const language = langRaw === "en" ? "en" : "sv";

    if (!connectionId) {
      return NextResponse.redirect(new URL("/portfolio?brokerError=missing_connection", request.url));
    }

    const connection = await getConnection(session.userId, connectionId);
    if (!connection) {
      return NextResponse.redirect(new URL("/portfolio?brokerError=connection_not_found", request.url));
    }

    const state = createTinkState({
      userId: session.userId,
      connectionId,
      broker: connection.broker
    });

    const handoff = buildTinkAuthorizeUrl({
      request,
      state,
      language
    });

    const response = NextResponse.redirect(handoff.url);
    response.cookies.set(TINK_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/brokers/tink",
      maxAge: 60 * 10
    });
    response.cookies.set(TINK_PKCE_COOKIE, handoff.codeVerifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/brokers/tink",
      maxAge: 60 * 10
    });
    void recordEvent({
      userId: session.userId,
      action: "broker_connect",
      status: "success",
      metadata: {
        broker: connection.broker,
        connectionId: connection.id,
        stage: "oauth_start"
      }
    }).catch(() => {});
    // The redirect to the bank is the point of no return for the user, so this
    // is the honest "start" for the Tink flow even though /connect already
    // recorded one for creating the row. The pair with _complete measures the
    // drop-off at the bank, which is where it actually happens.
    void recordFunnelEvent(request, "broker_connect_start", {
      userId: session.userId,
      path: "/portfolio",
      properties: { broker: connection.broker, provider: "tink" }
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unable_to_start_tink_auth";
    return NextResponse.redirect(new URL(`/portfolio?brokerError=${encodeURIComponent(message)}`, request.url));
  }
}
