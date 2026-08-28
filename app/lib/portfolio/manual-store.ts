import { eq } from "@/app/lib/db/supabase";
import { userScoped } from "@/app/lib/db/user-scope";

export type ManualAccountType = "ISK" | "AF" | "KF" | "Other";

type ManualPositionRow = {
  id: string;
  user_id: string;
  ticker: string;
  shares: number;
  avg_cost: number | null;
  account_type: ManualAccountType | null;
  broker: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type ManualPosition = {
  id: string;
  ticker: string;
  shares: number;
  avgCost: number | null;
  accountType: ManualAccountType | null;
  broker: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateManualPositionInput = {
  ticker: string;
  shares: number;
  avgCost?: number | null;
  accountType?: ManualAccountType | null;
  broker?: string | null;
  currency: string;
};

export type UpdateManualPositionInput = Partial<CreateManualPositionInput>;

const MANUAL_POSITION_COLUMNS =
  "id,user_id,ticker,shares,avg_cost,account_type,broker,currency,created_at,updated_at";

function toManualPosition(row: ManualPositionRow): ManualPosition {
  return {
    id: row.id,
    ticker: row.ticker,
    shares: Number(row.shares),
    avgCost: row.avg_cost === null ? null : Number(row.avg_cost),
    accountType: row.account_type,
    broker: row.broker,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listManualPositions(userId: string): Promise<ManualPosition[]> {
  const rows = await userScoped<ManualPositionRow[]>(userId, "manual_positions", {
    query: {
      select: MANUAL_POSITION_COLUMNS,
      order: "created_at.desc"
    }
  });
  return rows.map(toManualPosition);
}

export async function createManualPosition(userId: string, input: CreateManualPositionInput): Promise<ManualPosition> {
  const rows = await userScoped<ManualPositionRow[]>(userId, "manual_positions", {
    method: "POST",
    body: {
      ticker: input.ticker,
      shares: input.shares,
      avg_cost: input.avgCost ?? null,
      account_type: input.accountType ?? null,
      broker: input.broker ?? null,
      currency: input.currency
    }
  });

  return toManualPosition(rows[0]);
}

export async function getManualPositionById(userId: string, positionId: string): Promise<ManualPosition | null> {
  const rows = await userScoped<ManualPositionRow[]>(userId, "manual_positions", {
    query: {
      id: eq(positionId),
      select: MANUAL_POSITION_COLUMNS,
      limit: "1"
    }
  });
  return rows[0] ? toManualPosition(rows[0]) : null;
}

export async function updateManualPosition(
  userId: string,
  positionId: string,
  input: UpdateManualPositionInput
): Promise<ManualPosition | null> {
  const body: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (input.ticker !== undefined) body.ticker = input.ticker;
  if (input.shares !== undefined) body.shares = input.shares;
  if (input.avgCost !== undefined) body.avg_cost = input.avgCost;
  if (input.accountType !== undefined) body.account_type = input.accountType;
  if (input.broker !== undefined) body.broker = input.broker;
  if (input.currency !== undefined) body.currency = input.currency;

  const rows = await userScoped<ManualPositionRow[]>(userId, "manual_positions", {
    method: "PATCH",
    query: {
      id: eq(positionId),
      select: MANUAL_POSITION_COLUMNS
    },
    body
  });

  return rows[0] ? toManualPosition(rows[0]) : null;
}

export async function deleteManualPosition(userId: string, positionId: string): Promise<boolean> {
  const existing = await getManualPositionById(userId, positionId);
  if (!existing) {
    return false;
  }

  await userScoped<unknown>(userId, "manual_positions", {
    method: "DELETE",
    query: {
      id: eq(positionId)
    },
    prefer: "return=minimal"
  });
  return true;
}
