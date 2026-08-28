import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getConnection, listConnectionAccounts } from "@/app/lib/brokers/store";
import { diagnoseTinkIntegration } from "@/app/lib/brokers/tink";
import { getConnectionSecret } from "@/app/lib/brokers/tokenVault";

export async function GET(request: NextRequest, context: { params: { connectionId: string } }) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getConnection(session.userId, context.params.connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.authProvider !== "tink") {
    return NextResponse.json({ error: "Diagnostics available only for Tink connections" }, { status: 400 });
  }

  const secret = await getConnectionSecret(session.userId, context.params.connectionId);
  if (!secret) {
    return NextResponse.json({ error: "Missing Tink token secret for this connection" }, { status: 409 });
  }

  const accounts = await listConnectionAccounts(session.userId, context.params.connectionId);
  const selectedAccountIds = accounts.filter((account) => account.selected).map((account) => account.providerAccountId);

  const report = await diagnoseTinkIntegration({
    accessToken: secret.accessToken,
    selectedAccountIds,
    tokenExpiresAt: secret.expiresAt,
    tokenScope: secret.scope
  });

  return NextResponse.json({
    connection: {
      id: connection.id,
      broker: connection.broker,
      status: connection.status,
      dataScope: connection.dataScope
    },
    report
  });
}
