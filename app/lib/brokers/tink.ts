import { createHash, createHmac, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { BrokerAccountType, BrokerProvider, NormalizedPosition } from "@/app/lib/brokers/types";

export const TINK_STATE_COOKIE = "disu_tink_state";

const TINK_AUTH_BASE_URL = (process.env.TINK_AUTH_BASE_URL ?? "https://link.tink.com/1.0/products/connect-accounts").trim();
const TINK_API_BASE_URL = (process.env.TINK_API_BASE_URL ?? "https://api.tink.com").trim();

type StatePayload = {
  userId: string;
  connectionId: string;
  broker: BrokerProvider;
  issuedAt: number;
  nonce: string;
};

export type TinkBrokerAccount = {
  providerAccountId: string;
  providerAccountName: string;
  accountType: BrokerAccountType;
};

export class TinkApiError extends Error {
  status: number;
  code: string;
  body: string;

  constructor(status: number, message: string, code = "tink_api_error", body = "") {
    super(message);
    this.name = "TinkApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type TinkHolding = {
  symbol: string;
  isin: string;
  name: string;
  quantity: number;
  avgCost: number;
  currency: string;
  marketValue: number;
  asOf: string;
};

function requiredEnv(name: "TINK_CLIENT_ID" | "TINK_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getTinkClientId(): string {
  return requiredEnv("TINK_CLIENT_ID");
}

function getTinkClientSecret(): string {
  return requiredEnv("TINK_CLIENT_SECRET");
}

function getSigningSecret(): string {
  const secret = process.env.DISU_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing required env var: DISU_SESSION_SECRET");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function encodeStatePayload(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(body);
  return `${body}.${signature}`;
}

function decodeStatePayload(encoded: string): StatePayload {
  const [body, signature] = encoded.split(".");
  if (!body || !signature || sign(body) !== signature) {
    throw new Error("Invalid Tink OAuth state signature");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (!payload.userId || !payload.connectionId || !payload.broker || !payload.nonce || !Number.isFinite(payload.issuedAt)) {
    throw new Error("Invalid Tink OAuth state payload");
  }
  if (Date.now() - payload.issuedAt > 1000 * 60 * 10) {
    throw new Error("Expired Tink OAuth state");
  }
  return payload;
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createTinkState(input: { userId: string; connectionId: string; broker: BrokerProvider }): string {
  return encodeStatePayload({
    userId: input.userId,
    connectionId: input.connectionId,
    broker: input.broker,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("hex")
  });
}

export function parseTinkState(encoded: string): StatePayload {
  return decodeStatePayload(encoded);
}

export function buildTinkAuthorizeUrl(input: {
  request: NextRequest;
  state: string;
  language: "sv" | "en";
}): { url: string; codeVerifier: string } {
  const redirectUri = process.env.TINK_REDIRECT_URI?.trim() || `${input.request.nextUrl.origin}/api/brokers/tink/callback`;
  const scope = (process.env.TINK_SCOPE ?? "accounts:read,investment-accounts:readonly").trim();
  const market = (process.env.TINK_MARKET ?? "SE").trim();
  const locale = input.language === "sv" ? "sv_SE" : "en_US";
  const products = (process.env.TINK_LINK_PRODUCTS ?? "INVESTMENTS").trim();

  const codeVerifier = randomBytes(32).toString("base64url");
  const url = new URL(TINK_AUTH_BASE_URL);
  url.searchParams.set("client_id", getTinkClientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("market", market);
  url.searchParams.set("locale", locale);
  url.searchParams.set("products", products);
  url.searchParams.set("code_challenge", codeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), codeVerifier };
}

export async function exchangeCodeForAccessToken(input: {
  code: string;
  codeVerifier: string;
  request: NextRequest;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  userRef: string | null;
  expiresAt: string | null;
  scope: string | null;
}> {
  const redirectUri = process.env.TINK_REDIRECT_URI?.trim() || `${input.request.nextUrl.origin}/api/brokers/tink/callback`;

  const body = new URLSearchParams();
  body.set("client_id", getTinkClientId());
  body.set("client_secret", getTinkClientSecret());
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", input.codeVerifier);

  const response = await fetch(`${TINK_API_BASE_URL}/api/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Tink token exchange failed (${response.status}): ${payload}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    user_id?: string;
  };

  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error("Tink token response did not include access_token");
  }

  const expiresAt =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null;

  return {
    accessToken,
    refreshToken: payload.refresh_token?.trim() || null,
    userRef: payload.user_id?.trim() || null,
    expiresAt,
    scope: payload.scope?.trim() || null
  };
}

function classifyAccountType(name: string, providerType: string): BrokerAccountType {
  const sample = `${name} ${providerType}`.toLowerCase();
  if (sample.includes("isk")) {
    return "isk";
  }
  if (sample.includes("kapital") || sample.includes("kf")) {
    return "kf";
  }
  if (sample.includes("af") || sample.includes("aktie")) {
    return "af";
  }
  return "other";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAtPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstValue(root: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    const value = valueAtPath(root, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (isObject(value)) {
    const nestedValue = value.value;
    if (nestedValue !== undefined) {
      const fromValue = toFiniteNumber(nestedValue);
      if (fromValue !== 0) {
        return fromValue;
      }
    }
    const nestedAmount = value.amount;
    if (nestedAmount !== undefined) {
      const fromAmount = toFiniteNumber(nestedAmount);
      if (fromAmount !== 0) {
        return fromAmount;
      }
    }
    const unscaledRaw = value.unscaledValue;
    const scaleRaw = value.scale;
    const unscaled = typeof unscaledRaw === "number" ? unscaledRaw : Number(String(unscaledRaw ?? ""));
    const scale = typeof scaleRaw === "number" ? scaleRaw : Number(String(scaleRaw ?? ""));
    if (Number.isFinite(unscaled) && Number.isFinite(scale)) {
      return unscaled / 10 ** scale;
    }
  }
  return 0;
}

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function resolveIdentifiers(row: unknown): { isin: string; symbol: string } {
  const identifiers = firstValue(row, [
    ["instrument", "identifiers"],
    ["financialInstrument", "identifiers"],
    ["identifiers"]
  ]);
  if (!Array.isArray(identifiers)) {
    return { isin: "", symbol: "" };
  }

  let isin = "";
  let symbol = "";
  for (const item of identifiers) {
    if (!isObject(item)) {
      continue;
    }
    const type = toText(item.type).toUpperCase();
    const value = toText(item.value) || toText(item.identifier) || toText(item.code) || toText(item.id);
    if (!value) {
      continue;
    }
    if (!isin && type === "ISIN") {
      isin = value;
    }
    if (!symbol && (type === "TICKER" || type === "SYMBOL")) {
      symbol = value;
    }
  }
  return { isin, symbol };
}

function normalizeSymbol(value: string): string {
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  return cleaned.slice(0, 32);
}

function resolveCurrency(row: unknown): string {
  const raw = toText(
    firstValue(row, [
      ["currency"],
      ["currency_code"],
      ["currencyCode"],
      ["market_value", "currency_code"],
      ["market_value", "currency"],
      ["holdingValue", "currencyCode"],
      ["holdingValue", "currency_code"],
      ["holdingValue", "currency"],
      ["value", "currency_code"],
      ["value", "currency"],
      ["instrument", "currency"],
      ["instrument", "currency_code"],
      ["financialInstrument", "currency"],
      ["financialInstrument", "currencyCode"],
      ["financialInstrument", "currency_code"],
      ["price", "currency_code"],
      ["price", "currency"]
    ])
  );
  return raw || "SEK";
}

function resolveTimestamp(row: unknown): string {
  const raw = toText(
    firstValue(row, [
      ["as_of"],
      ["asOf"],
      ["updated_at"],
      ["updatedAt"],
      ["last_updated"],
      ["lastUpdated"],
      ["timestamp"],
      ["value_date"],
      ["valueDate"]
    ])
  );
  if (!raw) {
    return new Date().toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function mapHolding(row: unknown): TinkHolding | null {
  const identifiers = resolveIdentifiers(row);
  const symbolCandidate =
    toText(
      firstValue(row, [
        ["symbol"],
        ["ticker"],
        ["financialInstrument", "symbol"],
        ["financialInstrument", "ticker"],
        ["financialInstrument", "tickerSymbol"],
        ["financialInstrument", "ticker_symbol"],
        ["financialInstrument", "shortName"],
        ["instrument", "symbol"],
        ["instrument", "ticker"],
        ["instrument", "ticker_symbol"],
        ["instrument", "tickerSymbol"],
      ])
    ) ||
    identifiers.symbol ||
    toText(
      firstValue(row, [
        ["instrument_id"],
        ["instrumentId"],
        ["financialInstrument", "id"],
        ["financialInstrument", "instrumentId"],
        ["instrument", "id"],
      ])
    ) ||
    toText(firstValue(row, [["isin"], ["instrument", "isin"]])) ||
    identifiers.isin;

  const symbol = normalizeSymbol(symbolCandidate);
  const isin =
    toText(
      firstValue(row, [
        ["isin"],
        ["instrument", "isin"],
        ["financialInstrument", "isin"]
      ])
    ) || identifiers.isin;
  const name =
    toText(
      firstValue(row, [
        ["name"],
        ["financialInstrument", "name"],
        ["financialInstrument", "shortName"],
        ["financialInstrument", "displayName"],
        ["financialInstrument", "display_name"],
        ["instrument", "display_name"],
        ["instrument", "displayName"],
        ["instrument", "name"],
        ["instrument_name"],
        ["instrumentName"],
        ["display_name"],
        ["displayName"]
      ])
    ) ||
    symbol ||
    toText(firstValue(row, [["financialInstrument", "id"], ["accountId"]]));

  const accountId = toText(firstValue(row, [["accountId"]]));
  const fallbackSymbol = symbol || normalizeSymbol(isin || name || accountId) || "UNKNOWN";
  const fallbackName = name || fallbackSymbol || "Unknown holding";
  const hasIdentitySignal = Boolean(symbolCandidate || isin || name || accountId || toText(firstValue(row, [["financialInstrument", "id"]])));

  if (!fallbackSymbol || !fallbackName || !hasIdentitySignal) {
    return null;
  }

  const quantity = toFiniteNumber(firstValue(row, [["quantity"], ["units"], ["shares"], ["balance"], ["holdings"]]));
  const resolvedQuantity =
    quantity ||
    toFiniteNumber(
      firstValue(row, [
        ["quantity", "value"],
        ["quantity", "amount"],
        ["units", "value"],
        ["balance", "value"]
      ])
    );
  const avgCost = toFiniteNumber(
    firstValue(row, [
      ["average_cost"],
      ["avg_cost"],
      ["averagePrice"],
      ["average_price"],
      ["averagePrice", "value"],
      ["average_cost", "value"],
      ["cost_basis"],
      ["costBasis"],
      ["acquisition_price", "amount"],
      ["acquisition_price", "value"]
    ])
  );
  const marketValue = toFiniteNumber(
    firstValue(row, [
      ["holdingValue", "amount"],
      ["holdingValue", "value"],
      ["holdingValue"],
      ["market_value", "amount"],
      ["market_value", "value"],
      ["marketValue", "amount"],
      ["marketValue", "value"],
      ["value", "amount"],
      ["value", "value"],
      ["market_value"],
      ["marketValue"],
      ["value"],
      ["current_value"],
      ["currentValue"],
      ["position_value"]
    ])
  );

  return {
    symbol: fallbackSymbol,
    isin,
    name: fallbackName,
    quantity: resolvedQuantity,
    avgCost,
    currency: resolveCurrency(row),
    marketValue,
    asOf: resolveTimestamp(row)
  };
}

function extractHoldingRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isObject(payload)) {
    return [];
  }

  const candidates = [
    payload.holdings,
    payload.positions,
    payload.investments,
    payload.securities,
    payload.items,
    valueAtPath(payload, ["result", "holdings"]),
    valueAtPath(payload, ["result", "positions"]),
    valueAtPath(payload, ["data", "holdings"]),
    valueAtPath(payload, ["data", "positions"])
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function mapHoldingsPayload(payload: unknown): TinkHolding[] {
  return extractHoldingRows(payload)
    .map((row) => mapHolding(row))
    .filter((row): row is TinkHolding => row !== null);
}

function mapAccountsPayload(payload: unknown): TinkBrokerAccount[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as { accounts?: unknown[] };
  if (!Array.isArray(root.accounts)) {
    return [];
  }

  return root.accounts
    .map((row) => {
      const item = row as {
        id?: string;
        account_id?: string;
        name?: string;
        display_name?: string;
        type?: string;
        account_type?: string;
      };
      const id = String(item.id ?? item.account_id ?? "").trim();
      const name = String(item.name ?? item.display_name ?? id).trim();
      const providerType = String(item.type ?? item.account_type ?? "").trim();
      if (!id || !name) {
        return null;
      }
      return {
        providerAccountId: id,
        providerAccountName: name,
        accountType: classifyAccountType(name, providerType)
      };
    })
    .filter((item): item is TinkBrokerAccount => item !== null);
}

function mapInvestmentAccountsPayload(payload: unknown): TinkBrokerAccount[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as {
    investment_accounts?: unknown[];
    investmentAccounts?: unknown[];
    accounts?: unknown[];
    items?: unknown[];
  };

  const rows =
    (Array.isArray(root.investment_accounts) && root.investment_accounts) ||
    (Array.isArray(root.investmentAccounts) && root.investmentAccounts) ||
    (Array.isArray(root.accounts) && root.accounts) ||
    (Array.isArray(root.items) && root.items) ||
    [];

  return rows
    .map((row) => {
      const item = row as {
        id?: string;
        account_id?: string;
        accountId?: string;
        name?: string;
        display_name?: string;
        displayName?: string;
        type?: string;
        account_type?: string;
        accountType?: string;
      };
      const id = String(item.id ?? item.account_id ?? item.accountId ?? "").trim();
      const name = String(item.name ?? item.display_name ?? item.displayName ?? id).trim();
      const providerType = String(item.type ?? item.account_type ?? item.accountType ?? "").trim();
      if (!id || !name) {
        return null;
      }
      return {
        providerAccountId: id,
        providerAccountName: name,
        accountType: classifyAccountType(name, providerType)
      };
    })
    .filter((item): item is TinkBrokerAccount => item !== null);
}

function mockAccounts(broker: BrokerProvider): TinkBrokerAccount[] {
  const base = broker.toUpperCase();
  return [
    {
      providerAccountId: `${base}-ISK-001`,
      providerAccountName: `${broker} ISK`,
      accountType: "isk"
    },
    {
      providerAccountId: `${base}-AF-002`,
      providerAccountName: `${broker} AF`,
      accountType: "af"
    }
  ];
}

function allowMockAccountsInDev(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TINK_ALLOW_MOCK_ACCOUNTS === "1";
}

export function isLikelyMockTinkAccountId(accountId: string): boolean {
  return /^[A-Z]+-(ISK|AF|KF)-\d{3}$/.test(accountId.trim());
}

export async function discoverBrokerAccounts(input: { accessToken: string; broker: BrokerProvider }): Promise<TinkBrokerAccount[]> {
  const accountsResponse = await fetch(`${TINK_API_BASE_URL}/data/v2/accounts`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    cache: "no-store"
  });

  if (!accountsResponse.ok) {
    if (allowMockAccountsInDev()) {
      return mockAccounts(input.broker);
    }
    const text = await accountsResponse.text();
    throw new Error(`Tink account discovery failed (/data/v2/accounts ${accountsResponse.status}): ${text}`);
  }

  const accountsPayload = (await accountsResponse.json()) as unknown;
  const accounts = mapAccountsPayload(accountsPayload);
  if (accounts.length > 0) {
    return accounts;
  }

  const investmentResponse = await fetch(`${TINK_API_BASE_URL}/data/v2/investment-accounts`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    cache: "no-store"
  });

  if (!investmentResponse.ok) {
    if (allowMockAccountsInDev()) {
      return mockAccounts(input.broker);
    }
    const text = await investmentResponse.text();
    throw new Error(`Tink account discovery failed (/data/v2/investment-accounts ${investmentResponse.status}): ${text}`);
  }

  const investmentPayload = (await investmentResponse.json()) as unknown;
  const investmentAccounts = mapInvestmentAccountsPayload(investmentPayload);
  if (investmentAccounts.length > 0) {
    return investmentAccounts;
  }

  if (allowMockAccountsInDev()) {
    return mockAccounts(input.broker);
  }

  throw new Error(
    `No accounts returned from Tink account discovery (accounts=0, investment_accounts=0). Ensure INVESTMENTS product/scope is enabled and user has supported investment accounts.`
  );
}

async function fetchTinkJson(input: { accessToken: string; path: string }): Promise<unknown> {
  const response = await fetch(`${TINK_API_BASE_URL}${input.path}`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    cache: "no-store"
  });

  const text = await response.text();
  if (!response.ok) {
    throw new TinkApiError(response.status, `Tink request failed for ${input.path}`, "tink_request_failed", text);
  }

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TinkApiError(response.status, `Tink JSON parse failed for ${input.path}`, "tink_invalid_json", text);
  }
}

function dedupeHoldings(rows: TinkHolding[]): TinkHolding[] {
  const byKey = new Map<string, TinkHolding>();
  for (const row of rows) {
    const key = `${row.symbol.toUpperCase()}::${row.isin.toUpperCase()}::${row.currency.toUpperCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.quantity += row.quantity;
    existing.marketValue += row.marketValue;
    if (existing.avgCost === 0 && row.avgCost > 0) {
      existing.avgCost = row.avgCost;
    }
    if (new Date(row.asOf).getTime() > new Date(existing.asOf).getTime()) {
      existing.asOf = row.asOf;
    }
  }
  return [...byKey.values()];
}

export function mapTinkHoldingsPayloadForTests(payload: unknown): TinkHolding[] {
  return mapHoldingsPayload(payload);
}

export async function fetchTinkPositions(input: {
  accessToken: string;
  selectedAccountIds: string[];
}): Promise<NormalizedPosition[]> {
  const selected = [...new Set(input.selectedAccountIds.map((id) => id.trim()).filter(Boolean))];
  if (selected.length === 0) {
    return [];
  }

  const allRows: TinkHolding[] = [];
  for (const accountId of selected) {
    const payload = await fetchTinkJson({
      accessToken: input.accessToken,
      path: `/data/v2/investment-accounts/${encodeURIComponent(accountId)}/holdings`
    });
    const rows = mapHoldingsPayload(payload);
    allRows.push(...rows);
  }

  return dedupeHoldings(allRows).map((row) => ({
    symbol: row.symbol,
    isin: row.isin,
    name: row.name,
    quantity: row.quantity,
    avgCost: row.avgCost,
    currency: row.currency,
    marketValue: row.marketValue,
    asOf: row.asOf
  }));
}

export type TinkDiagnosticsEndpoint = {
  path: string;
  ok: boolean;
  status: number;
  count: number;
  rawCount?: number;
  topLevelKeys?: string[];
  sampleItemKeys?: string[];
  error?: string;
};

export type TinkDiagnosticsReport = {
  token: {
    expiresAt: string | null;
    isExpired: boolean;
    scope: string | null;
  };
  selectedAccounts: string[];
  accountsEndpoint: TinkDiagnosticsEndpoint;
  investmentAccountsEndpoint: TinkDiagnosticsEndpoint;
  holdingsEndpoints: TinkDiagnosticsEndpoint[];
};

function parseTopLevelCount(payload: unknown): number {
  if (!isObject(payload)) {
    return 0;
  }
  const topLevelCandidates = [
    payload.accounts,
    payload.investment_accounts,
    payload.investmentAccounts,
    payload.positions,
    payload.holdings,
    payload.items
  ];
  for (const value of topLevelCandidates) {
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 0;
}

async function fetchTinkEndpointDiagnostics(input: { accessToken: string; path: string; countMode: "top_level" | "holdings" }) {
  const response = await fetch(`${TINK_API_BASE_URL}${input.path}`, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    },
    cache: "no-store"
  });
  const text = await response.text();

  if (!response.ok) {
    return {
      path: input.path,
      ok: false,
      status: response.status,
      count: 0,
      error: text.slice(0, 300)
    } satisfies TinkDiagnosticsEndpoint;
  }

  if (!text.trim()) {
    return {
      path: input.path,
      ok: true,
      status: response.status,
      count: 0
    } satisfies TinkDiagnosticsEndpoint;
  }

  try {
    const payload = JSON.parse(text) as unknown;
    const topLevelKeys = isObject(payload) ? Object.keys(payload).slice(0, 20) : [];
    const rawCount = input.countMode === "holdings" ? extractHoldingRows(payload).length : parseTopLevelCount(payload);
    const count = input.countMode === "holdings" ? mapHoldingsPayload(payload).length : rawCount;
    let sampleItemKeys: string[] | undefined;
    if (input.countMode === "holdings") {
      const rows = extractHoldingRows(payload);
      const first = rows[0];
      if (isObject(first)) {
        sampleItemKeys = Object.keys(first).slice(0, 20);
      }
    }
    return {
      path: input.path,
      ok: true,
      status: response.status,
      count,
      rawCount,
      topLevelKeys,
      sampleItemKeys
    } satisfies TinkDiagnosticsEndpoint;
  } catch {
    return {
      path: input.path,
      ok: false,
      status: response.status,
      count: 0,
      error: "Invalid JSON payload"
    } satisfies TinkDiagnosticsEndpoint;
  }
}

export async function diagnoseTinkIntegration(input: {
  accessToken: string;
  selectedAccountIds: string[];
  tokenExpiresAt: string | null;
  tokenScope: string | null;
}): Promise<TinkDiagnosticsReport> {
  const selectedAccounts = [...new Set(input.selectedAccountIds.map((id) => id.trim()).filter(Boolean))];
  const expiryMs = input.tokenExpiresAt ? Date.parse(input.tokenExpiresAt) : Number.NaN;
  const isExpired = Number.isFinite(expiryMs) ? expiryMs <= Date.now() : false;

  const [accountsEndpoint, investmentAccountsEndpoint] = await Promise.all([
    fetchTinkEndpointDiagnostics({
      accessToken: input.accessToken,
      path: "/data/v2/accounts",
      countMode: "top_level"
    }),
    fetchTinkEndpointDiagnostics({
      accessToken: input.accessToken,
      path: "/data/v2/investment-accounts",
      countMode: "top_level"
    })
  ]);

  const holdingsEndpoints: TinkDiagnosticsEndpoint[] = [];
  for (const accountId of selectedAccounts) {
    holdingsEndpoints.push(
      await fetchTinkEndpointDiagnostics({
        accessToken: input.accessToken,
        path: `/data/v2/investment-accounts/${encodeURIComponent(accountId)}/holdings`,
        countMode: "holdings"
      })
    );
  }

  return {
    token: {
      expiresAt: input.tokenExpiresAt,
      isExpired,
      scope: input.tokenScope
    },
    selectedAccounts,
    accountsEndpoint,
    investmentAccountsEndpoint,
    holdingsEndpoints
  };
}
