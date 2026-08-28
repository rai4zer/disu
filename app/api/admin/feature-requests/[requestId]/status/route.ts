import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/app/lib/admin/access";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import { updateFeatureRequestStatus, type FeatureRequestStatus } from "@/app/lib/feature-requests/store";

function parseStatus(input: unknown): FeatureRequestStatus | null {
  if (input === "new" || input === "planned" || input === "done" || input === "rejected") {
    return input;
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: { requestId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (!session || !(await isAdminUser(session.userId))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = parseStatus(body.status);
  if (!status) {
    return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
  }

  try {
    const updated = await updateFeatureRequestStatus({ id: context.params.requestId, status });
    await recordEvent({
      userId: session.userId,
      action: "feature_request_status_update",
      status: "success",
      metadata: { featureRequestId: updated.id, nextStatus: updated.status }
    });
    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update status.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
