// One-off: applies db/migrations/0024_instrument_profiles.sql to the live Supabase
// project. There is no migration runner in this repo; DDL goes through the
// Management API because PostgREST cannot carry it.
//
// Run from the repo root:  node scripts/apply-0024.mjs
//
// Non-destructive, unlike apply-0017.mjs: this only creates a table, an index
// and a policy, all `if not exists` / `drop policy if exists`, so re-running it
// is safe. It still refuses to touch an existing `instrument_profiles` that holds
// rows without --force, because a table already under that name is a sign the
// live schema is not what this file thinks it is.
//
// Until this runs, the app is fine: quote-cache.ts treats a missing table as a
// cold cache (see readCachedQuotes), so the sweep logs and the routes fall back
// to the live provider chain. Nothing breaks; it just does not get faster.
import fs from "node:fs";

const PROJECT_REF = "ymvptljuivjulrxpokla";
const FORCE = process.argv.includes("--force");

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN missing from .env");
  process.exit(1);
}

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
  return JSON.parse(body);
}

// A timeout here means the project auto-paused, not a bad token.
await query("select 1");
console.log("[0024] connected to", PROJECT_REF);

const existing = await query(
  "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'instrument_profiles'"
);

if (existing[0]?.n > 0) {
  const rows = await query("select count(*)::int as n from instrument_profiles");
  const count = rows[0]?.n ?? 0;
  console.log(`[0024] instrument_profiles already exists with ${count} row(s)`);
  if (count > 0 && !FORCE) {
    console.error("[0024] refusing to re-run against a populated table. Inspect it, then pass --force if this is expected.");
    process.exit(1);
  }
}

const sql = fs.readFileSync("db/migrations/0024_instrument_profiles.sql", "utf8");
await query(sql);
console.log("[0024] applied");

// Verify rather than trust the 200: a Management API success only says the
// statement parsed and ran, not that the shape is what the code expects.
const columns = await query(
  "select column_name, is_nullable, data_type from information_schema.columns where table_name = 'instrument_profiles' order by ordinal_position"
);
console.table(columns);

const expected = ["symbol", "payload", "quote_type", "sections", "fetched_at"];
const actual = columns.map((c) => c.column_name);
const missing = expected.filter((c) => !actual.includes(c));
if (missing.length) {
  console.error("[0024] MISSING COLUMNS:", missing.join(", "));
  process.exit(1);
}
console.log("[0024] verified: all 5 columns present");
