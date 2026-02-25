import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { listConnections } from "@/app/lib/brokers/store";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    providers: [
      { id: "nordnet", name: "Nordnet", implemented: true },
      { id: "avanza", name: "Avanza", implemented: true }
    ],
    connections: await listConnections(session.userId)
  });
}
