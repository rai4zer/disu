// One-off: applies db/migrations/0019_user_sessions.sql to the live Supabase
// project. There is no migration runner in this repo (see architecture.md);
// DDL goes through the Management API because PostgREST cannot carry it.
//
// Run from the repo root:  node scripts/apply-0019.mjs
import fs from "node:fs";

const PROJECT_REF = "ymvptljuivjulrxpokla";

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

await query(fs.readFileSync("db/migrations/0019_user_sessions.sql", "utf8"));

const columns = await query(
  "select column_name from information_schema.columns " +
    "where table_schema='public' and table_name='user_sessions' order by ordinal_position"
);
const policies = await query(
  "select p.polname from pg_class c join pg_policy p on p.polrelid = c.oid where c.relname='user_sessions'"
);

console.log("user_sessions columns:", columns.map((row) => row.column_name).join(", "));
console.log("policies:", policies.map((row) => row.polname).join(", ") || "(none)");
