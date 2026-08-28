import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordPolicyError,
  checkPasswordShape,
  passwordPolicyMessage
} from "../app/lib/auth/password-policy.ts";
import { breachCheckEnabled, pwnedPasswordCount } from "../app/lib/security/pwned-passwords.ts";
import { assertAcceptablePassword } from "../app/lib/auth/password-guard.ts";

const STRONG = "Tvillingberg47Kaffe";

function rejection(password: string, email?: string): string {
  const verdict = checkPasswordShape(password, { email });
  assert.equal(verdict.ok, false, `expected ${JSON.stringify(password)} to be rejected`);
  return verdict.ok ? "" : verdict.code;
}

test("the case the roadmap named is rejected, in every disguise", () => {
  // Nine characters: the old floor let it through at eight.
  assert.equal(rejection("password1"), "password_too_short");
  // Long enough for the new floor, still the same password.
  assert.equal(rejection("password12"), "password_common");
  assert.equal(rejection("Password123!"), "password_common");
  assert.equal(rejection("password2024"), "password_common");
  assert.equal(rejection("P@ssw0rd!!"), "password_common");
  assert.equal(rejection("Passw0rd2024"), "password_common");
});

test("common base words are caught with and without decoration", () => {
  for (const password of [
    "letmein2024",
    "sunshine123",
    "iloveyou22",
    "l0senord2024",
    "Stockholm123",
    "disuplatform",
    "aktier123456",
    "welcome!2024"
  ]) {
    assert.equal(rejection(password), "password_common", password);
  }
});

test("length floor and ceiling", () => {
  assert.equal(rejection("Vind7kra!"), "password_too_short");
  const atTheFloor = "Vind7kraf!";
  assert.equal(atTheFloor.length, PASSWORD_MIN_LENGTH);
  assert.equal(checkPasswordShape(atTheFloor).ok, true);
  assert.equal(rejection(`${STRONG}${"x".repeat(PASSWORD_MAX_LENGTH)}`), "password_too_long");
});

test("structural rejects: repetition, runs, all digits", () => {
  assert.equal(rejection("abababababab"), "password_repetitive");
  assert.equal(rejection("aaaaaaaaaaaa"), "password_repetitive");
  assert.equal(rejection("1234567890"), "password_sequential");
  assert.equal(rejection("qwertyuiop"), "password_sequential");
  assert.equal(rejection("0987654321"), "password_sequential");
  // A birth date, a personal number, a phone number.
  assert.equal(rejection("1990061512"), "password_numeric");
  // Digits stay allowed once the string is long enough to mean something.
  assert.equal(checkPasswordShape("83920174650283").ok, true);
});

test("a password built out of the user's own email is rejected", () => {
  assert.equal(rejection("annalindberg88", "anna.lindberg@example.com"), "password_personal");
  assert.equal(rejection("Lindberg-2026", "anna.lindberg@example.com"), "password_personal");
  // Short local parts are ignored: matching on three letters would reject far
  // too much that is fine.
  assert.equal(checkPasswordShape("Tvillingberg47Kaffe", { email: "ab@example.com" }).ok, true);
});

test("passphrases and mixed strings pass", () => {
  for (const password of [
    STRONG,
    "korrekt-hast-batteri-klammer",
    "vinylskiva & jordgubbstarta 91",
    "Qz7#mprLevande"
  ]) {
    assert.equal(checkPasswordShape(password, { email: "user@example.com" }).ok, true, password);
  }
});

test("rejection copy exists in both languages and differs", () => {
  const code = rejection("password12");
  const en = passwordPolicyMessage(code as never, "en");
  const sv = passwordPolicyMessage(code as never, "sv");
  assert.ok(en.length > 0 && sv.length > 0);
  assert.notEqual(en, sv);
});

function rangeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as unknown as Response;
}

function suffixOf(password: string): { prefix: string; suffix: string } {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

test("the breach lookup sends only a five-character hash prefix", async () => {
  const { prefix, suffix } = suffixOf(STRONG);
  const seen: string[] = [];

  const result = await pwnedPasswordCount(STRONG, {
    fetchImpl: (async (url: string) => {
      seen.push(String(url));
      return rangeResponse(`${suffix}:42\r\n0000000000000000000000000000000000000:9\r\n`);
    }) as unknown as typeof fetch
  });

  assert.deepEqual(result, { checked: true, breached: true, count: 42 });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith(`/${prefix}`), seen[0]);
  // The plaintext and the full hash both stay in-process.
  assert.ok(!seen[0].includes(STRONG));
  assert.ok(!seen[0].includes(suffix));
});

test("a password absent from the corpus is allowed", async () => {
  const result = await pwnedPasswordCount(STRONG, {
    fetchImpl: (async () => rangeResponse("ABC0000000000000000000000000000000001:5\r\n")) as unknown as typeof fetch
  });
  assert.deepEqual(result, { checked: true, breached: false, count: 0 });
});

test("padding decoys (count 0) are not treated as breaches", async () => {
  const { suffix } = suffixOf(STRONG);
  const result = await pwnedPasswordCount(STRONG, {
    fetchImpl: (async () => rangeResponse(`${suffix}:0\r\n`)) as unknown as typeof fetch
  });
  assert.deepEqual(result, { checked: true, breached: false, count: 0 });
});

test("the lookup fails open — an outage must not block sign-up", async () => {
  const onError = await pwnedPasswordCount(STRONG, {
    fetchImpl: (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch
  });
  assert.deepEqual(onError, { checked: false, breached: false, count: 0 });

  const onHttpFailure = await pwnedPasswordCount(STRONG, {
    fetchImpl: (async () => rangeResponse("upstream down", 503)) as unknown as typeof fetch
  });
  assert.deepEqual(onHttpFailure, { checked: false, breached: false, count: 0 });
});

test("the network check is off under NODE_ENV=test", () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(breachCheckEnabled(), false);
});

test("the server guard throws a coded error, and accepts a strong password", async () => {
  await assert.rejects(
    () => assertAcceptablePassword("password12", { email: "user@example.com", context: "register" }),
    (error: unknown) => {
      assert.ok(error instanceof PasswordPolicyError);
      assert.equal(error.code, "password_common");
      return true;
    }
  );

  // Passes: the breach half is disabled in tests, so this exercises the guard
  // wiring without a network call.
  await assertAcceptablePassword(STRONG, { email: "user@example.com", context: "register" });
});
