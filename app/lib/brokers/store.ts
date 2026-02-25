import { randomUUID } from "node:crypto";
import { getBrokerAdapter } from "@/app/lib/brokers/adapters";
import { eq, supabaseRequest } from "@/app/lib/db/supabase";
import type { BrokerConnection, BrokerProvider, BrokerSyncResult, NormalizedPosition, Position } from "@/app/lib/brokers/types";

type ConnectionRow = {
  id: string;
  user_id: string;
  broker: BrokerProvider;
  status: BrokerConnection["status"];
  external_account_id: string | null;
  consent_expires_at: string | null;
  last_synced_at: string | null;
  error_code: string | null;
  created_at: string;
};

type PositionRow = {
  id: string;
  user_id: string;
  connection_id: string;
  symbol: string;
  isin: string;
  name: string;
  quantity: number;
  avg_cost: number;
  currency: string;
  market_value: number;
  as_of: string;
};

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toConnection(row: ConnectionRow): BrokerConnection {
  return {
    id: row.id,
    userId: row.user_id,
    broker: row.broker,
    status: row.status,
    externalAccountId: row.external_account_id,
    consentExpiresAt: row.consent_expires_at,
    lastSyncedAt: row.last_synced_at,
    errorCode: row.error_code,
    createdAt: row.created_at
  };
}

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    connectionId: row.connection_id,
    symbol: row.symbol,
    isin: row.isin,
    name: row.name,
    quantity: Number(row.quantity),
    avgCost: Number(row.avg_cost),
    currency: row.currency,
    marketValue: Number(row.market_value),
    asOf: row.as_of
  };
}

function normalizePositions(connectionId: string, userId: string, rows: NormalizedPosition[]): PositionRow[] {
  return rows.map((row) => ({
    id: createId("pos"),
    user_id: userId,
    connection_id: connectionId,
    symbol: row.symbol,
    isin: row.isin,
    name: row.name,
    quantity: row.quantity,
    avg_cost: row.avgCost,
    currency: row.currency,
    market_value: row.marketValue,
    as_of: row.asOf
  }));
}

async function findConnection(userId: string, connectionId: string): Promise<ConnectionRow | null> {
  const rows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    query: {
      user_id: eq(userId),
      id: eq(connectionId),
      select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

async function latestConnectionByBroker(userId: string, broker: BrokerProvider): Promise<ConnectionRow | null> {
  const rows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    query: {
      user_id: eq(userId),
      broker: eq(broker),
      select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at",
      order: "created_at.desc",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

async function replaceConnectionPositions(connectionId: string, userId: string, rows: NormalizedPosition[]): Promise<Position[]> {
  await supabaseRequest<unknown>("positions", {
    method: "DELETE",
    query: { connection_id: eq(connectionId) },
    prefer: "return=minimal"
  });

  if (rows.length === 0) {
    return [];
  }

  const inserted = await supabaseRequest<PositionRow[]>("positions", {
    method: "POST",
    body: normalizePositions(connectionId, userId, rows)
  });

  return inserted.map(toPosition);
}

export async function listConnections(userId: string): Promise<BrokerConnection[]> {
  const rows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    query: {
      user_id: eq(userId),
      select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at",
      order: "created_at.desc"
    }
  });

  const deduped = new Map<BrokerProvider, BrokerConnection>();
  for (const row of rows) {
    if (!deduped.has(row.broker)) {
      deduped.set(row.broker, toConnection(row));
    }
  }

  return [...deduped.values()];
}

export async function listPositions(userId: string): Promise<Position[]> {
  const connections = await listConnections(userId);
  const connectionIds = new Set(connections.map((connection) => connection.id));
  if (!connectionIds.size) {
    return [];
  }

  const rows = await supabaseRequest<PositionRow[]>("positions", {
    query: {
      user_id: eq(userId),
      select: "id,user_id,connection_id,symbol,isin,name,quantity,avg_cost,currency,market_value,as_of",
      order: "symbol.asc"
    }
  });

  return rows
    .filter((row) => connectionIds.has(row.connection_id))
    .map(toPosition)
    .sort((a, b) => (a.symbol > b.symbol ? 1 : -1));
}

export async function createConnection(userId: string, broker: BrokerProvider): Promise<BrokerConnection> {
  const now = new Date().toISOString();
  const existing = await latestConnectionByBroker(userId, broker);

  if (existing) {
    const updatedRows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
      method: "PATCH",
      query: {
        id: eq(existing.id),
        user_id: eq(userId),
        select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at"
      },
      body: {
        status: "pending",
        external_account_id: null,
        last_synced_at: null,
        error_code: null,
        updated_at: now
      }
    });

    await supabaseRequest<unknown>("positions", {
      method: "DELETE",
      query: { connection_id: eq(existing.id) },
      prefer: "return=minimal"
    });

    return toConnection(updatedRows[0]);
  }

  const rows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    method: "POST",
    body: [
      {
        id: createId("conn"),
        user_id: userId,
        broker,
        status: "pending",
        external_account_id: null,
        consent_expires_at: null,
        last_synced_at: null,
        error_code: null,
        created_at: now,
        updated_at: now
      }
    ]
  });

  return toConnection(rows[0]);
}

