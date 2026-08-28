import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRateLimit,
  consumeRateLimit,
  resetRateLimitsForTests,
  trackedRateLimitKeyCountForTests
} from "../app/lib/security/rate-limit.ts";
import { checkAuthRateLimit, clearAuthRateLimitForSubject } from "../app/lib/security/auth-rate-limit.ts";
import { clientIpFromHeaders } from "../app/lib/security/client-ip.ts";

const POLICY = { limit: 3, windowMs: 1000 };

function headers(bag: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => bag[name.toLowerCase()] ?? null };
}

test("allows up to the limit, then blocks", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;

  assert.deepEqual(consumeRateLimit("k", POLICY, now), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  assert.deepEqual(consumeRateLimit("k", POLICY, now), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(consumeRateLimit("k", POLICY, now), { allowed: true, remaining: 0, retryAfterSeconds: 0 });

  const blocked = consumeRateLimit("k", POLICY, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 1);
});

test("the window slides rather than resetting on a fixed boundary", () => {
  resetRateLimitsForTests();
  const start = 1_000_000;

  consumeRateLimit("k", POLICY, start);
  consumeRateLimit("k", POLICY, start + 400);
  consumeRateLimit("k", POLICY, start + 800);
  assert.equal(consumeRateLimit("k", POLICY, start + 900).allowed, false);

  // At start+1001 only the first hit has aged out, so exactly one slot frees up.
  assert.equal(consumeRateLimit("k", POLICY, start + 1001).allowed, true);
  assert.equal(consumeRateLimit("k", POLICY, start + 1001).allowed, false);
});

test("a blocked attempt does not extend its own penalty", () => {
  resetRateLimitsForTests();
  const start = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    consumeRateLimit("k", POLICY, start);
  }

  // Hammering during the block must not push the reset further out.
  for (let at = start + 100; at < start + 900; at += 100) {
    assert.equal(consumeRateLimit("k", POLICY, at).allowed, false);
  }
  assert.equal(consumeRateLimit("k", POLICY, start + 1001).allowed, true);
});

test("keys are independent and clearable", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    consumeRateLimit("a", POLICY, now);
  }
  assert.equal(consumeRateLimit("a", POLICY, now).allowed, false);
  assert.equal(consumeRateLimit("b", POLICY, now).allowed, true);

  clearRateLimit("a");
  assert.equal(consumeRateLimit("a", POLICY, now).allowed, true);
});

test("tracked keys stay bounded under key rotation", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  for (let i = 0; i < 60_000; i += 1) {
    consumeRateLimit(`rotating-${i}`, POLICY, now);
  }
  assert.ok(
    trackedRateLimitKeyCountForTests() <= 50_000,
    `expected eviction to cap the map, saw ${trackedRateLimitKeyCountForTests()}`
  );
});

test("login is limited per IP across different accounts", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  // Credential stuffing: one address, thirty different victims.
  for (let i = 0; i < 30; i += 1) {
    const verdict = checkAuthRateLimit({ route: "login", ip: "ip:1.2.3.4", email: `victim${i}@example.se`, now });
    assert.equal(verdict.allowed, true, `attempt ${i} should be allowed`);
  }

  const blocked = checkAuthRateLimit({ route: "login", ip: "ip:1.2.3.4", email: "victim99@example.se", now });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "ip");
  assert.ok(blocked.retryAfterSeconds > 0);

  // A different address is unaffected.
  assert.equal(checkAuthRateLimit({ route: "login", ip: "ip:5.6.7.8", email: "victim0@example.se", now }).allowed, true);
});

test("login is limited per email across different IPs", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  // Distributed spray: one victim, a fresh address every attempt.
  for (let i = 0; i < 10; i += 1) {
    const verdict = checkAuthRateLimit({ route: "login", ip: `ip:10.0.0.${i}`, email: "victim@example.se", now });
    assert.equal(verdict.allowed, true, `attempt ${i} should be allowed`);
  }

  const blocked = checkAuthRateLimit({ route: "login", ip: "ip:10.0.0.99", email: "victim@example.se", now });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "subject");

  // Another account from the same fresh address still works.
  assert.equal(
    checkAuthRateLimit({ route: "login", ip: "ip:10.0.0.99", email: "someone-else@example.se", now }).allowed,
    true
  );
});

