import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { completeConnection } from "@/app/lib/brokers/store";

export async function POST(
  request: NextRequest,
  context: { params: { connectionId: string } }
) {
  try {
    const session = getSessionFromRequest(request);
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

    return NextResponse.json({ connection });
  } catch (error) {
    console.error("Completing broker authentication failed", error);
    return NextResponse.json({ error: "Unable to complete broker authentication" }, { status: 404 });
  }
}
