import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CONSENT_MAX_AGE_DAYS,
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  OPTIONAL_CATEGORIES,
  acceptAll,
  hasConsent,
  isFullyRejected,
  makeRecord,
  parseConsent,
  rejectAll,
  serialiseConsent
} from "../app/lib/legal/consent.ts";
import { STORAGE_ENTRIES, consentRequiringEntries, noticeIsSufficient } from "../app/lib/legal/cookies.ts";
import { TAGS, categoriesInUse, tagId } from "../app/lib/legal/tags.ts";

// Guards the consent gate. Every assertion here corresponds to a rule that, if
// broken, means the consent being collected is not legally consent at all — so
// the fix is always the code, never the test.

function readRepoFile(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

const BANNER = readRepoFile("app/components/consent-banner.tsx");
const BANNER_CSS = readRepoFile("app/components/consent-banner.module.css");
const TAG_LOADER = readRepoFile("app/components/consent-tags.tsx");

test("nothing optional is on before a choice is made", () => {
  assert.strictEqual(DEFAULT_CONSENT.necessary, true, "necessary cookies are exempt, not consented");
  for (const category of OPTIONAL_CATEGORIES) {
    assert.strictEqual(
      DEFAULT_CONSENT[category],
      false,
      `${category} defaults to true — that is a pre-ticked box (GDPR Art. 4(11))`
    );
  }
});

test("no record means no consent, for every optional category", () => {
  for (const category of OPTIONAL_CATEGORIES) {
    assert.strictEqual(hasConsent(null, category), false, `${category} is allowed with no decision recorded`);
  }
  assert.strictEqual(hasConsent(null, "necessary"), true);
});

test("rejecting denies everything optional and is not a partial yes", () => {
  const rejected = rejectAll();
  assert.ok(isFullyRejected(rejected));
  for (const category of OPTIONAL_CATEGORIES) {
    assert.strictEqual(rejected[category], false);
  }
});

test("a stored decision round-trips", () => {
  const record = makeRecord({ ...acceptAll(), marketing: false }, "2026-08-27T10:00:00.000Z");
  const parsed = parseConsent(serialiseConsent(record), Date.parse("2026-08-27T10:00:01.000Z"));
  assert.ok(parsed);
  assert.strictEqual(parsed.choices.analytics, true);
  assert.strictEqual(parsed.choices.marketing, false);
  assert.strictEqual(parsed.decidedAt, "2026-08-27T10:00:00.000Z");
});

test("necessary is forced true even if a caller passes false", () => {
  const record = makeRecord({ ...rejectAll(), necessary: false }, "2026-08-27T10:00:00.000Z");
  assert.strictEqual(record.choices.necessary, true, "storing necessary=false misrepresents it as a choice");
});

// Every one of these must fail closed. A record we cannot fully trust is a
// record that grants nothing — the alternative is tracking someone on the
// strength of a corrupted cookie.
test("an untrustworthy record grants nothing", () => {
  const now = Date.parse("2026-08-27T10:00:00.000Z");

  assert.strictEqual(parseConsent(undefined, now), null, "absent cookie");
  assert.strictEqual(parseConsent("", now), null, "empty cookie");
  assert.strictEqual(parseConsent("not-json", now), null, "unparseable cookie");
  assert.strictEqual(parseConsent(encodeURIComponent("[]"), now), null, "array instead of object");
  assert.strictEqual(
    parseConsent(encodeURIComponent(JSON.stringify({ version: CONSENT_VERSION })), now),
    null,
    "no timestamp"
  );
  assert.strictEqual(
    parseConsent(
      encodeURIComponent(
        JSON.stringify({ version: CONSENT_VERSION, decidedAt: "2026-08-27T10:00:00.000Z", choices: "yes" })
      ),
      now
    ),
    null,
    "choices is not an object"
  );
});

test("consent from an older set of purposes is not reused", () => {
  const stale = encodeURIComponent(
    JSON.stringify({
      version: CONSENT_VERSION - 1,
      decidedAt: "2026-08-27T10:00:00.000Z",
      choices: { analytics: true, marketing: true }
    })
  );
  assert.strictEqual(
    parseConsent(stale, Date.parse("2026-08-27T10:00:01.000Z")),
    null,
    "consent given for different purposes was carried over — bump CONSENT_VERSION to re-ask, not to grandfather"
  );
});

test("consent expires rather than binding someone forever", () => {
  const record = makeRecord(acceptAll(), "2026-01-01T00:00:00.000Z");
  const serialised = serialiseConsent(record);

  const withinWindow = Date.parse("2026-01-01T00:00:00.000Z") + (CONSENT_MAX_AGE_DAYS - 1) * 86400000;
  assert.ok(parseConsent(serialised, withinWindow), "a fresh decision should still stand");

  const pastWindow = Date.parse("2026-01-01T00:00:00.000Z") + (CONSENT_MAX_AGE_DAYS + 1) * 86400000;
  assert.strictEqual(parseConsent(serialised, pastWindow), null, "an expired decision must be re-asked, not assumed");
});

test("a truthy-but-not-true value is not an affirmative act", () => {
  for (const sneaky of [1, "true", "yes", {}]) {
    const raw = encodeURIComponent(
      JSON.stringify({
        version: CONSENT_VERSION,
        decidedAt: "2026-08-27T10:00:00.000Z",
        choices: { analytics: sneaky }
      })
    );
    const parsed = parseConsent(raw, Date.parse("2026-08-27T10:00:01.000Z"));
    assert.strictEqual(
      parsed?.choices.analytics,
      false,
      `${JSON.stringify(sneaky)} was treated as consent`
    );
  }
});

// --- The gate, as shipped ------------------------------------------------

test("a gate is required, and a notice would no longer be lawful", () => {
  assert.strictEqual(
    noticeIsSufficient(),
    false,
    "analytics/marketing entries were removed from the register — if the tracking is genuinely gone, " +
      "this test and the banner should both be revisited deliberately"
  );
  assert.ok(consentRequiringEntries().length > 0);
});

test("refusing is exactly as easy as accepting", () => {
  assert.match(BANNER, /onClick=\{\s*acceptEverything\s*\}/, "no top-level accept");
  assert.match(BANNER, /onClick=\{\s*rejectEverything\s*\}/, "no top-level reject");

  // Both answers must be rendered by the same class. A second, louder class on
  // one of them is the dark pattern regulators actually penalise.
  const choiceButtons = [...BANNER.matchAll(/className=\{styles\.choice\}/g)];
  assert.ok(choiceButtons.length >= 2, "accept and reject are not both styled as .choice");
  assert.ok(
    !/className=\{`\$\{styles\.choice\}[^`]*\$\{styles\.(primary|accent|strong|prominent)\}/.test(BANNER),
    "one of the two answers has been given extra prominence"
  );

  // And the shared class must distribute width evenly rather than letting one
  // button dominate.
  assert.match(BANNER_CSS, /\.choice\s*\{[^}]*flex:\s*1 1 0/, ".choice no longer sizes both answers equally");
});

// Informed consent needs a reachable route to the detail. The banner is a
// single row now and carries only "Choose", so the preference centre it opens
// is what must link onward to the full list — if that link goes, the gate
// collects a yes with no way to have found out what it covered.
test("the gate offers a route to the full cookie list", () => {
  assert.ok(
    BANNER.includes("/legal/cookies"),
    "neither the banner nor the preference centre links to the full cookie list"
  );
  assert.match(BANNER, /onClick=\{\s*openPreferences\s*\}/, "the banner has no per-category route");
});

test("the banner does not block the page", () => {
  const bannerBlock = /\.banner\s*\{([^}]*)\}/.exec(BANNER_CSS);
  assert.ok(bannerBlock, "could not find the .banner rule");
  assert.ok(!/inset:\s*0/.test(bannerBlock[1]), "the first-visit banner must not cover the viewport");
  // The preference centre is allowed to be a dialog — the visitor opened it on
  // purpose. The first-visit banner is not.
  const bannerJsx = BANNER.slice(BANNER.indexOf("<aside"), BANNER.indexOf("</aside>"));
  assert.ok(!/aria-modal/.test(bannerJsx), "the first-visit banner must not be modal");
});

