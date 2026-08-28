import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getConnection, listConnectionAccounts, saveConnectionAccountSelection } from "@/app/lib/brokers/store";
import type { BrokerDataScope } from "@/app/lib/brokers/types";

export async function GET(request: NextRequest, context: { params: { connectionId: string } }) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getConnection(session.userId, context.params.connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const accounts = await listConnectionAccounts(session.userId, context.params.connectionId);
  return NextResponse.json({ connection, accounts });
}

export async function PUT(request: NextRequest, context: { params: { connectionId: string } }) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      selectedAccountIds?: string[];
      dataScope?: BrokerDataScope;
    };

    const selectedAccountIds = Array.isArray(body.selectedAccountIds)
      ? body.selectedAccountIds.map((value) => String(value).trim()).filter(Boolean)
      : [];

    const dataScope: BrokerDataScope = body.dataScope === "positions_plus" ? "positions_plus" : "symbols_only";

    if (selectedAccountIds.length === 0) {
      return NextResponse.json({ error: "Select at least one account" }, { status: 400 });
    }

    const connection = await saveConnectionAccountSelection(session.userId, context.params.connectionId, {
      selectedAccountIds,
      dataScope
    });

    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof Error && error.message === "No valid accounts selected") {
      return NextResponse.json({ error: "Select at least one valid account" }, { status: 400 });
    }
    console.error("Saving broker account selection failed", error);
    return NextResponse.json({ error: "Unable to save account selection" }, { status: 500 });
  }
}