test("email casing and padding cannot be used to mint fresh buckets", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  const spellings = ["victim@example.se", "  Victim@Example.SE  ", "VICTIM@EXAMPLE.SE"];
  for (let i = 0; i < 10; i += 1) {
    const email = spellings[i % spellings.length];
    assert.equal(checkAuthRateLimit({ route: "login", ip: `ip:10.0.0.${i}`, email, now }).allowed, true);
  }
  assert.equal(
    checkAuthRateLimit({ route: "login", ip: "ip:10.0.0.99", email: "victim@example.se", now }).allowed,
    false
  );
});

test("an exhausted IP bucket does not spend the subject bucket", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  // Burn the IP budget on unrelated accounts.
  for (let i = 0; i < 30; i += 1) {
    checkAuthRateLimit({ route: "login", ip: "ip:1.2.3.4", email: `noise${i}@example.se`, now });
  }
  // Now hammer one victim from that dead address. If these consumed the subject
  // bucket, the attacker could lock the victim out from an address that is
  // already blocked — for free.
  for (let i = 0; i < 50; i += 1) {
    assert.equal(checkAuthRateLimit({ route: "login", ip: "ip:1.2.3.4", email: "victim@example.se", now }).scope, "ip");
  }

  assert.equal(checkAuthRateLimit({ route: "login", ip: "ip:9.9.9.9", email: "victim@example.se", now }).allowed, true);
});

test("a successful login releases the account bucket", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  for (let i = 0; i < 9; i += 1) {
    checkAuthRateLimit({ route: "login", ip: `ip:10.0.0.${i}`, email: "user@example.se", now });
  }

  clearAuthRateLimitForSubject("login", "  User@Example.SE  ");

  for (let i = 0; i < 10; i += 1) {
    assert.equal(
      checkAuthRateLimit({ route: "login", ip: `ip:10.1.0.${i}`, email: "user@example.se", now }).allowed,
      true,
      `attempt ${i} should be allowed after a successful sign-in`
    );
  }
});

test("register and password-reset routes carry their own budgets", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;

  for (let i = 0; i < 10; i += 1) {
    assert.equal(checkAuthRateLimit({ route: "register", ip: "ip:1.1.1.1", email: `new${i}@example.se`, now }).allowed, true);
  }
  assert.equal(checkAuthRateLimit({ route: "register", ip: "ip:1.1.1.1", email: "new99@example.se", now }).allowed, false);

  // Spending the register budget must not throttle sign-in from the same address.
  assert.equal(checkAuthRateLimit({ route: "login", ip: "ip:1.1.1.1", email: "new0@example.se", now }).allowed, true);

  for (let i = 0; i < 15; i += 1) {
    assert.equal(
      checkAuthRateLimit({ route: "forgot-password", ip: "ip:2.2.2.2", email: `p${i}@example.se`, now }).allowed,
      true
    );
  }
  assert.equal(
    checkAuthRateLimit({ route: "forgot-password", ip: "ip:2.2.2.2", email: "p99@example.se", now }).allowed,
    false
  );

  for (let i = 0; i < 20; i += 1) {
    assert.equal(checkAuthRateLimit({ route: "reset-password", ip: "ip:3.3.3.3", now }).allowed, true);
  }
  assert.equal(checkAuthRateLimit({ route: "reset-password", ip: "ip:3.3.3.3", now }).allowed, false);
});

test("client ip prefers the left-most forwarded entry", () => {
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "ip:203.0.113.7");
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "  203.0.113.7  " })), "ip:203.0.113.7");
  assert.equal(clientIpFromHeaders(headers({ "x-real-ip": "203.0.113.9" })), "ip:203.0.113.9");
  assert.equal(clientIpFromHeaders(headers({})), "ip:unknown");
  // An empty header must not become its own bucket per request.
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "" })), "ip:unknown");
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": " , 10.0.0.1" })), "ip:unknown");
});

test("all callers without a forwarded header share one bucket", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;
  const ip = clientIpFromHeaders(headers({}));
  for (let i = 0; i < 30; i += 1) {
    assert.equal(checkAuthRateLimit({ route: "login", ip, email: `a${i}@example.se`, now }).allowed, true);
  }
  assert.equal(checkAuthRateLimit({ route: "login", ip, email: "a99@example.se", now }).allowed, false);
});
