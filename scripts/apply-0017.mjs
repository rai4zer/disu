// One-off: applies db/migrations/0017_drop_weekly_updates.sql to the live
// Supabase project, removing the six tables left behind by the deleted Quant
// Updates feature. There is no migration runner in this repo; DDL goes through
// the Management API because PostgREST cannot carry it.
//
// Run from the repo root:  node scripts/apply-0017.mjs
//
// This migration is DESTRUCTIVE — `drop table`, not `create table if not
// exists`. It is guarded below: if any table has gained a row since this was
// written, the script refuses rather than dropping data. Pass --force to
// override, but read the counts it prints first.
import fs from "node:fs";

const PROJECT_REF = "ymvptljuivjulrxpokla";
const FORCE = process.argv.includes("--force");

// weekly_quant_updates is the pre-0008 name and is expected to be absent; it is
// checked anyway so an environment that never ran the rename is handled.
const DOOMED = [
  "weekly_update_dead_letters",
  "weekly_update_runs",
  "quant_update_deliveries",
  "weekly_quant_updates",
  "email_suppressions",
  "email_subscriptions",
  "watchlists"
];

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

const present = (
  await query(
    `select tablename from pg_tables where schemaname='public' and tablename in (${DOOMED.map((t) => `'${t}'`).join(",")})`
  )
).map((row) => row.tablename);

if (present.length === 0) {
  console.log("Nothing to do — 0017 already applied.");
  process.exit(0);
}

const counts = await query(present.map((t) => `select '${t}' as t, count(*) as n from ${t}`).join(" union all "));

console.log("Row counts before drop:");
for (const row of counts) {
  console.log(`  ${row.t}: ${row.n}`);
}

const nonEmpty = counts.filter((row) => Number(row.n) > 0);
if (nonEmpty.length > 0 && !FORCE) {
  console.error(
    `\nRefusing to drop — these are not empty: ${nonEmpty.map((r) => `${r.t} (${r.n})`).join(", ")}.` +
      `\nRe-run with --force only if you are certain this data is disposable.`
  );
  process.exit(1);
}

await query(fs.readFileSync("db/migrations/0017_drop_weekly_updates.sql", "utf8"));

const remaining = await query(
  `select tablename from pg_tables where schemaname='public' and tablename in (${DOOMED.map((t) => `'${t}'`).join(",")})`
);

console.log(
  remaining.length === 0
    ? "\n0017 applied — all seven tables gone."
    : `\nStill present after drop: ${remaining.map((r) => r.tablename).join(", ")}`
);
