import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import { sendFeatureNotification } from "@/app/lib/feature-requests/notifications";
import {
  createFeatureRequest,
  listFeatureRequests,
  type FeatureRequestListFilter
} from "@/app/lib/feature-requests/store";

function normalizeMessage(body: Record<string, unknown>): string {
  return typeof body.message === "string" ? body.message : "";
}

function normalizeSourcePage(body: Record<string, unknown>): string | null {
  if (typeof body.sourcePage !== "string") return null;
  const value = body.sourcePage.trim();
  return value || null;
}

export async function GET(request: NextRequest) {
  const limitRaw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const pageRaw = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const statusRaw = (request.nextUrl.searchParams.get("status") ?? "all").trim().toLowerCase();
  const status: FeatureRequestListFilter =
    statusRaw === "new" || statusRaw === "planned" || statusRaw === "done" || statusRaw === "rejected"
      ? statusRaw
      : "all";

  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
  const offset = (page - 1) * limit;
  const requests = await listFeatureRequests({ limit: limit + 1, offset, status });
  const hasMore = requests.length > limit;
  const pageItems = hasMore ? requests.slice(0, limit) : requests;

  return NextResponse.json({ ok: true, requests: pageItems, page, limit, status, hasMore });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const created = await createFeatureRequest({
      userId: session?.userId ?? null,
      message: normalizeMessage(body),
      sourcePage: normalizeSourcePage(body)
    });

    if (session?.userId) {
      await recordEvent({
        userId: session.userId,
        action: "feature_request_submit",
        status: "success",
        metadata: { featureRequestId: created.id }
      });
    }

    await sendFeatureNotification({
      subject: `[Feature Request] ${created.status.toUpperCase()} ${created.id}`,
      text: [
        `Feature request id: ${created.id}`,
        `Submitted by: ${session?.email ?? "anonymous"}`,
        created.sourcePage ? `Source page: ${created.sourcePage}` : "Source page: n/a",
        "",
        created.message
      ].join("\n")
    });

    return NextResponse.json({ ok: true, request: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit feature request.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
