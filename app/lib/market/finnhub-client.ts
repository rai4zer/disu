/**
 * The shared Finnhub HTTP client.
 *
 * Extracted from `market-provider.ts` so that `index-quotes.ts` can use it
 * without importing the provider that will, in turn, import the index quotes —
 * a cycle. Nothing here knows about quotes, indices or the synthetic-data
 * policy: it is token handling, error shaping and JSON validation, and that is
 * all.
 *
 * COVERAGE, measured against the live API on 2026-08-27 with the current key:
 *
 *   /quote AAPL          -> 200, real data
 *   /quote EVO.ST        -> 403 "You don't have access to this resource."
 *   /quote VOLV-B.ST     -> 403
 *   /forex/rates         -> 403
 *
 * So on this plan Finnhub is a failover for **US equities only** (ROADMAP §2.7).
 */

export function finnhubToken(): string | null {
  const token = (process.env.FINNHUB_API_KEY ?? "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Reads a JSON body, refusing anything that is not actually JSON.
 *
 * Finnhub answers rate limits and auth failures with HTML or plain text, and
 * `JSON.parse` on an error page throws something unhelpful several frames away
 * from the cause.
 */
export async function readJsonResponse<T>(response: Response, source: string): Promise<T> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const bodyText = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`${source}: non-json response`);
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`${source}: invalid json response`);
  }
}

export async function finnhubFetch<T>(pathAndQuery: string, source: string, signal?: AbortSignal): Promise<T> {
  const token = finnhubToken();
  if (!token) {
    throw new Error(`${source}: FINNHUB_API_KEY is not configured`);
  }
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://finnhub.io/api/v1${pathAndQuery}${separator}token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" }, cache: "no-store", signal }
  );
  if (!response.ok) {
    // 403 means "your plan does not include this", not "Finnhub is down".
    // Worth distinguishing: one is fixed by paying, the other by waiting, and a
    // log full of bare 403s reads like an outage.
    if (response.status === 403) {
      throw new Error(`${source}: not included in the current Finnhub plan (HTTP 403)`);
    }
    throw new Error(`${source}: HTTP ${response.status}`);
  }
  return readJsonResponse<T>(response, source);
}

/**
 * A 403 means the plan does not include this data and a 429 means we are over
 * the call budget — in both cases every further symbol fails the same way, so
 * the caller should abandon the whole Finnhub phase rather than working through
 * nine indices to collect nine identical errors.
 */
export function isFinnhubPhaseFatal(message: string): boolean {
  return message.includes("HTTP 403") || message.includes("HTTP 429") || message.includes("HTTP 401");
}
