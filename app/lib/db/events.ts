import { supabaseRequest } from "@/app/lib/db/supabase";

export type AuditAction =
  | "login"
  | "broker_connect"
  | "broker_sync"
  | "quant_run"
  | "primer_run"
  | "email_send";

export async function recordEvent(input: {
  userId: string;
  action: AuditAction;
  status: "success" | "failure";
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await supabaseRequest<unknown[]>("events", {
    method: "POST",
    body: [
      {
        user_id: input.userId,
        action: input.action,
        status: input.status,
        duration_ms: input.durationMs ?? null,
        metadata: input.metadata ?? {}
      }
    ]
  });
}
