import { NextRequest, NextResponse } from "next/server";
import { exportAccountData } from "@/app/lib/account/export";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GDPR Art. 15/20 — the person downloads everything the app holds about them.
 *
 * Scoped to the caller's own session and nothing else: there is no `userId`
 * parameter, so there is no version of this route that can be pointed at
 * somebody else.
 */
export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const data = await exportAccountData(session.userId);
    const filename = `disu-account-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build the export.";
    void recordEvent({
      userId: session.userId,
      action: "account_export",
      status: "failure",
      durationMs: Date.now() - startedAt,
      metadata: { error: message }
    }).catch(() => {});
    console.error("Account export failed", error);
    return NextResponse.json({ ok: false, error: "Unable to build the export." }, { status: 500 });
  }
}
