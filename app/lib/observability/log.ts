type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const ERROR_WEBHOOK_URL = (process.env.ERROR_REPORT_WEBHOOK_URL ?? "").trim();

async function sendErrorReport(event: string, fields?: LogFields) {
  if (!ERROR_WEBHOOK_URL || typeof window !== "undefined") {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(ERROR_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        service: "disu-app",
        event,
        ...(fields ?? {})
      }),
      signal: controller.signal
    });
  } catch {
    // Best-effort delivery: never fail request flow due to reporting sink issues.
  } finally {
    clearTimeout(timeout);
  }
}

function write(level: LogLevel, event: string, fields?: LogFields) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ?? {})
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    void sendErrorReport(event, fields);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const log = {
  info(event: string, fields?: LogFields) {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields) {
    write("error", event, fields);
  }
};
