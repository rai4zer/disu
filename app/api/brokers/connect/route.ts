import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { createConnection } from "@/app/lib/brokers/store";
import type { BrokerProvider } from "@/app/lib/brokers/types";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";
import { findBrokerProvider } from "@/app/lib/brokers/providers";

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { broker?: BrokerProvider };
    const broker = body.broker;

    if (!broker) {
      return NextResponse.json({ error: "Invalid broker" }, { status: 400 });
    }
    const provider = findBrokerProvider(broker);
    if (!provider) {
      return NextResponse.json({ error: "Invalid broker" }, { status: 400 });
    }
    if (!provider.connectable) {
      return NextResponse.json({ error: `Broker not connectable yet: ${provider.name}` }, { status: 409 });
    }

    const authProvider = provider.integration === "tink" ? "tink" : "manual";
    const connection = await createConnection(session.userId, broker, {
      authProvider,
      dataScope: "symbols_only"
    });
    void recordEvent({
      userId: session.userId,
      action: "broker_connect",
      status: "success",
      metadata: { broker, connectionId: connection.id }
    }).catch(() => {});

    void recordFunnelEvent(request, "broker_connect_start", {
      userId: session.userId,
      path: "/portfolio",
      properties: { broker, provider: authProvider }
    });

    return NextResponse.json({
      connection,
      authUrl:
        provider.integration === "tink"
          ? `/api/brokers/tink/start?connectionId=${encodeURIComponent(connection.id)}`
          : `/portfolio/authenticate?broker=${broker}&connectionId=${connection.id}`
    });
  } catch (error) {
    console.error("Broker connect failed", error);
    return NextResponse.json({ error: "Unable to start broker authentication" }, { status: 500 });
  }
}