export async function completeConnection(
  userId: string,
  connectionId: string,
  payload: { externalAccountId: string; consentExpiresAt?: string | null }
): Promise<BrokerConnection> {
  const existing = await findConnection(userId, connectionId);
  if (!existing) {
    throw new Error("Connection not found");
  }

  const rows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      user_id: eq(userId),
      select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at"
    },
    body: {
      status: "connected",
      external_account_id: payload.externalAccountId,
      consent_expires_at: payload.consentExpiresAt ?? null,
      error_code: null,
      updated_at: new Date().toISOString()
    }
  });

  return toConnection(rows[0]);
}

export async function syncConnection(userId: string, connectionId: string): Promise<BrokerSyncResult> {
  const existing = await findConnection(userId, connectionId);
  if (!existing) {
    throw new Error("Connection not found");
  }

  const connection = toConnection(existing);
  if (connection.status !== "connected") {
    throw new Error("Connection not verified");
  }

  const adapter = getBrokerAdapter(connection.broker);
  const normalized = await adapter.fetchPositions(connection);
  const positions = await replaceConnectionPositions(connectionId, userId, normalized);

  const updatedRows = await supabaseRequest<ConnectionRow[]>("broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      user_id: eq(userId),
      select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at"
    },
    body: {
      status: "connected",
      last_synced_at: new Date().toISOString(),
      error_code: null,
      updated_at: new Date().toISOString()
    }
  });

  return {
    connection: toConnection(updatedRows[0]),
    positions
  };
}

export async function importPositionsForBroker(
  userId: string,
  broker: BrokerProvider,
  rows: NormalizedPosition[]
): Promise<BrokerSyncResult> {
  const now = new Date().toISOString();
  const existing = await latestConnectionByBroker(userId, broker);

  let connection: BrokerConnection;

  if (existing) {
    const updated = await supabaseRequest<ConnectionRow[]>("broker_connections", {
      method: "PATCH",
      query: {
        id: eq(existing.id),
        user_id: eq(userId),
        select: "id,user_id,broker,status,external_account_id,consent_expires_at,last_synced_at,error_code,created_at"
      },
      body: {
        status: "connected",
        last_synced_at: now,
        error_code: null,
        updated_at: now
      }
    });
    connection = toConnection(updated[0]);
  } else {
    const inserted = await supabaseRequest<ConnectionRow[]>("broker_connections", {
      method: "POST",
      body: [
        {
          id: createId("conn"),
          user_id: userId,
          broker,
          status: "connected",
          external_account_id: `${broker.toUpperCase()}-CSV`,
          consent_expires_at: null,
          last_synced_at: now,
          error_code: null,
          created_at: now,
          updated_at: now
        }
      ]
    });
    connection = toConnection(inserted[0]);
  }

  const positions = await replaceConnectionPositions(connection.id, userId, rows);

  return {
    connection,
    positions
  };
}
