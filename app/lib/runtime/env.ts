import { accessSync, constants } from "node:fs";

let validated = false;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function ensureRuntimeEnv(): void {
  if (validated) {
    return;
  }

  required("DISU_SESSION_SECRET");
  required("BROKER_TOKEN_ENCRYPTION_KEY");
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_KEY?.trim();
  if (!supabaseServiceRoleKey) {
    throw new Error("Missing required env var: SUPABASE_SERVICE_ROLE_KEY");
  }
  try {
    const parsed = new URL(supabaseUrl);
    if (!parsed.protocol.startsWith("http")) {
      throw new Error("SUPABASE_URL must be http(s).");
    }
  } catch {
    throw new Error("SUPABASE_URL must be a valid absolute URL.");
  }

  const quantBin = required("QUANT_PYTHON_BIN");
  const primerBin = required("PRIMER_PYTHON_BIN");

  for (const [name, bin] of [
    ["QUANT_PYTHON_BIN", quantBin],
    ["PRIMER_PYTHON_BIN", primerBin]
  ] as const) {
    try {
      accessSync(bin, constants.F_OK);
    } catch {
      throw new Error(`${name} does not exist at path: ${bin}`);
    }
    if (process.platform !== "win32") {
      try {
        accessSync(bin, constants.X_OK);
      } catch {
        throw new Error(`${name} is not executable at path: ${bin}`);
      }
    }
  }

  validated = true;
}

export function resetRuntimeEnvValidationForTests(): void {
  if (process.env.NODE_ENV === "test") {
    validated = false;
  }
}
