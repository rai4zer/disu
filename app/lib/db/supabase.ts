import { ensureRuntimeEnv } from "@/app/lib/runtime/env";

type QueryValue = string | number | boolean;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
};

export class SupabaseRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status;
  }
}

function getBaseUrl(): string {
  ensureRuntimeEnv();
  return process.env.SUPABASE_URL!.replace(/\/$/, "");
}

function getApiKey(): string {
  ensureRuntimeEnv();
  return process.env.SUPABASE_KEY!;
}

function toQueryString(query: Record<string, string> | undefined): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function eq(value: QueryValue): string {
  return `eq.${String(value)}`;
}

export function lt(value: QueryValue): string {
  return `lt.${String(value)}`;
}

export async function supabaseRequest<T>(table: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const url = `${getBaseUrl()}/rest/v1/${table}${toQueryString(options.query)}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: getApiKey(),
      Authorization: `Bearer ${getApiKey()}`,
      Prefer: options.prefer ?? "return=representation"
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; details?: string; hint?: string }
      | null;
    const details = [payload?.message, payload?.details, payload?.hint].filter(Boolean).join(" | ");
    throw new SupabaseRequestError(details || `Supabase request failed with status ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
