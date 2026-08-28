/**
 * A small in-memory stand-in for the PostgREST surface `supabaseRequest()` talks to.
 *
 * Enough of the dialect to run the real store modules unmodified: `eq`, `is.null`,
 * `in.(…)`, `lt`, `->>` JSON access, `order`, `limit`, `offset`, and the
 * `return=minimal` Prefer header.
 *
 * The point is not to emulate Postgres. It is that cross-tenant assertions can
 * run in `npm run ci` on every commit instead of only when someone has a live
 * Supabase project wired up — a leak this class is exactly the kind of bug that
 * gets introduced on a Tuesday and found by a stranger.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

export type FakeSupabaseRequest = {
  method: string;
  table: string;
  query: Record<string, string>;
  body: unknown;
};

export type FakeSupabase = {
  url: string;
  rowsIn(table: string): Row[];
  requests: FakeSupabaseRequest[];
  close(): Promise<void>;
};

function matchesFilter(row: Row, column: string, expression: string): boolean {
  const value = column.includes("->>")
    ? (() => {
        const [base, key] = column.split("->>");
        const container = row[base] as Row | undefined;
        const nested = container && typeof container === "object" ? container[key] : undefined;
        return nested === undefined || nested === null ? nested : String(nested);
      })()
    : row[column];

  if (expression === "is.null") {
    return value === null || value === undefined;
  }
  if (expression === "not.is.null") {
    return value !== null && value !== undefined;
  }
  if (expression.startsWith("eq.")) {
    return String(value) === expression.slice(3);
  }
  if (expression.startsWith("lt.")) {
    return String(value) < expression.slice(3);
  }
  if (expression.startsWith("in.(")) {
    const members = expression
      .slice(4, -1)
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, ""));
    return members.includes(String(value));
  }
  throw new Error(`fake-supabase: unsupported filter "${column}=${expression}"`);
}

const MODIFIERS = new Set(["select", "order", "limit", "offset"]);

/**
 * Applies `?select=` the way PostgREST does — as a projection, not a hint.
 *
 * This matters more than it looks: `personal-data.ts` withholds password hashes
 * and encrypted broker tokens from an account export *by narrowing select*. A
 * fake that returned whole rows regardless would report a leak that production
 * does not have, and would equally fail to catch one that it does.
 *
 * Kept separate from `applyQuery` so filtering still yields live row references
 * for PATCH/DELETE to mutate; only the response is projected.
 */
function project(rows: Row[], params: URLSearchParams): Row[] {
  const select = params.get("select");
  if (!select || select === "*") {
    return rows.map((row) => ({ ...row }));
  }

  const columns = select
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column && column !== "*");
  if (columns.length === 0) {
    return rows.map((row) => ({ ...row }));
  }

  return rows.map((row) => {
    const projected: Row = {};
    for (const column of columns) {
      if (column in row) {
        projected[column] = row[column];
      }
    }
    return projected;
  });
}

function applyQuery(rows: Row[], params: URLSearchParams): Row[] {
  let result = rows;
  for (const [column, expression] of params.entries()) {
    if (MODIFIERS.has(column)) continue;
    result = result.filter((row) => matchesFilter(row, column, expression));
  }

  const order = params.get("order");
  if (order) {
    const [column, direction = "asc"] = order.split(".");
    result = [...result].sort((a, b) => {
      const left = (a[column] ?? "") as string | number;
      const right = (b[column] ?? "") as string | number;
      if (left === right) return 0;
      const ascending = left > right ? 1 : -1;
      return direction.startsWith("desc") ? -ascending : ascending;
    });
  }

  const offset = Number(params.get("offset") ?? 0);
  const limit = params.get("limit") ? Number(params.get("limit")) : undefined;
  return result.slice(offset, limit === undefined ? undefined : offset + limit);
}

export async function startFakeSupabase(seed: Tables = {}): Promise<FakeSupabase> {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  );
  /** Every request the app made, for asserting on the wire format itself. */
  const requests: FakeSupabaseRequest[] = [];

  function tableRows(name: string): Row[] {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const table = url.pathname.replace(/^\/rest\/v1\//, "");
      const params = url.searchParams;
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : undefined;
      const rows = tableRows(table);

      requests.push({ method: req.method ?? "GET", table, query: Object.fromEntries(params.entries()), body });

      let payload: Row[];
      if (req.method === "GET") {
        payload = applyQuery(rows, params);
      } else if (req.method === "POST") {
        const incoming = (Array.isArray(body) ? body : [body]).map((row: Row) => ({ ...row }));
        rows.push(...incoming);
        payload = incoming;
      } else if (req.method === "PATCH") {
        const targets = applyQuery(rows, params);
        for (const row of targets) {
          Object.assign(row, body);
        }
        payload = targets;
      } else if (req.method === "DELETE") {
        const targets = applyQuery(rows, params);
        const doomed = new Set(targets);
        const kept = rows.filter((row) => !doomed.has(row));
        rows.length = 0;
        rows.push(...kept);
        payload = targets;
      } else {
        res.writeHead(405).end();
        return;
      }

      if ((req.headers.prefer ?? "").includes("return=minimal")) {
        res.writeHead(204).end();
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(project(payload, params)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    rowsIn: (table) => tableRows(table).map((row) => ({ ...row })),
    requests,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
