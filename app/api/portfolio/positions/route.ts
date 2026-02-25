import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { listConnections, listPositions } from "@/app/lib/brokers/store";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    positions: await listPositions(session.userId),
    connections: await listConnections(session.userId)
  });
}
