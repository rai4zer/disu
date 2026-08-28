/**
 * GDPR Art. 17 — erasure.
 *
 * The whole point of writing this now is that "delete my account" is only
 * trustworthy if it is exhaustive, and exhaustive is a property of the register
 * in `personal-data.ts`, not of anyone's memory. This function walks that
 * register; it never names a table itself.
 *
 * Order matters:
 *
 *   1. Refuse up front if a `blocks` foreign key would reject the delete, so the
 *      caller gets a clear explanation instead of a half-erased account and a
 *      database error.
 *   2. Cut authorship on public content (`anonymise`).
 *   3. Delete the rows that are the person's alone (`erase`).
 *   4. Delete the `users` row.
 *   5. Verify nothing is left, and say so if something is.
 *
 * Step 5 exists because the schema's own `on delete cascade` rules mean several
 * of these deletes are belt-and-braces. Belt-and-braces is worth nothing if you
 * never check whether either one held.
 */

import { PERSONAL_DATA_TABLES, tablesWithPolicy } from "@/app/lib/account/personal-data";
import { anonymiseRowsFor, countRowsFor, deleteUserRow, eraseRowsFor } from "@/app/lib/account/store";

export type AccountDeletionBlocker = {
  table: string;
  column: string;
  rowCount: number;
  reason: string;
};

export class AccountDeletionBlockedError extends Error {
  blockers: AccountDeletionBlocker[];

  constructor(blockers: AccountDeletionBlocker[]) {
    const summary = blockers.map((blocker) => `${blocker.table}.${blocker.column}`).join(", ");
    super(`Account cannot be erased while rows remain in: ${summary}`);
    this.name = "AccountDeletionBlockedError";
    this.blockers = blockers;
  }
}

export type AccountDeletionResult = {
  userId: string;
  deletedAt: string;
  /** Rows removed, per table. */
  erased: Record<string, number>;
  /** Rows whose authorship link was cut, per table. */
  anonymised: Record<string, number>;
};

/**
 * Reports what, if anything, would refuse an erasure. Callable on its own so a
 * UI can warn before the user commits rather than after.
 */
export async function findAccountDeletionBlockers(userId: string): Promise<AccountDeletionBlocker[]> {
  const blockers: AccountDeletionBlocker[] = [];
  for (const entry of tablesWithPolicy("blocks")) {
    const rowCount = await countRowsFor(userId, entry);
    if (rowCount > 0) {
      blockers.push({ table: entry.table, column: entry.column, rowCount, reason: entry.note });
    }
  }
  return blockers;
}

export async function deleteAccount(userId: string, now = new Date()): Promise<AccountDeletionResult> {
  if (!userId.trim()) {
    throw new Error("deleteAccount requires a user id.");
  }

  const blockers = await findAccountDeletionBlockers(userId);
  if (blockers.length > 0) {
    throw new AccountDeletionBlockedError(blockers);
  }

  const anonymised: Record<string, number> = {};
  for (const entry of tablesWithPolicy("anonymise")) {
    const count = await anonymiseRowsFor(userId, entry);
    if (count > 0) {
      anonymised[`${entry.table}.${entry.column}`] = count;
    }
  }

  const erased: Record<string, number> = {};
  for (const entry of tablesWithPolicy("erase")) {
    const count = await eraseRowsFor(userId, entry);
    if (count > 0) {
      erased[entry.table] = count;
    }
  }

  await deleteUserRow(userId);

  const leftovers: AccountDeletionBlocker[] = [];
  for (const entry of PERSONAL_DATA_TABLES) {
    if (entry.erasure === "anonymise") {
      continue;
    }
    const remaining = await countRowsFor(userId, entry);
    if (remaining > 0) {
      leftovers.push({
        table: entry.table,
        column: entry.column,
        rowCount: remaining,
        reason: "Rows survived erasure. Erasure is incomplete until this is resolved."
      });
    }
  }
  if (leftovers.length > 0) {
    throw new AccountDeletionBlockedError(leftovers);
  }

  return {
    userId,
    deletedAt: now.toISOString(),
    erased,
    anonymised
  };
}
