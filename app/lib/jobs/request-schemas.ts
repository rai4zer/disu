export type QuantInferRequestSchema = {
  ticker: string;
  retrain: boolean;
  idempotencyKey: string;
};

export type PrimerRunRequestSchema = {
  ticker: string;
  llmProvider: "openai_compatible" | "none";
  idempotencyKey: string;
};

function normalizeTicker(input: unknown): string {
  return typeof input === "string" ? input.trim().toUpperCase() : "";
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker);
}

function normalizeIdempotencyKey(bodyValue: unknown, headerValue: string | null): string {
  const raw = typeof bodyValue === "string" ? bodyValue : headerValue ?? "";
  return String(raw).trim().slice(0, 128);
}

function parseLlmProvider(input: unknown): "openai_compatible" | "none" | null {
  if (input === "openai_compatible" || input === "none") {
    return input;
  }
  if (typeof input === "string" && input.trim()) {
    return null;
  }
  return null;
}

export function parseQuantInferRequest(
  body: unknown,
  headerIdempotencyKey: string | null
): { ok: true; value: QuantInferRequestSchema } | { ok: false; error: string } {
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const ticker = normalizeTicker(input.ticker);
  if (!ticker || !isValidTicker(ticker)) {
    return {
      ok: false,
      error: "Invalid ticker. Use 1-12 chars: letters, numbers, dot, hyphen."
    };
  }

  return {
    ok: true,
    value: {
      ticker,
      retrain: Boolean(input.retrain),
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey, headerIdempotencyKey)
    }
  };
}

export function parsePrimerRunRequest(
  body: unknown,
  headerIdempotencyKey: string | null,
  defaults: {
    defaultLlmProvider: "openai_compatible" | "none";
    allowProviderOverride: boolean;
  }
): { ok: true; value: PrimerRunRequestSchema } | { ok: false; error: string } {
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const ticker = normalizeTicker(input.ticker);
  if (!ticker || !isValidTicker(ticker)) {
    return {
      ok: false,
      error: "Invalid ticker. Use 1-12 chars: letters, numbers, dot, hyphen."
    };
  }

  let llmProvider: "openai_compatible" | "none" = defaults.defaultLlmProvider;
  if (defaults.allowProviderOverride && input.llmProvider !== undefined) {
    const parsed = parseLlmProvider(input.llmProvider);
    if (!parsed) {
      return {
        ok: false,
        error: "Invalid llmProvider. Use 'openai_compatible' or 'none'."
      };
    }
    llmProvider = parsed;
  }

  return {
    ok: true,
    value: {
      ticker,
      llmProvider,
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey, headerIdempotencyKey)
    }
  };
}

