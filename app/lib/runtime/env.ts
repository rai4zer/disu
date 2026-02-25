import { existsSync } from "node:fs";

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
  required("SUPABASE_URL");
  required("SUPABASE_KEY");

  const quantBin = required("QUANT_PYTHON_BIN");
  const primerBin = required("PRIMER_PYTHON_BIN");

  for (const [name, bin] of [
    ["QUANT_PYTHON_BIN", quantBin],
    ["PRIMER_PYTHON_BIN", primerBin]
  ] as const) {
    if (!existsSync(bin)) {
      throw new Error(`${name} does not exist at path: ${bin}`);
    }
  }

  validated = true;
}
