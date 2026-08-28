import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { listConnections } from "@/app/lib/brokers/store";
import { listBrokerProviders } from "@/app/lib/brokers/providers";

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    providers: listBrokerProviders(),
    connections: await listConnections(session.userId)
  });
}