test("withdrawal is reachable from every page", () => {
  const footer = readRepoFile("app/components/app-footer.tsx");
  assert.match(footer, /onClick=\{\s*openPreferences\s*\}/, "the footer has no consent-settings control");
});

test("no tag loads without both consent and configuration", () => {
  assert.match(TAG_LOADER, /allows\(tag\.category\)/, "the tag loader does not check consent");
  assert.match(TAG_LOADER, /tagId\(tag, TAG_IDS\) !== null/, "the tag loader does not check configuration");
  // Nothing may render before the cookie has actually been read.
  assert.match(TAG_LOADER, /if \(!ready \|\| active\.length === 0\)/, "the tag loader can render before consent is known");
});

test("every declared tag can actually be configured", () => {
  // process.env.NEXT_PUBLIC_* is inlined at build time, so a tag whose env var
  // is missing from TAG_IDS would silently never load — and would silently never
  // be gated either, which is the worse half.
  for (const tag of TAGS) {
    assert.ok(
      TAG_LOADER.includes(`${tag.envVar}: process.env.${tag.envVar}`),
      `${tag.vendor}: ${tag.envVar} is not read in consent-tags.tsx TAG_IDS`
    );
  }
});

test("a blank id is a hard off switch", () => {
  for (const tag of TAGS) {
    assert.strictEqual(tagId(tag, {}), null, `${tag.vendor} loads with no id configured`);
    assert.strictEqual(tagId(tag, { [tag.envVar]: "   " }), null, `${tag.vendor} loads on a whitespace id`);
    assert.strictEqual(tagId(tag, { [tag.envVar]: "abc" }), "abc");
  }
});

