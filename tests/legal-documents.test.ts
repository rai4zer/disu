import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { CONTROLLER, PENDING, pendingControllerFacts } from "../app/lib/legal/controller.ts";
import { STORAGE_ENTRIES, cookieNames, noticeIsSufficient } from "../app/lib/legal/cookies.ts";
import { THIRD_PARTIES, declaredHosts, partiesWithRole } from "../app/lib/legal/subprocessors.ts";
import { RETENTION_RULES } from "../app/lib/legal/retention.ts";
import { PRIVACY_DOCUMENT } from "../app/lib/legal/privacy-document.ts";
import { TERMS_DOCUMENT } from "../app/lib/legal/terms-document.ts";
import { COOKIE_DOCUMENT } from "../app/lib/legal/cookie-document.ts";
import type { Block, LegalDocument, Localised } from "../app/lib/legal/document.ts";

// Guards ROADMAP §2.2. Three of these tests exist because the *substance* of a
// legal document can rot silently: a clause gets softened, a translation goes
// missing, a promise about what we send to a language model stops being kept.
// The build should notice before a user does.

const DOCUMENTS: LegalDocument[] = [PRIVACY_DOCUMENT, TERMS_DOCUMENT, COOKIE_DOCUMENT];

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function collectLocalised(document: LegalDocument): Localised[] {
  const found: Localised[] = [document.title, document.summary];
  for (const section of document.sections) {
    found.push(section.heading);
    for (const block of section.blocks) {
      found.push(...localisedInBlock(block));
    }
  }
  return found;
}

/**
 * The prose only. Table cells are excluded from the untranslated-paste check
 * because many of them are proper nouns — a company name is legitimately
 * identical in both languages, and asserting otherwise would force a fake
 * translation of "Tink AB".
 */
function collectProse(document: LegalDocument): Localised[] {
  const found: Localised[] = [document.title, document.summary];
  for (const section of document.sections) {
    found.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "table") continue;
      found.push(...localisedInBlock(block));
    }
  }
  return found;
}

function localisedInBlock(block: Block): Localised[] {
  switch (block.kind) {
    case "p":
    case "callout":
      return [block.text];
    case "list":
      return block.items;
    case "table":
      return [...block.columns, ...block.rows.flat()];
    case "pending":
      return [block.label];
  }
}

function documentText(document: LegalDocument, language: "en" | "sv"): string {
  return collectLocalised(document)
    .map((entry) => entry[language])
    .join("\n")
    .toLowerCase();
}

test("every document is fully translated in both languages", () => {
  for (const document of DOCUMENTS) {
    for (const entry of collectLocalised(document)) {
      assert.ok(entry.en.trim().length > 0, `${document.slug}: empty English string`);
      assert.ok(entry.sv.trim().length > 0, `${document.slug}: empty Swedish string`);
    }
    for (const entry of collectProse(document)) {
      // A whole Swedish sentence identical to the English one is an
      // untranslated paste, not a coincidence.
      if (entry.en.split(/\s+/).length > 4) {
        assert.notStrictEqual(
          entry.sv,
          entry.en,
          `${document.slug}: Swedish text is identical to English — "${entry.en.slice(0, 60)}…"`
        );
      }
    }
  }
});

test("section anchors are unique and stable-looking", () => {
  for (const document of DOCUMENTS) {
    const ids = document.sections.map((section) => section.id);
    assert.deepStrictEqual(
      [...new Set(ids)],
      ids,
      `${document.slug}: duplicate section id — people link to these anchors`
    );
    for (const id of ids) {
      assert.match(id, /^[a-z][a-z0-9-]*$/, `${document.slug}: section id "${id}" is not a stable slug`);
    }
  }
});

// The two clauses the whole pre-M6 regulatory position rests on (ROADMAP §7.2).
// If either of these ever fails, do not "fix the test".
test("the terms state that DISU is not investment advice", () => {
  for (const language of ["en", "sv"] as const) {
    const text = documentText(TERMS_DOCUMENT, language);
    const needle = language === "en" ? "not investment advice" : "inte investeringsrådgivning";
    assert.ok(text.includes(needle), `terms (${language}) no longer say "${needle}"`);
  }
});

