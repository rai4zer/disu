/**
 * The register of everywhere a user's personal data lives.
 *
 * GDPR gives a person two rights this app has to be able to honour on demand:
 * get a copy of their data (Art. 15/20) and have it erased (Art. 17). Both
 * questions reduce to the same one — *where is it?* — and the only reliable
 * answer is one written down in a single place and checked by the build.
 *
 * Written now, while there are sixteen tables, because this list only ever gets
 * longer and a table that was never added to it is a table that silently
 * survives a deletion request (ROADMAP §2.2).
 *
 * `scripts/check-delivery-readiness.mjs` reads this file, cross-references every
 * `references users(id)` in `db/migrations/`, and fails the build on a table
 * that exists in the schema but not here. Forgetting is a build error, not a
 * breach notification.
 */

/**
 * What happens to a table's rows when the person asks to be erased.
 *
 * - `erase` — the rows are theirs alone and are deleted outright.
 * - `anonymise` — the row is public content that other people are reading and
 *   replying to. Deleting it would rewrite a shared thread; the authorship link
 *   is cut instead, which is what erasure means for content contributed to a
 *   public forum.
 * - `blocks` — a foreign key that refuses the delete. Must be resolved by a
 *   human before erasure can proceed, and is reported rather than worked around.
 */
export type ErasurePolicy = "erase" | "anonymise" | "blocks";

export type PersonalDataTable = {
  table: string;
  /** The column pointing at `users.id`. */
  column: string;
  erasure: ErasurePolicy;
  /**
   * Columns included in a data export. `null` exports the whole row.
   *
   * Narrowed where a row holds a *credential* rather than information about the
   * person: exporting a password hash or an encrypted broker access token hands
   * out the keys instead of the contents, and neither tells the person anything
   * about themselves they did not already know.
   */
  exportColumns: string | null;
  /** Why this table is treated the way it is. Read this before changing a row. */
  note: string;
};

export const PERSONAL_DATA_TABLES: PersonalDataTable[] = [
  {
    table: "broker_connections",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Which brokers the person linked, and when."
  },
  {
    table: "broker_connection_accounts",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "The accounts discovered behind each connection."
  },
  {
    table: "broker_connection_secrets",
    column: "user_id",
    erasure: "erase",
    exportColumns: "id,user_id,connection_id,provider,token_expires_at,token_scope,created_at,updated_at",
    note:
      "Holds encrypted broker access tokens. The metadata is exported; the tokens are not — " +
      "they are live credentials to a third-party bank connection, not information about the person."
  },
  {
    table: "positions",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Holdings synced from a broker."
  },
  {
    table: "manual_positions",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Holdings the person entered by hand."
  },
  {
    table: "portfolio_snapshots",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note:
      "Daily history of what their portfolio was worth. Theirs alone, and the one table here " +
      "an export cannot be reconstructed from anywhere else — nothing else records a past day."
  },
  {
    table: "jobs",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Quant and primer runs they requested, including the payload."
  },
  {
    table: "job_artifacts",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Outputs produced by those runs."
  },
  {
    table: "events",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Audit trail of their own actions."
  },
  {
    table: "analytics_events",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note:
      "Funnel measurement, recorded only with analytics consent. Erased rather than anonymised: " +
      "these rows are nobody else's content and nobody is reading them in a thread, so keeping a " +
      "de-linked copy would be keeping data for our convenience after being asked to stop.",
  },
  {
    table: "user_roles",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "Admin grants."
  },
  {
    table: "user_sessions",
    column: "user_id",
    erasure: "erase",
    exportColumns: "id,user_id,created_at,expires_at,revoked_at,revoked_reason",
    note: "Sign-in sessions. Exported so the person can see when their account was used."
  },
  {
    table: "password_reset_tokens",
    column: "user_id",
    erasure: "erase",
    exportColumns: "id,user_id,expires_at,used_at,created_at",
    note: "The token hash is withheld: it is a live credential for taking over the account."
  },
  {
    table: "feature_request_votes",
    column: "user_id",
    erasure: "erase",
    exportColumns: null,
    note: "A vote carries no content, so erasing it removes nothing others are reading."
  },
  {
    table: "feature_requests",
    column: "user_id",
    erasure: "anonymise",
    exportColumns: null,
    note:
      "Public board posts other users have commented on and voted for. The post stays, " +
      "the authorship link is cut (the schema already declares `on delete set null`)."
  },
  {
    table: "feature_request_comments",
    column: "user_id",
    erasure: "anonymise",
    exportColumns: null,
    note: "Replies in a public thread. Same reasoning as feature_requests."
  },
  {
    table: "release_notes",
    column: "updated_by",
    erasure: "anonymise",
    exportColumns: "id,slug,status,published_at,created_by,updated_by,created_at,updated_at",
    note: "Only records that an admin last edited a note; the note itself is company content."
  },
  {
    table: "release_notes",
    column: "created_by",
    erasure: "blocks",
    exportColumns: "id,slug,status,published_at,created_by,updated_by,created_at,updated_at",
    note:
      "`on delete restrict` — the database refuses to delete an admin who authored a release " +
      "note. Deliberate: company content must not vanish because a colleague left. Reassign " +
      "authorship first, then erase. Reported to the caller rather than silently failing."
  }
];

/** The user's own row. Handled separately: it is keyed by `id`, not a user column. */
export const USER_TABLE_EXPORT_COLUMNS = "id,email,google_sub,created_at";

export function tablesWithPolicy(policy: ErasurePolicy): PersonalDataTable[] {
  return PERSONAL_DATA_TABLES.filter((entry) => entry.erasure === policy);
}
