export type JobKind = "quant" | "primer";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobStage = "queued" | "fetching" | "running" | "done" | "failed";

export type QuantJobPayload = {
  ticker: string;
  retrain: boolean;
};

export type PrimerJobPayload = {
  ticker: string;
  llmProvider: "openai_compatible" | "none";
};

export type JobPayload = QuantJobPayload | PrimerJobPayload;

export type JobRow = {
  id: string;
  user_id: string;
  kind: JobKind;
  status: JobStatus;
  stage: JobStage;
  idempotency_key: string | null;
  payload: JobPayload;
  result: unknown;
  error: string | null;
  error_code: string | null;
  attempts: number;
  max_attempts: number;
  queued_ms: number | null;
  fetch_ms: number | null;
  run_ms: number | null;
  run_after: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobArtifactType =
  | "quant_model"
  | "quant_history_snapshot"
  | "quant_forecast_snapshot"
  | "primer_pdf"
  | "primer_text";

export type JobArtifactRow = {
  id: string;
  job_id: string;
  user_id: string;
  kind: JobKind;
  artifact_type: JobArtifactType;
  artifact_path: string;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
