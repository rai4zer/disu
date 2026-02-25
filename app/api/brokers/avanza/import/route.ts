import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { parseAvanzaPositionsCsv } from "@/app/lib/brokers/avanzaCsv";
import { importPositionsForBroker } from "@/app/lib/brokers/store";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("Avanza import failed", error);
    return NextResponse.json({ error: "Unable to import Avanza CSV" }, { status: 500 });
  }
}