test("the terms state that DISU holds no money and executes no orders", () => {
  const english = documentText(TERMS_DOCUMENT, "en");
  assert.ok(english.includes("does not hold client money"), "terms no longer disclaim holding client money");
  assert.ok(english.includes("does not execute orders"), "terms no longer disclaim executing orders");

  const swedish = documentText(TERMS_DOCUMENT, "sv");
  assert.ok(swedish.includes("håller inte kundmedel"), "Swedish terms no longer disclaim holding client money");
  assert.ok(swedish.includes("utför inga order"), "Swedish terms no longer disclaim executing orders");
});

test("the privacy policy promises no holdings reach a language model", () => {
  const english = documentText(PRIVACY_DOCUMENT, "en");
  assert.ok(
    english.includes("never sent to a language model"),
    "the privacy policy no longer promises holdings are withheld from language models (ROADMAP §2.2)"
  );
});

// The promise above is only true because of what the primer bridge passes. If
// the argument list grows, the promise needs re-checking, not the test.
test("the primer bridge sends a ticker and nothing about the user", () => {
  const executor = readRepoFile("app/lib/primers/executor.ts");
  const argsLine = /const args = \[([^\]]*)\]/.exec(executor);
  assert.ok(argsLine, "could not find the primer subprocess argument list");
  const args = argsLine[1];
  for (const forbidden of ["userId", "user_id", "email", "positions", "holdings"]) {
    assert.ok(
      !args.includes(forbidden),
      `primer subprocess args now include "${forbidden}" — the privacy policy promises they do not`
    );
  }
});

test("every sub-processor and source is described in the privacy policy", () => {
  const english = documentText(PRIVACY_DOCUMENT, "en");
  for (const party of THIRD_PARTIES) {
    // The table cells are generated from the register, so the party's own name
    // is what should appear. This catches a party added to the register but
    // filtered out of both tables by an unhandled role.
    assert.ok(
      english.includes(party.name.toLowerCase()),
      `${party.name} is in the register but does not appear in the privacy policy`
    );
  }
  assert.strictEqual(
    partiesWithRole("processor").length + partiesWithRole("source").length,
    THIRD_PARTIES.length,
    "a third party has a role that neither table renders"
  );
});

test("processors and sources are not conflated", () => {
  for (const party of partiesWithRole("source")) {
    assert.ok(
      party.hosts.length > 0,
      `${party.name} is declared a data source but names no host, so nothing checks what it receives`
    );
  }
  // The distinction is load-bearing: a source is listed to users as receiving
  // no personal data. Anything holding personal data must be a processor.
  const supabase = THIRD_PARTIES.find((party) => party.name === "Supabase");
  assert.strictEqual(supabase?.role, "processor", "Supabase must be declared a processor");
});

test("every cookie the app sets is declared, with a category", () => {
  const declared = cookieNames();
  const sources = [
    "app/lib/auth/session.ts",
    "app/lib/auth/session-edge.ts",
    "app/lib/auth/google.ts",
    "app/lib/brokers/tink.ts",
    "app/api/brokers/tink/start/route.ts",
    "app/api/feature-requests/[requestId]/vote/route.ts"
  ];
  for (const source of sources) {
    for (const match of readRepoFile(source).matchAll(/const\s+[A-Z0-9_]*COOKIE[A-Z0-9_]*\s*=\s*"([^"]+)"/g)) {
      assert.ok(
        declared.has(match[1]),
        `cookie "${match[1]}" is set in ${source} but not declared in app/lib/legal/cookies.ts`
      );
    }
  }
});

// The tripwire from app/lib/legal/cookies.ts fired: analytics and advertising
// were added, so a notice is no longer lawful and the UI is a gate. The gate's
// own obligations — no pre-ticked boxes, symmetric reject, working withdrawal —
// are asserted in tests/consent.test.ts. What belongs here is that the
// *documents* stopped claiming otherwise.
test("the cookie document describes a choice, not an absence of one", () => {
  const english = documentText(COOKIE_DOCUMENT, "en");
  assert.ok(
    !noticeIsSufficient(),
    "the register no longer declares consent-requiring categories; revisit this document deliberately"
  );
  assert.ok(
    !english.includes("no consent wall") && !english.includes("nothing that needs your consent"),
    "the cookie page still claims there is nothing to consent to, which is now false"
  );
  for (const needle of ["off until you", "as many clicks", "cookie settings"]) {
    assert.ok(english.includes(needle), `the cookie page does not mention "${needle}"`);
  }
});

