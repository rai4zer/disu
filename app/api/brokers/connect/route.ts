import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { createConnection } from "@/app/lib/brokers/store";
import type { BrokerProvider } from "@/app/lib/brokers/types";
import { recordEvent } from "@/app/lib/db/events";

const VALID_BROKERS: BrokerProvider[] = ["nordnet", "avanza"];

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { broker?: BrokerProvider };
    const broker = body.broker;

    if (!broker || !VALID_BROKERS.includes(broker)) {
      return NextResponse.json({ error: "Invalid broker" }, { status: 400 });
    }

    const connection = await createConnection(session.userId, broker);
    void recordEvent({
      userId: session.userId,
      action: "broker_connect",
      status: "success",
      metadata: { broker, connectionId: connection.id }
    }).catch(() => {});

    return NextResponse.json({
      connection,
      authUrl: `/portfolio/authenticate?broker=${broker}&connectionId=${connection.id}`
    });
  } catch (error) {
    console.error("Broker connect failed", error);
    return NextResponse.json({ error: "Unable to start broker authentication" }, { status: 500 });
  }
}
