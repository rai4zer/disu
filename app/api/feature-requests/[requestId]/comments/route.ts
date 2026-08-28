import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import { sendFeatureNotification } from "@/app/lib/feature-requests/notifications";
import {
  addFeatureRequestComment,
  getFeatureRequestById,
  listFeatureRequestComments
} from "@/app/lib/feature-requests/store";

function commentsRequireLogin(): boolean {
  const raw = (process.env.COMMENTS_REQUIRE_LOGIN ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function GET(
  _request: NextRequest,
  context: { params: { requestId: string } }
) {
  const parent = await getFeatureRequestById(context.params.requestId);
  if (!parent) {
    return NextResponse.json({ ok: false, error: "Feature request not found." }, { status: 404 });
  }

  const comments = await listFeatureRequestComments(context.params.requestId);
  return NextResponse.json({ ok: true, comments });
}

export async function POST(
  request: NextRequest,
  context: { params: { requestId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (commentsRequireLogin() && !session) {
    return NextResponse.json({ ok: false, error: "Sign in required for comments." }, { status: 401 });
  }

  const parent = await getFeatureRequestById(context.params.requestId);
  if (!parent) {
    return NextResponse.json({ ok: false, error: "Feature request not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message : "";

  try {
    const comment = await addFeatureRequestComment({
      featureRequestId: context.params.requestId,
      userId: session?.userId ?? null,
      message
    });

    if (session?.userId) {
      await recordEvent({
        userId: session.userId,
        action: "feature_request_comment",
        status: "success",
        metadata: { featureRequestId: context.params.requestId, commentId: comment.id }
      });
    }

    await sendFeatureNotification({
      subject: `[Feature Request Comment] ${context.params.requestId}`,
      text: [
        `Feature request id: ${context.params.requestId}`,
        `Comment by: ${session?.email ?? "anonymous"}`,
        "",
        comment.message
      ].join("\n")
    });

    return NextResponse.json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unable to add comment.";
    return NextResponse.json({ ok: false, error: messageText }, { status: 400 });
  }
}
