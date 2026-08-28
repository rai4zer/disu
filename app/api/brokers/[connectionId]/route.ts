import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { deleteConnection } from "@/app/lib/brokers/store";
import { recordEvent } from "@/app/lib/db/events";

export async function DELETE(
  request: NextRequest,
  context: { params: { connectionId: string } }
) {
  const startedAt = Date.now();
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { connectionId } = context.params;

  try {
    const removed = await deleteConnection(session.userId, connectionId);
    if (!removed) {
      // Also the answer when the id belongs to someone else: never confirm
      // that a connection exists on another account.
      return NextResponse.json({ error: "Connection not found", code: "not_found" }, { status: 404 });
    }

    void recordEvent({
      userId: session.userId,
      action: "broker_disconnect",
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { connectionId }
    }).catch(() => {});

    return NextResponse.json({ ok: true, connectionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove connection";
    void recordEvent({
      userId: session.userId,
      action: "broker_disconnect",
      status: "failure",
      durationMs: Date.now() - startedAt,
      metadata: { connectionId, error: message }
    }).catch(() => {});
    console.error("Disconnect failed", error);
    return NextResponse.json({ error: message, code: "broker_disconnect_failed" }, { status: 500 });
  }
}
