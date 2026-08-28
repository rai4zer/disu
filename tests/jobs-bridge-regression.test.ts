import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeQuantJob } from "../app/lib/quant/executor.ts";
import { executePrimerJob } from "../app/lib/primers/executor.ts";

async function readFixture<T>(name: string): Promise<T> {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", name);
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw) as T;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeQuantForSnapshot(
  value: Awaited<ReturnType<typeof executeQuantJob>>
): Record<string, unknown> {
  if (!value.ok) {
    return value;
  }
  return {
    ok: true,
    ticker: value.ticker,
    rows: value.rows.map((row) => ({
      ...row,
      date: "<date>"
    })),
    history: value.history.map((point) => ({
      ...point,
      date: "<date>"
    })),
    reports: value.reports.map((report) => ({
      ...report,
      filedAt: "<date>"
    })),
    meta: value.meta
  };
}

function normalizePrimerForSnapshot(
  value: Awaited<ReturnType<typeof executePrimerJob>>
): Record<string, unknown> {
  if (!value.ok) {
    return value;
  }
  const cwd = process.cwd();
  return {
    ...value,
    pdf_abspath: value.pdf_abspath ? value.pdf_abspath.replace(cwd, "<cwd>") : value.pdf_abspath,
    cache_dir: value.cache_dir.replace(cwd, "<cwd>")
  };
}

test("quant mock regression fixture stays stable on shape and core metadata", async () => {
  const fixture = await readFixture<{
    ticker: string;
    horizons: number[];
    historyMinPoints: number;
    historyMaxPoints: number;
    fallbackMode: "offline";
    bridgeVersionPrefix: string;
    modelVersionPrefix: string;
    canonicalSha256: string;
  }>("quant_mock_snapshot.json");

  const prevMode = process.env.QUANT_MOCK_FALLBACK_MODE;
  const prevModelVersion = process.env.QUANT_MODEL_VERSION;
  process.env.QUANT_MOCK_FALLBACK_MODE = "always";
  process.env.QUANT_MODEL_VERSION = "quant-v1";
  try {
    const result = await executeQuantJob({
      ticker: fixture.ticker,
      retrain: false
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.ticker, fixture.ticker);
    assert.deepEqual(
      result.rows.map((row) => row.horizon),
      fixture.horizons
    );
    assert.ok(result.history.length >= fixture.historyMinPoints);
    assert.ok(result.history.length <= fixture.historyMaxPoints);
    assert.equal(result.meta?.fallbackMode, fixture.fallbackMode);
    assert.ok((result.meta?.bridgeVersion ?? "").startsWith(fixture.bridgeVersionPrefix));
    assert.ok((result.meta?.modelVersion ?? "").startsWith(fixture.modelVersionPrefix));
    assert.equal(stableHash(normalizeQuantForSnapshot(result)), fixture.canonicalSha256);
  } finally {
    if (prevMode === undefined) delete process.env.QUANT_MOCK_FALLBACK_MODE;
    else process.env.QUANT_MOCK_FALLBACK_MODE = prevMode;
    if (prevModelVersion === undefined) delete process.env.QUANT_MODEL_VERSION;
    else process.env.QUANT_MODEL_VERSION = prevModelVersion;
  }
});

test("primer mock regression fixture stays stable on content sections and metadata", async () => {
  const fixture = await readFixture<{
    ticker: string;
    requiredSections: string[];
    fallbackMode: "offline";
    pipelineVersionPrefix: string;
    allowedProviders: Array<"openai_compatible" | "none">;
    canonicalSha256: string;
  }>("primer_mock_snapshot.json");

  const prevMode = process.env.PRIMER_MOCK_FALLBACK_MODE;
  const prevPipelineVersion = process.env.PRIMER_PIPELINE_VERSION;
  const prevModel = process.env.PRIMER_LLM_MODEL;
  process.env.PRIMER_MOCK_FALLBACK_MODE = "always";
  process.env.PRIMER_PIPELINE_VERSION = "primer-v1";
  process.env.PRIMER_LLM_MODEL = "default";
  try {
    const result = await executePrimerJob({
      ticker: fixture.ticker,
      llmProvider: "openai_compatible"
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.ticker, fixture.ticker);
    for (const section of fixture.requiredSections) {
      assert.ok(result.primer_text.includes(section));
    }
    assert.equal(result.meta?.fallbackMode, fixture.fallbackMode);
    assert.ok((result.meta?.pipelineVersion ?? "").startsWith(fixture.pipelineVersionPrefix));
    assert.ok(fixture.allowedProviders.includes(result.meta?.llmProvider ?? "none"));
    assert.equal(stableHash(normalizePrimerForSnapshot(result)), fixture.canonicalSha256);
  } finally {
    if (prevMode === undefined) delete process.env.PRIMER_MOCK_FALLBACK_MODE;
    else process.env.PRIMER_MOCK_FALLBACK_MODE = prevMode;
    if (prevPipelineVersion === undefined) delete process.env.PRIMER_PIPELINE_VERSION;
    else process.env.PRIMER_PIPELINE_VERSION = prevPipelineVersion;
    if (prevModel === undefined) delete process.env.PRIMER_LLM_MODEL;
    else process.env.PRIMER_LLM_MODEL = prevModel;
  }
});