test("the privacy policy no longer claims we do not track", () => {
  const english = documentText(PRIVACY_DOCUMENT, "en");
  assert.ok(
    !english.includes("we do not run advertising"),
    "the privacy policy still says advertising is not used"
  );
  assert.ok(
    !english.includes("we do not track you across other websites"),
    "the privacy policy still denies cross-site tracking"
  );
  // Consent is now a real legal basis and has to be named as one.
  assert.ok(english.includes("art. 6(1)(a)"), "consent is not cited as a legal basis");
  assert.ok(english.includes("art. 7(3)"), "the right to withdraw is not cited");
});

test("the privacy policy still promises holdings never reach an ad platform", () => {
  const english = documentText(PRIVACY_DOCUMENT, "en");
  assert.ok(
    english.includes("they do not learn"),
    "the boundary between 'read about investing' and 'owns X' is no longer stated"
  );
  for (const needle of ["your holdings", "never"]) {
    assert.ok(english.includes(needle), `expected the policy to still say "${needle}"`);
  }
});

test("the retention section states a period for everything", () => {
  assert.ok(RETENTION_RULES.length > 0);
  for (const rule of RETENTION_RULES) {
    assert.ok(rule.period.en.trim().length > 0, `${rule.subject.en} has no stated retention period`);
    assert.ok(rule.mechanism.trim().length > 0, `${rule.subject.en} names nothing that enforces it`);
  }
});

test("the footer links to the real documents, not to placeholders", () => {
  const footer = readRepoFile("app/components/app-footer.tsx");
  for (const href of ["/legal/privacy", "/legal/terms", "/legal/cookies"]) {
    assert.ok(footer.includes(href), `the footer does not link to ${href}`);
  }
  assert.ok(
    !/Privacy \(coming soon\)|Integritet \(kommer snart\)/.test(footer),
    "the footer still advertises the privacy policy as coming soon"
  );
  assert.ok(
    !/Användarvillkor \(utkast\)|Terms \(draft\)/.test(footer),
    "the footer still describes the terms as a draft"
  );
});

test("the sign-up surface points at the terms and the privacy policy", () => {
  const form = readRepoFile("app/auth/login/login-form.tsx");
  assert.ok(form.includes("/legal/terms"), "the sign-up form does not link to the terms");
  assert.ok(form.includes("/legal/privacy"), "the sign-up form does not link to the privacy policy");
});

// Not a failure — the entity does not exist yet (ROADMAP §2.2). This test only
// pins the honest behaviour: a pending fact renders as a visible gap, and the
// production boot check refuses to serve the pages until it is filled in.
test("pending controller facts are surfaced, never invented", () => {
  const pending = pendingControllerFacts();
  for (const field of pending) {
    assert.strictEqual(
      (CONTROLLER as Record<string, unknown>)[field],
      PENDING,
      `${field} was reported pending but does not hold the sentinel`
    );
  }

  const privacyBlocks = PRIVACY_DOCUMENT.sections.flatMap((section) => section.blocks);
  if (pending.length > 0) {
    assert.ok(
      privacyBlocks.some((block) => block.kind === "pending"),
      "controller facts are pending but the policy renders no visible gap"
    );
  }

  const guard = readRepoFile("scripts/check-delivery-readiness.mjs");
  assert.ok(
    guard.includes("Legal documents are not ready for production"),
    "the production boot check no longer refuses a policy with no controller"
  );
});

test("the declared host set is non-trivial and lowercase", () => {
  const hosts = declaredHosts();
  assert.ok(hosts.size >= 10, "suspiciously few outbound hosts declared");
  for (const host of hosts) {
    assert.strictEqual(host, host.toLowerCase(), `host "${host}" is not lowercase; the guard compares literally`);
  }
});