test("every tag belongs to a category the user is asked about", () => {
  for (const category of categoriesInUse()) {
    assert.ok(
      OPTIONAL_CATEGORIES.includes(category as (typeof OPTIONAL_CATEGORIES)[number]),
      `tags are declared under "${category}", which the visitor is never asked about`
    );
  }
});

test("every cookie a tag drops is disclosed in the cookie table", () => {
  const disclosed = STORAGE_ENTRIES.map((entry) => entry.name).join(" ");
  for (const tag of TAGS) {
    for (const cookie of tag.cookies) {
      const needle = cookie.prefix ? `${cookie.name}*` : cookie.name;
      assert.ok(
        disclosed.includes(needle) || disclosed.includes(cookie.name),
        `${tag.vendor} sets ${cookie.name}, which is not listed in app/lib/legal/cookies.ts`
      );
    }
  }
});

// Regression. The clearing used to run inside a setState updater, which React
// is free to call late or twice — so the deletion raced the reload that
// ConsentTags fires on revocation, and `_ga_<id>` survived a "Reject all".
// Verified by hand against a live GA4 tag before and after the fix.
test("cookie clearing happens synchronously, not inside a setState updater", () => {
  const provider = readRepoFile("app/components/consent-provider.tsx");
  const saveBody = /const save = useCallback\(\(choices: ConsentChoices\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(
    provider
  );
  assert.ok(saveBody, "could not find save() in consent-provider.tsx");

  const body = saveBody[1];
  const clearAt = body.indexOf("clearWithdrawnCookies(");
  const setStateAt = body.indexOf("setRecord(");
  assert.ok(clearAt !== -1, "save() no longer clears withdrawn cookies");
  assert.ok(setStateAt !== -1, "save() no longer records the decision");
  assert.ok(
    clearAt < setStateAt,
    "cookies are cleared after the state update — they must be deleted synchronously first, " +
      "or a reload can beat the deletion and the withdrawn cookie survives"
  );
  assert.ok(
    !/setRecord\(\s*\([a-zA-Z]*\)\s*=>/.test(body),
    "save() passes an updater function to setRecord; side effects there are not guaranteed to run once or on time"
  );
});

test("withdrawal deletes the first-party cookies we can reach", () => {
  const provider = readRepoFile("app/components/consent-provider.tsx");
  assert.match(provider, /clearWithdrawnCookies/, "no cookie clearing on withdrawal");
  assert.match(provider, /if \(!cookie\.firstParty\)/, "the clearing loop does not distinguish reachable cookies");
  // At least one vendor cookie must be marked unreachable, or the honesty of the
  // "we cannot delete these" note in the UI is untested.
  assert.ok(
    TAGS.some((tag) => tag.cookies.some((cookie) => !cookie.firstParty)),
    "no third-party cookies declared; the preference centre's footnote would be misleading"
  );
  assert.match(
    readRepoFile("app/components/consent-banner.tsx"),
    /thirdPartyNames/,
    "the preference centre does not tell the user which cookies we cannot clear"
  );
});
