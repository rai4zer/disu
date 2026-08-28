/**
 * Row access for the account export/erasure flows.
 *
 * These are the two places in the app that must touch *every* table holding a
 * person's data, including ones that are not user-scoped in the usual sense —
 * the public feature-request board, and `release_notes` where the link is
 * `created_by`/`updated_by` rather than `user_id`. So this is the one module
 * that reaches past `userScoped()`, and it does so through a single pair of
 * functions driven by the register in `personal-data.ts` rather than ad-hoc
 * queries scattered through a handler.
 */

import { eq, supabaseRequest } from "@/app/lib/db/supabase";
import { USER_OWNED_TABLES, userScoped, type UserOwnedTable } from "@/app/lib/db/user-scope";
import type { PersonalDataTable } from "@/app/lib/account/personal-data";

type Row = Record<string, unknown>;

function isUserScopable(entry: PersonalDataTable): boolean {
  // `userScoped()` filters on `user_id` by definition, so it fits only the
  // tables that both are registered as user-owned *and* use that column.
  return entry.column === "user_id" && (USER_OWNED_TABLES as readonly string[]).includes(entry.table);
}

export async function readRowsFor(userId: string, entry: PersonalDataTable): Promise<Row[]> {
  const query: Record<string, string> = { order: "id.asc" };
  if (entry.exportColumns) {
    query.select = entry.exportColumns;
  }

  if (isUserScopable(entry)) {
    return userScoped<Row[]>(userId, entry.table as UserOwnedTable, { query });
  }

  return supabaseRequest<Row[]>(entry.table, {
    query: { ...query, [entry.column]: eq(userId) }
  });
}

export async function countRowsFor(userId: string, entry: PersonalDataTable): Promise<number> {
  const rows = await supabaseRequest<Row[]>(entry.table, {
    query: { [entry.column]: eq(userId), select: "" + entry.column, limit: "1000" }
  });
  return rows.length;
}

export async function eraseRowsFor(userId: string, entry: PersonalDataTable): Promise<number> {
  if (isUserScopable(entry)) {
    const deleted = await userScoped<Row[]>(userId, entry.table as UserOwnedTable, {
      method: "DELETE",
      query: { select: "" + entry.column },
      prefer: "return=representation"
    });
    return deleted.length;
  }

  const deleted = await supabaseRequest<Row[]>(entry.table, {
    method: "DELETE",
    query: { [entry.column]: eq(userId), select: "" + entry.column },
    prefer: "return=representation"
  });
  return deleted.length;
}

/** Cuts the authorship link without removing content other people are reading. */
export async function anonymiseRowsFor(userId: string, entry: PersonalDataTable): Promise<number> {
  const updated = await supabaseRequest<Row[]>(entry.table, {
    method: "PATCH",
    query: { [entry.column]: eq(userId), select: "" + entry.column },
    body: { [entry.column]: null }
  });
  return updated.length;
}

export async function deleteUserRow(userId: string): Promise<void> {
  await supabaseRequest<unknown>("users", {
    method: "DELETE",
    query: { id: eq(userId) },
    prefer: "return=minimal"
  });
}

export async function readUserRow(userId: string, columns: string): Promise<Row | null> {
  const rows = await supabaseRequest<Row[]>("users", {
    query: { id: eq(userId), select: columns, limit: "1" }
  });
  return rows[0] ?? null;
}
