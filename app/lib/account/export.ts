/**
 * GDPR Art. 15/20 — a copy of everything the app holds about one person, in a
 * machine-readable form they can take elsewhere.
 *
 * Driven entirely by `PERSONAL_DATA_TABLES`, so a table added to the schema and
 * registered there is exported automatically. Nothing here enumerates tables by
 * hand — that is how exports quietly go stale.
 */

import { PERSONAL_DATA_TABLES, USER_TABLE_EXPORT_COLUMNS } from "@/app/lib/account/personal-data";
import { readRowsFor, readUserRow } from "@/app/lib/account/store";

export type AccountExportSection = {
  table: string;
  /** The column linking these rows to the person. */
  linkedBy: string;
  /** Plain-language explanation of what this section is, taken from the register. */
  description: string;
  /** Set when the section deliberately omits columns, and why. */
  withheld?: string;
  rows: Array<Record<string, unknown>>;
};

export type AccountExport = {
  format: "disu.account-export";
  version: 1;
  exportedAt: string;
  account: Record<string, unknown> | null;
  sections: AccountExportSection[];
  notes: string[];
};

export async function exportAccountData(userId: string, now = new Date()): Promise<AccountExport> {
  const account = await readUserRow(userId, USER_TABLE_EXPORT_COLUMNS);

  // Sequential rather than parallel: an export is rare, not latency-sensitive,
  // and firing sixteen concurrent queries at Supabase on a user's whim is a
  // cheap way to make one person's download everyone else's outage.
  const sections: AccountExportSection[] = [];
  for (const entry of PERSONAL_DATA_TABLES) {
    const rows = await readRowsFor(userId, entry);
    if (rows.length === 0) {
      continue;
    }
    sections.push({
      table: entry.table,
      linkedBy: entry.column,
      description: entry.note,
      ...(entry.exportColumns ? { withheld: "Some columns are omitted — see description." } : {}),
      rows
    });
  }

  return {
    format: "disu.account-export",
    version: 1,
    exportedAt: now.toISOString(),
    account,
    sections,
    notes: [
      "Credentials are deliberately excluded: password hashes, encrypted broker access tokens and password-reset token hashes are not included. They are keys to the account, not information about you.",
      "Sections with no rows are omitted entirely."
    ]
  };
}
