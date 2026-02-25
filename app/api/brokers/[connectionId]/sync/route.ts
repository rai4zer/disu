import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { syncConnection } from "@/app/lib/brokers/store";
import { recordEvent } from "@/app/lib/db/events";

export async function POST(
  request: NextRequest,
  context: { params: { connectionId: string } }
) {
  const startedAt = Date.now();
  const session = getSessionFromRequest(request);
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
    return NextResponse.json(result);
  } catch (error) {
    void recordEvent({
      userId: session.userId,
      action: "broker_sync",
      status: "failure",
      durationMs: Date.now() - startedAt,
      metadata: {
        connectionId: context.params.connectionId,
        error: error instanceof Error ? error.message : "Unknown sync error"
      }
    }).catch(() => {});
    console.error("Sync failed", error);
    return NextResponse.json({ error: "Unable to sync connection" }, { status: 404 });
  }
}
