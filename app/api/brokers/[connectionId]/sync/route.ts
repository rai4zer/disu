import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { BrokerSyncError, syncConnection } from "@/app/lib/brokers/store";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export async function POST(
  request: NextRequest,
  context: { params: { connectionId: string } }
) {
  const startedAt = Date.now();
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncConnection(session.userId, context.params.connectionId);
    void recordEvent({
      userId: session.userId,
      action: "broker_sync",
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { connectionId: context.params.connectionId, positions: result.positions.length }
    }).catch(() => {});
    // Only a sync that actually produced holdings is activation. A connection
    // that returns nothing has not got the user anywhere, and counting it would
    // make the activation number a measure of clicks rather than portfolios.
    if (result.positions.length > 0) {
      void recordFunnelEvent(request, "holding_added", {
        userId: session.userId,
        path: "/portfolio",
        properties: { method: "broker_sync", count: result.positions.length }
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof BrokerSyncError ? error.status : 500;
    const code = error instanceof BrokerSyncError ? error.code : "broker_sync_failed";
    const message = error instanceof Error ? error.message : "Unable to sync connection";
    void recordEvent({
      userId: session.userId,
      action: "broker_sync",
      status: "failure",
      durationMs: Date.now() - startedAt,
      metadata: {
        connectionId: context.params.connectionId,
        error: message,
        errorCode: code
      }
    }).catch(() => {});
    console.error("Sync failed", error);
    return NextResponse.json({ error: message, code }, { status });
  }
}
