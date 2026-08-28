import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { completeConnection } from "@/app/lib/brokers/store";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export async function POST(
  request: NextRequest,
  context: { params: { connectionId: string } }
) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      externalAccountId?: string;
      consentExpiresAt?: string | null;
    };

    const externalAccountId = body.externalAccountId?.trim();
    if (!externalAccountId) {
      return NextResponse.json({ error: "externalAccountId is required" }, { status: 400 });
    }

    const connection = await completeConnection(session.userId, context.params.connectionId, {
      externalAccountId,
      consentExpiresAt: body.consentExpiresAt ?? null
    });

    void recordFunnelEvent(request, "broker_connect_complete", {
      userId: session.userId,
      path: "/portfolio",
      properties: { broker: connection.broker, provider: "manual" }
    });

    return NextResponse.json({ connection });
  } catch (error) {
    console.error("Completing broker authentication failed", error);
    return NextResponse.json({ error: "Unable to complete broker authentication" }, { status: 404 });
  }
}
