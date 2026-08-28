import assert from "node:assert/strict";
import test from "node:test";
import { parsePrimerRunRequest, parseQuantInferRequest } from "../app/lib/jobs/request-schemas.ts";

test("parseQuantInferRequest normalizes ticker/retrain/idempotency", () => {
  const parsed = parseQuantInferRequest(
    {
      ticker: " aapl ",
      retrain: 1,
      idempotencyKey: "abc-123"
    },
    null
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.ticker, "AAPL");
  assert.equal(parsed.value.retrain, true);
  assert.equal(parsed.value.idempotencyKey, "abc-123");
});

test("parseQuantInferRequest rejects invalid ticker", () => {
  const parsed = parseQuantInferRequest({ ticker: "$$" }, null);
  assert.equal(parsed.ok, false);
});

test("parsePrimerRunRequest uses defaults and supports override policy", () => {
  const parsedDefault = parsePrimerRunRequest(
    { ticker: " msft " },
    null,
    { defaultLlmProvider: "none", allowProviderOverride: false }
  );
  assert.equal(parsedDefault.ok, true);
  if (!parsedDefault.ok) return;
  assert.equal(parsedDefault.value.ticker, "MSFT");
  assert.equal(parsedDefault.value.llmProvider, "none");

  const parsedOverride = parsePrimerRunRequest(
    { ticker: "MSFT", llmProvider: "openai_compatible" },
    null,
    { defaultLlmProvider: "none", allowProviderOverride: true }
  );
  assert.equal(parsedOverride.ok, true);
  if (!parsedOverride.ok) return;
  assert.equal(parsedOverride.value.llmProvider, "openai_compatible");
});

test("parsePrimerRunRequest rejects invalid provider when override enabled", () => {
  const parsed = parsePrimerRunRequest(
    { ticker: "MSFT", llmProvider: "foo" },
    null,
    { defaultLlmProvider: "openai_compatible", allowProviderOverride: true }
  );
  assert.equal(parsed.ok, false);
});

