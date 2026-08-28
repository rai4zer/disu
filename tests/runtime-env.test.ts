import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureRuntimeEnv, resetRuntimeEnvValidationForTests } from "../app/lib/runtime/env.ts";

const ORIGINAL_ENV = { ...process.env };

function setBaseEnv() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DISU_SESSION_SECRET: "secret",
    BROKER_TOKEN_ENCRYPTION_KEY: "test-test-test-test-test-test-test-test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_KEY: "service-key",
    QUANT_PYTHON_BIN: process.execPath,
    PRIMER_PYTHON_BIN: process.execPath
  });
}

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
  resetRuntimeEnvValidationForTests();
});

test("ensureRuntimeEnv accepts valid runtime configuration", () => {
  setBaseEnv();
  resetRuntimeEnvValidationForTests();
  assert.doesNotThrow(() => ensureRuntimeEnv());
});

test("ensureRuntimeEnv rejects invalid SUPABASE_URL", () => {
  setBaseEnv();
  process.env.SUPABASE_URL = "not-a-url";
  resetRuntimeEnvValidationForTests();
  assert.throws(() => ensureRuntimeEnv(), /SUPABASE_URL must be a valid absolute URL/);
});

test("ensureRuntimeEnv rejects non-executable python bin on POSIX", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "disu-env-test-"));
  const fakeBin = path.join(dir, "python");
  await writeFile(fakeBin, "#!/bin/sh\necho test\n", "utf8");
  await chmod(fakeBin, 0o644);

  setBaseEnv();
  process.env.QUANT_PYTHON_BIN = fakeBin;
  resetRuntimeEnvValidationForTests();

  assert.throws(() => ensureRuntimeEnv(), /QUANT_PYTHON_BIN is not executable/);

  await rm(dir, { recursive: true, force: true });
});
