import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { parseAvanzaPositionsCsv } from "@/app/lib/brokers/avanzaCsv";
import { importPositionsForBroker } from "@/app/lib/brokers/store";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const content = await file.text();
    const rows = parseAvanzaPositionsCsv(content);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No positions found in CSV. Check your Avanza export format." },
        { status: 400 }
      );
    }

    const result = await importPositionsForBroker(session.userId, "avanza", rows);

    void recordFunnelEvent(request, "holding_added", {
      userId: session.userId,
      path: "/portfolio",
      properties: { method: "csv_import", count: rows.length }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Avanza import failed", error);
    return NextResponse.json({ error: "Unable to import Avanza CSV" }, { status: 500 });
  }
}
