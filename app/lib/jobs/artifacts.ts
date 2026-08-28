import { createHash } from "node:crypto";
import type { JobKind } from "@/app/lib/jobs/types";

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

export function deriveArtifactsFromResult(input: {
  jobId: string;
  userId: string;
  kind: JobKind;
  result: unknown;
}): Array<{
  jobId: string;
  userId: string;
  kind: JobKind;
  artifactType: "quant_model" | "quant_history_snapshot" | "quant_forecast_snapshot" | "primer_pdf" | "primer_text";
  artifactPath: string;
  contentHash?: string | null;
  metadata?: Record<string, unknown>;
}> {
  const resultObj = asRecord(input.result);

  if (input.kind === "quant") {
    const rows = Array.isArray(resultObj.rows) ? resultObj.rows : [];
    const history = Array.isArray(resultObj.history) ? resultObj.history : [];
    const firstRow = asRecord(rows[0]);
    const modelPath = typeof firstRow.model_path === "string" ? firstRow.model_path : "unknown";
    const ticker = typeof resultObj.ticker === "string" ? resultObj.ticker : String(firstRow.ticker ?? "UNKNOWN");
    const meta = asRecord(resultObj.meta);
    const modelVersion = typeof meta.modelVersion === "string" ? meta.modelVersion : "unknown";
    const bridgeVersion = typeof meta.bridgeVersion === "string" ? meta.bridgeVersion : "unknown";

    return [
      {
        jobId: input.jobId,
        userId: input.userId,
        kind: input.kind,
        artifactType: "quant_model",
        artifactPath: modelPath,
        contentHash: hashValue(`model:${modelPath}`),
        metadata: { ticker, modelVersion, bridgeVersion }
      },
      {
        jobId: input.jobId,
        userId: input.userId,
        kind: input.kind,
        artifactType: "quant_forecast_snapshot",
        artifactPath: `job://${input.jobId}/quant/forecast`,
        contentHash: hashValue(JSON.stringify(rows).slice(0, 16000)),
        metadata: { ticker, rowCount: rows.length, modelVersion, bridgeVersion }
      },
      {
        jobId: input.jobId,
        userId: input.userId,
        kind: input.kind,
        artifactType: "quant_history_snapshot",
        artifactPath: `job://${input.jobId}/quant/history`,
        contentHash: hashValue(JSON.stringify(history).slice(0, 16000)),
        metadata: { ticker, pointCount: history.length, modelVersion, bridgeVersion }
      }
    ];
  }

  const ticker = typeof resultObj.ticker === "string" ? resultObj.ticker : "UNKNOWN";
  const meta = asRecord(resultObj.meta);
  const pipelineVersion = typeof meta.pipelineVersion === "string" ? meta.pipelineVersion : "unknown";
  const llmProvider = typeof meta.llmProvider === "string" ? meta.llmProvider : "unknown";
  const llmModel = typeof meta.llmModel === "string" ? meta.llmModel : "unknown";
  const pdfPath = typeof resultObj.pdf_path === "string" ? resultObj.pdf_path : "";
  const primerText = typeof resultObj.primer_text === "string" ? resultObj.primer_text : "";
  const artifacts: Array<{
    jobId: string;
    userId: string;
    kind: JobKind;
    artifactType: "quant_model" | "quant_history_snapshot" | "quant_forecast_snapshot" | "primer_pdf" | "primer_text";
    artifactPath: string;
    contentHash?: string | null;
    metadata?: Record<string, unknown>;
  }> = [];

  if (pdfPath) {
    artifacts.push({
      jobId: input.jobId,
      userId: input.userId,
      kind: input.kind,
      artifactType: "primer_pdf",
      artifactPath: pdfPath,
      contentHash: hashValue(`pdf:${pdfPath}`),
      metadata: { ticker, form: resultObj.form ?? null, filingDate: resultObj.filing_date ?? null, pipelineVersion, llmProvider, llmModel }
    });
  }

  artifacts.push({
    jobId: input.jobId,
    userId: input.userId,
    kind: input.kind,
    artifactType: "primer_text",
    artifactPath: `job://${input.jobId}/primer/text`,
    contentHash: hashValue(primerText.slice(0, 20000)),
    metadata: { ticker, textLength: primerText.length, pipelineVersion, llmProvider, llmModel }
  });

  return artifacts;
}
