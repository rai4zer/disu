import { randomUUID } from "node:crypto";
import { getBrokerAdapter } from "@/app/lib/brokers/adapters";
import { getConnectionSecret } from "@/app/lib/brokers/tokenVault";
import { fetchTinkPositions, isLikelyMockTinkAccountId, TinkApiError } from "@/app/lib/brokers/tink";
import { eq } from "@/app/lib/db/supabase";
import { userScoped } from "@/app/lib/db/user-scope";
import type {
  BrokerAccountType,
  BrokerAuthProvider,
  BrokerConnection,
  BrokerConnectionAccount,
  BrokerDataScope,
  BrokerProvider,
  BrokerSyncResult,
  NormalizedPosition,
  Position
} from "@/app/lib/brokers/types";

type ConnectionRow = {
  id: string;
  user_id: string;
  broker: BrokerProvider;
  status: BrokerConnection["status"];
  auth_provider: BrokerAuthProvider;
  data_scope: BrokerDataScope;
  external_account_id: string | null;
  consent_expires_at: string | null;
  last_synced_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
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

type AccountRow = {
  id: string;
  user_id: string;
  connection_id: string;
  provider_account_id: string;
  provider_account_name: string;
  account_type: BrokerAccountType;
  selected: boolean;
  created_at: string;
  updated_at: string;
};

const CONNECTION_SELECT =
  "id,user_id,broker,status,auth_provider,data_scope,external_account_id,consent_expires_at,last_synced_at,error_code,created_at,updated_at";

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toConnection(row: ConnectionRow): BrokerConnection {
  return {
    id: row.id,
    userId: row.user_id,
    broker: row.broker,
    status: row.status,
    authProvider: row.auth_provider,
    dataScope: row.data_scope,
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

function toConnectionAccount(row: AccountRow): BrokerConnectionAccount {
  return {
    id: row.id,
    connectionId: row.connection_id,
    providerAccountId: row.provider_account_id,
    providerAccountName: row.provider_account_name,
    accountType: row.account_type,
    selected: row.selected
  };
}

function applyDataScope(rows: NormalizedPosition[], scope: BrokerDataScope): NormalizedPosition[] {
  if (scope !== "symbols_only") {
    return rows;
  }

  return rows.map((row) => ({
    ...row,
    quantity: 0,
    avgCost: 0,
    marketValue: 0
  }));
}

export class BrokerSyncError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 500) {
    super(message);
    this.name = "BrokerSyncError";
    this.code = code;
    this.status = status;
  }
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
  const rows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    query: {
      id: eq(connectionId),
      select: CONNECTION_SELECT,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function getConnection(userId: string, connectionId: string): Promise<BrokerConnection | null> {
  const row = await findConnection(userId, connectionId);
  return row ? toConnection(row) : null;
}

async function latestConnectionByBroker(userId: string, broker: BrokerProvider): Promise<ConnectionRow | null> {
  const rows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    query: {
      broker: eq(broker),
      select: CONNECTION_SELECT,
      order: "created_at.desc",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

async function replaceConnectionPositions(connectionId: string, userId: string, rows: NormalizedPosition[]): Promise<Position[]> {
  await userScoped<unknown>(userId, "positions", {
    method: "DELETE",
    query: { connection_id: eq(connectionId) },
    prefer: "return=minimal"
  });

  if (rows.length === 0) {
    return [];
  }

  const inserted = await userScoped<PositionRow[]>(userId, "positions", {
    method: "POST",
    body: normalizePositions(connectionId, userId, rows)
  });

  return inserted.map(toPosition);
}

async function patchConnectionState(
  userId: string,
  connectionId: string,
  patch: Partial<Pick<ConnectionRow, "status" | "error_code" | "last_synced_at" | "updated_at">>
): Promise<void> {
  await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      select: CONNECTION_SELECT
    },
    body: patch
  });
}

async function markConnectionError(userId: string, connectionId: string, errorCode: string): Promise<void> {
  await patchConnectionState(userId, connectionId, {
    status: "error",
    error_code: errorCode,
    updated_at: new Date().toISOString()
  });
}

function isExpiredIso(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const expiryMs = Date.parse(value);
  if (!Number.isFinite(expiryMs)) {
    return false;
  }
  return expiryMs <= Date.now();
}

function requiresReconsentForTinkError(error: unknown): boolean {
  if (!(error instanceof TinkApiError)) {
    return false;
  }
  if (error.status === 401 || error.status === 403) {
    return true;
  }
  const text = error.body.toLowerCase();
  return text.includes("expired") || text.includes("consent") || text.includes("invalid_token");
}

export async function listConnections(userId: string): Promise<BrokerConnection[]> {
  const rows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    query: {
      select: CONNECTION_SELECT,
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

/**
 * Removes a connection and everything hanging off it. Returns false when the
 * id does not exist for this user, so the caller can answer 404 rather than
 * silently reporting success.
 *
 * positions, broker_connection_accounts and broker_connection_secrets all
 * declare `connection_id … on delete cascade`, so the child rows go with it.
 * `userScoped` is what keeps one account from deleting another's connection —
 * the service-role key bypasses RLS, so the filter is the whole authorization
 * check.
 */
export async function deleteConnection(userId: string, connectionId: string): Promise<boolean> {
  const existing = await findConnection(userId, connectionId);
  if (!existing) {
    return false;
  }

  await userScoped<unknown>(userId, "broker_connections", {
    method: "DELETE",
    query: { id: eq(existing.id) },
    prefer: "return=minimal"
  });

  return true;
}

export async function listPositions(userId: string): Promise<Position[]> {
  const connections = await listConnections(userId);
  const connectionIds = new Set(connections.map((connection) => connection.id));
  if (!connectionIds.size) {
    return [];
  }

  const rows = await userScoped<PositionRow[]>(userId, "positions", {
    query: {
      select: "id,user_id,connection_id,symbol,isin,name,quantity,avg_cost,currency,market_value,as_of",
      order: "symbol.asc"
    }
  });

  return rows
    .filter((row) => connectionIds.has(row.connection_id))
    .map(toPosition)
    .sort((a, b) => (a.symbol > b.symbol ? 1 : -1));
}

export async function listConnectionAccounts(userId: string, connectionId: string): Promise<BrokerConnectionAccount[]> {
  const rows = await userScoped<AccountRow[]>(userId, "broker_connection_accounts", {
    query: {
      connection_id: eq(connectionId),
      select: "id,user_id,connection_id,provider_account_id,provider_account_name,account_type,selected,created_at,updated_at",
      order: "provider_account_name.asc"
    }
  });

  return rows.map(toConnectionAccount);
}

export async function createConnection(
  userId: string,
  broker: BrokerProvider,
  options?: { authProvider?: BrokerAuthProvider; dataScope?: BrokerDataScope }
): Promise<BrokerConnection> {
  const now = new Date().toISOString();
  const existing = await latestConnectionByBroker(userId, broker);
  const authProvider = options?.authProvider ?? "manual";
  const dataScope = options?.dataScope ?? "symbols_only";

  if (existing) {
    const updatedRows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
      method: "PATCH",
      query: {
        id: eq(existing.id),
        select: CONNECTION_SELECT
      },
      body: {
        status: "pending",
        auth_provider: authProvider,
        data_scope: dataScope,
        external_account_id: null,
        last_synced_at: null,
        error_code: null,
        updated_at: now
      }
    });

    await userScoped<unknown>(userId, "positions", {
      method: "DELETE",
      query: { connection_id: eq(existing.id) },
      prefer: "return=minimal"
    });

    await userScoped<unknown>(userId, "broker_connection_accounts", {
      method: "DELETE",
      query: { connection_id: eq(existing.id) },
      prefer: "return=minimal"
    });

    return toConnection(updatedRows[0]);
  }

  const rows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    method: "POST",
    body: [
      {
        id: createId("conn"),
        broker,
        status: "pending",
        auth_provider: authProvider,
        data_scope: dataScope,
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
  payload: {
    externalAccountId: string;
    consentExpiresAt?: string | null;
    authProvider?: BrokerAuthProvider;
    dataScope?: BrokerDataScope;
    status?: BrokerConnection["status"];
  }
): Promise<BrokerConnection> {
  const existing = await findConnection(userId, connectionId);
  if (!existing) {
    throw new Error("Connection not found");
  }

  const rows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      select: CONNECTION_SELECT
    },
    body: {
      status: payload.status ?? "connected",
      auth_provider: payload.authProvider ?? existing.auth_provider,
      data_scope: payload.dataScope ?? existing.data_scope,
      external_account_id: payload.externalAccountId,
      consent_expires_at: payload.consentExpiresAt ?? null,
      error_code: null,
      updated_at: new Date().toISOString()
    }
  });

  return toConnection(rows[0]);
}

export async function replaceDiscoveredAccounts(
  userId: string,
  connectionId: string,
  accounts: Array<{ providerAccountId: string; providerAccountName: string; accountType: BrokerAccountType }>
): Promise<BrokerConnectionAccount[]> {
  await userScoped<unknown>(userId, "broker_connection_accounts", {
    method: "DELETE",
    query: { connection_id: eq(connectionId) },
    prefer: "return=minimal"
  });

  if (accounts.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const rows = await userScoped<AccountRow[]>(userId, "broker_connection_accounts", {
    method: "POST",
    body: accounts.map((account) => ({
      id: createId("acct"),
      connection_id: connectionId,
      provider_account_id: account.providerAccountId,
      provider_account_name: account.providerAccountName,
      account_type: account.accountType,
      selected: true,
      created_at: now,
      updated_at: now
    }))
  });

  return rows.map(toConnectionAccount);
}

export async function saveConnectionAccountSelection(
  userId: string,
  connectionId: string,
  input: { selectedAccountIds: string[]; dataScope: BrokerDataScope }
): Promise<BrokerConnection> {
  const existing = await findConnection(userId, connectionId);
  if (!existing) {
    throw new Error("Connection not found");
  }

  const accounts = await listConnectionAccounts(userId, connectionId);
  const selected = new Set(input.selectedAccountIds);
  const selectedCount = accounts.filter((account) => selected.has(account.providerAccountId)).length;
  if (selectedCount === 0) {
    throw new Error("No valid accounts selected");
  }
  const now = new Date().toISOString();

  await userScoped<unknown>(userId, "broker_connection_accounts", {
    method: "DELETE",
    query: { connection_id: eq(connectionId) },
    prefer: "return=minimal"
  });

  if (accounts.length > 0) {
    await userScoped<AccountRow[]>(userId, "broker_connection_accounts", {
      method: "POST",
      body: accounts.map((account) => ({
        id: account.id,
        connection_id: connectionId,
        provider_account_id: account.providerAccountId,
        provider_account_name: account.providerAccountName,
        account_type: account.accountType,
        selected: selected.has(account.providerAccountId),
        updated_at: now
      }))
    });
  }

  const updatedRows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      select: CONNECTION_SELECT
    },
    body: {
      status: "connected",
      data_scope: input.dataScope,
      updated_at: now
    }
  });

  return toConnection(updatedRows[0]);
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

  let normalized: NormalizedPosition[];
  if (connection.authProvider === "tink") {
    const secret = await getConnectionSecret(userId, connectionId);
    if (!secret) {
      await markConnectionError(userId, connectionId, "tink_credentials_missing");
      throw new BrokerSyncError("Missing Tink credentials. Reconnect your bank.", "tink_credentials_missing", 409);
    }
    if (isExpiredIso(secret.expiresAt)) {
      await markConnectionError(userId, connectionId, "tink_reconsent_required");
      throw new BrokerSyncError("Tink token expired. Reconnect your bank to continue syncing.", "tink_reconsent_required", 409);
    }

    const accounts = await listConnectionAccounts(userId, connectionId);
    const selectedAccountIds = accounts.filter((account) => account.selected).map((account) => account.providerAccountId);
    if (selectedAccountIds.length === 0) {
      throw new BrokerSyncError("No accounts selected for this connection.", "tink_no_accounts_selected", 400);
    }
    if (selectedAccountIds.some((id) => isLikelyMockTinkAccountId(id))) {
      await markConnectionError(userId, connectionId, "tink_mock_accounts_selected");
      throw new BrokerSyncError(
        "Selected accounts are mock placeholders. Reconnect the broker to load real Tink accounts.",
        "tink_mock_accounts_selected",
        409
      );
    }

    try {
      normalized = await fetchTinkPositions({
        accessToken: secret.accessToken,
        selectedAccountIds
      });
    } catch (error) {
      if (requiresReconsentForTinkError(error)) {
        await markConnectionError(userId, connectionId, "tink_reconsent_required");
        throw new BrokerSyncError("Tink authorization expired. Reconnect your bank to continue syncing.", "tink_reconsent_required", 409);
      }
      await markConnectionError(userId, connectionId, "tink_sync_failed");
      throw new BrokerSyncError(
        error instanceof Error ? error.message : "Unable to fetch holdings from Tink.",
        "tink_sync_failed",
        502
      );
    }
  } else {
    const adapter = getBrokerAdapter(connection.broker);
    normalized = await adapter.fetchPositions(connection);
  }
  const scoped = applyDataScope(normalized, connection.dataScope);
  const positions = await replaceConnectionPositions(connectionId, userId, scoped);

  const updatedRows = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
    method: "PATCH",
    query: {
      id: eq(connectionId),
      select: CONNECTION_SELECT
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
  rows: NormalizedPosition[],
  options?: { dataScope?: BrokerDataScope }
): Promise<BrokerSyncResult> {
  const now = new Date().toISOString();
  const existing = await latestConnectionByBroker(userId, broker);
  const dataScope = options?.dataScope ?? "symbols_only";

  let connection: BrokerConnection;

  if (existing) {
    const updated = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
      method: "PATCH",
      query: {
        id: eq(existing.id),
        select: CONNECTION_SELECT
      },
      body: {
        status: "connected",
        auth_provider: "manual",
        data_scope: dataScope,
        last_synced_at: now,
        error_code: null,
        updated_at: now
      }
    });
    connection = toConnection(updated[0]);
  } else {
    const inserted = await userScoped<ConnectionRow[]>(userId, "broker_connections", {
      method: "POST",
      body: [
        {
          id: createId("conn"),
          broker,
          status: "connected",
          auth_provider: "manual",
          data_scope: dataScope,
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

  const scoped = applyDataScope(rows, dataScope);
  const positions = await replaceConnectionPositions(connection.id, userId, scoped);

  return {
    connection,
    positions
  };
}
