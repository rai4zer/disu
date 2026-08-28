import { userScoped } from "@/app/lib/db/user-scope";

export type AuditAction =
  | "login"
  | "broker_connect"
  | "broker_sync"
  | "broker_disconnect"
  | "quant_run"
  | "primer_run"
  | "email_send"
  | "feature_request_submit"
  | "feature_request_comment"
  | "feature_request_vote"
  | "feature_request_status_update"
  | "release_note_create"
  | "release_note_edit"
  | "release_note_publish"
  | "account_export"
  | "account_delete"
  | "account_password_set"
  | "account_google_link"
  | "account_google_unlink";

export async function recordEvent(input: {
  userId: string;
  action: AuditAction;
  status: "success" | "failure";
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await userScoped<unknown[]>(input.userId, "events", {
    method: "POST",
    body: [
      {
        action: input.action,
        status: input.status,
        duration_ms: input.durationMs ?? null,
        metadata: input.metadata ?? {}
      }
    ]
  });
}
