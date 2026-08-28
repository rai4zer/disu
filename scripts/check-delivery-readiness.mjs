#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict-env');

function fail(message) {
  console.error(`[delivery-check] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[delivery-check] ${message}`);
}

const requiredDocs = ['docs/deployment-policy.md', 'docs/runbooks.md', 'docs/synthetic-data-policy.md'];
for (const file of requiredDocs) {
  if (!existsSync(path.join(process.cwd(), file))) {
    fail(`Missing required doc: ${file}`);
  } else {
    ok(`Found ${file}`);
  }
}

const envExamplePath = path.join(process.cwd(), '.env.example');
if (!existsSync(envExamplePath)) {
  fail('Missing .env.example');
} else {
  const envExample = readFileSync(envExamplePath, 'utf8');
  const requiredKeys = [
    'DISU_SESSION_SECRET',
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'QUANT_PYTHON_BIN',
    'PRIMER_PYTHON_BIN',
    'QUANT_MOCK_FALLBACK_MODE',
    'PRIMER_MOCK_FALLBACK_MODE',
    'MARKET_MOCK_FALLBACK_MODE',
    'ERROR_REPORT_WEBHOOK_URL'
  ];
  for (const key of requiredKeys) {
    if (!new RegExp(`^${key}=`, 'm').test(envExample)) {
      fail(`.env.example missing key: ${key}`);
    }
  }
  ok('.env.example includes required delivery keys');
}

if (strict) {
  const requiredRuntimeEnv = [
    'DISU_SESSION_SECRET',
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'QUANT_PYTHON_BIN',
    'PRIMER_PYTHON_BIN'
  ];
  for (const key of requiredRuntimeEnv) {
    if (!process.env[key] || String(process.env[key]).trim() === '') {
      fail(`Missing runtime environment variable: ${key}`);
    }
  }

  if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
    if ((process.env.QUANT_MOCK_FALLBACK_MODE ?? '').toLowerCase() !== 'never') {
      fail('Production requires QUANT_MOCK_FALLBACK_MODE=never');
    }
    if ((process.env.PRIMER_MOCK_FALLBACK_MODE ?? '').toLowerCase() !== 'never') {
      fail('Production requires PRIMER_MOCK_FALLBACK_MODE=never');
    }
    // Market data is the third synthetic-fallback path. The code already
    // defaults to `never` in production, so this only catches a deployment that
    // set it to something else on purpose (ROADMAP §2.7).
    if (!['', 'never'].includes((process.env.MARKET_MOCK_FALLBACK_MODE ?? '').toLowerCase())) {
      fail('Production requires MARKET_MOCK_FALLBACK_MODE=never (or unset)');
    }
    if ((process.env.PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE ?? '').trim() === '1') {
      fail('Production requires PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE=0');
    }
  }
  if (!process.exitCode) {
    ok('Strict runtime environment checks passed');
  }
}

// Guard against reintroducing hash-derived numbers on user-facing surfaces.
// See docs/synthetic-data-policy.md — synthetic values must be produced behind a
// provider that flags them, never inline in a page or route.
const syntheticGuardRoots = ['app/dashboard', 'app/portfolio', 'app/quant', 'app/filings-primers'];
const syntheticGuardPattern = /charCodeAt\s*\(/;
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}
let syntheticGuardHits = 0;
for (const root of syntheticGuardRoots) {
  const abs = path.join(process.cwd(), root);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    if (syntheticGuardPattern.test(readFileSync(file, 'utf8'))) {
      fail(
        `${path.relative(process.cwd(), file)}: hash-derived value in a user-facing surface. ` +
          'Synthetic values must come from a provider that flags them (docs/synthetic-data-policy.md).'
      );
      syntheticGuardHits += 1;
    }
  }
}
if (syntheticGuardHits === 0) {
  ok('No hash-derived values in user-facing surfaces');
}

// Guard against reaching a user-owned table through the raw Supabase client.
// Every handler runs with the service-role key, which bypasses RLS, so the
// `user_id` filter *is* the authorization check (ROADMAP §2.4, R2). Reads and
// writes on these tables must go through userScoped() — or, for deliberate
// cross-tenant work, systemRequest(), which forces the exemption to be written
// down at the call site.
const userScopeModule = 'app/lib/db/user-scope.ts';
const userScopeSource = existsSync(path.join(process.cwd(), userScopeModule))
  ? readFileSync(path.join(process.cwd(), userScopeModule), 'utf8')
  : '';
const userOwnedTablesBlock = /export const USER_OWNED_TABLES = \[([^\]]*)\]/.exec(userScopeSource);

if (!userOwnedTablesBlock) {
  fail(`Could not read USER_OWNED_TABLES from ${userScopeModule}; the tenant-scoping guard cannot run.`);
} else {
  const userOwnedTables = [...userOwnedTablesBlock[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  if (userOwnedTables.length === 0) {
    fail(`USER_OWNED_TABLES in ${userScopeModule} is empty; the tenant-scoping guard cannot run.`);
  }

  // Matches `supabaseRequest("jobs"` and `supabaseRequest<JobRow[]>("jobs"`.
  const rawAccessPattern = new RegExp(
    `supabaseRequest\\s*(?:<[^>]*>)?\\s*\\(\\s*["'\`](${userOwnedTables.join('|')})["'\`]`,
    'g'
  );

  let tenantGuardHits = 0;
  const appRoot = path.join(process.cwd(), 'app');
  if (existsSync(appRoot)) {
    for (const file of walk(appRoot)) {
      const relative = path.relative(process.cwd(), file);
      if (relative === userScopeModule) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(rawAccessPattern)) {
        fail(
          `${relative}: raw supabaseRequest("${match[1]}") on a user-owned table. ` +
            'Use userScoped(userId, …) from app/lib/db/user-scope.ts, or systemRequest(…) with a reason ' +
            'if this is deliberately cross-tenant (ROADMAP §2.4).'
        );
        tenantGuardHits += 1;
      }
    }
  }
  if (tenantGuardHits === 0) {
    ok(`User-owned tables (${userOwnedTables.length}) are reached only through the scoping helper`);
  }
}

// Guard the GDPR register against schema drift.
// "Delete my account" is only trustworthy if it is exhaustive, and exhaustive is
// a property of app/lib/account/personal-data.ts — not of anyone's memory. Any
// table whose schema references users(id) must be declared there with an erasure
// policy, so adding a table and forgetting is a build failure rather than a row
// that quietly survives an erasure request (ROADMAP §2.2).
const personalDataModule = 'app/lib/account/personal-data.ts';
const personalDataPath = path.join(process.cwd(), personalDataModule);
const migrationsDir = path.join(process.cwd(), 'db', 'migrations');

if (!existsSync(personalDataPath)) {
  fail(`Missing ${personalDataModule}; the GDPR register guard cannot run.`);
} else if (!existsSync(migrationsDir)) {
  fail('Missing db/migrations; the GDPR register guard cannot run.');
} else {
  const personalDataSource = readFileSync(personalDataPath, 'utf8');
  const declared = new Set(
    [...personalDataSource.matchAll(/table:\s*"([a-z_]+)"[\s\S]{0,120}?column:\s*"([a-z_]+)"/g)].map(
      (match) => `${match[1]}.${match[2]}`
    )
  );

  // Every `<column> ... references users(id)` in the schema, minus tables a
  // later migration dropped.
  const droppedTables = new Set();
  const schemaLinks = new Map();
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_]+)/gi)) {
      droppedTables.add(match[1]);
    }
    for (const block of sql.matchAll(/create table if not exists ([a-z_]+)\s*\(([\s\S]*?)\n\);/g)) {
      const [, table, columns] = block;
      droppedTables.delete(table);
      for (const link of columns.matchAll(/^\s*([a-z_]+)\s+text[^,\n]*references\s+users\(id\)/gm)) {
        schemaLinks.set(`${table}.${link[1]}`, { table, column: link[1] });
      }
    }
  }

  let registerGuardHits = 0;
  let liveLinkCount = 0;
  for (const [key, link] of schemaLinks) {
    if (droppedTables.has(link.table)) continue;
    liveLinkCount += 1;
    if (!declared.has(key)) {
      fail(
        `${link.table}.${link.column} references users(id) but is not declared in ${personalDataModule}. ` +
          'Add it with an erasure policy, or account deletion will silently leave it behind (ROADMAP §2.2).'
      );
      registerGuardHits += 1;
    }
  }
  if (registerGuardHits === 0) {
    ok(`GDPR register covers every live users(id) reference in the schema (${liveLinkCount})`);
  }
}

// Guard the legal registers against the code drifting away from the documents.
// A privacy policy is only true if it lists every party that receives data and
// every cookie that gets set, and neither list stays true by anyone's intent.
// Both are declared in app/lib/legal/, so a new outbound host or a new cookie
// that nobody wrote down is a build failure rather than a policy that quietly
// became a false statement (ROADMAP §2.2).
const legalDir = path.join(process.cwd(), 'app', 'lib', 'legal');

if (!existsSync(legalDir)) {
  fail('Missing app/lib/legal; the legal register guards cannot run.');
} else {
  const subprocessorSource = readFileSync(path.join(legalDir, 'subprocessors.ts'), 'utf8');
  const cookieSource = readFileSync(path.join(legalDir, 'cookies.ts'), 'utf8');

  const declaredHosts = new Set([...subprocessorSource.matchAll(/hosts:\s*\[([^\]]*)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((host) => host[1])));
  const exemptHosts = new Set(
    [...(/export const NON_DATA_HOSTS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(subprocessorSource)?.[1] ?? '')
      .matchAll(/"([^"]+)":/g)].map((match) => match[1])
  );
  const declaredCookies = new Set([...cookieSource.matchAll(/name:\s*"([a-z0-9_.*]+)"/gi)].map((match) => match[1]));

  // Comments are stripped first: an illustrative URL in a doc comment (an open-
  // redirect example, say) is not an outbound request and must not be reported.
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  let legalGuardHits = 0;
  const appRoot = path.join(process.cwd(), 'app');
  for (const file of walk(appRoot)) {
    const relative = path.relative(process.cwd(), file);
    if (relative.startsWith(path.join('app', 'lib', 'legal'))) continue;
    const source = stripComments(readFileSync(file, 'utf8'));

    for (const match of source.matchAll(/https:\/\/([a-zA-Z0-9._-]+)/g)) {
      const host = match[1];
      if (declaredHosts.has(host) || exemptHosts.has(host)) continue;
      fail(
        `${relative}: outbound host ${host} is not declared in app/lib/legal/subprocessors.ts. ` +
          'Add it with what actually reaches it, or add it to NON_DATA_HOSTS with the reason ' +
          'it receives nothing — the privacy policy is generated from that register (ROADMAP §2.2).'
      );
      legalGuardHits += 1;
    }

    // Every cookie name is defined as a constant, by convention, so the constant
    // is what gets checked. A cookie set from a literal would slip past this.
    for (const match of source.matchAll(/const\s+[A-Z0-9_]*COOKIE[A-Z0-9_]*\s*=\s*"([^"]+)"/g)) {
      if (declaredCookies.has(match[1])) continue;
      fail(
        `${relative}: cookie "${match[1]}" is not declared in app/lib/legal/cookies.ts. ` +
          'Declare it with a category — and if the category is not essential or preference, ' +
          'the cookie notice has to become a consent gate before it ships (ROADMAP §2.2).'
      );
      legalGuardHits += 1;
    }
  }

  if (legalGuardHits === 0) {
    ok(`Legal registers cover every outbound host (${declaredHosts.size}) and cookie (${declaredCookies.size})`);
  }
}

// Guard the consent gate against the registers outgrowing it.
//
// The moment a category needing consent is declared, a dismissible notice stops
// being lawful and the UI has to be a gate: no pre-ticked boxes, a refusal that
// is one click at the same prominence as acceptance, and a way to withdraw later
// (ePrivacy Art. 5(3); GDPR Art. 4(11), Art. 7(3)). None of that is verifiable
// from a stylesheet, but its absence is — so the structural pieces are checked
// here and the behaviour is checked in tests/consent.test.ts.
{
  const cookieSource = readFileSync(path.join(legalDir, 'cookies.ts'), 'utf8');
  const declaresConsentCategory = /category:\s*"(analytics|marketing|preference)"/.test(cookieSource);

  if (declaresConsentCategory) {
    const required = [
      ['app/lib/legal/consent.ts', 'the consent model'],
      ['app/components/consent-provider.tsx', 'the consent store'],
      ['app/components/consent-banner.tsx', 'the consent gate'],
      ['app/components/consent-tags.tsx', 'the gated tag loader']
    ];
    let gateHits = 0;
    for (const [file, what] of required) {
      if (!existsSync(path.join(process.cwd(), file))) {
        fail(`A consent-requiring cookie category is declared but ${file} (${what}) is missing.`);
        gateHits += 1;
      }
    }

    if (gateHits === 0) {
      const consentSource = readFileSync(path.join(process.cwd(), 'app/lib/legal/consent.ts'), 'utf8');
      const defaults = /export const DEFAULT_CONSENT[^=]*=\s*\{([\s\S]*?)\};/.exec(consentSource);
      if (!defaults) {
        fail('Could not read DEFAULT_CONSENT from app/lib/legal/consent.ts; the pre-ticked-box guard cannot run.');
      } else {
        for (const match of defaults[1].matchAll(/([a-z]+):\s*(true|false)/g)) {
          if (match[1] !== 'necessary' && match[2] === 'true') {
            fail(
              `DEFAULT_CONSENT sets ${match[1]} to true. Consent must be an affirmative act — ` +
                'a category that is on before the visitor chooses is a pre-ticked box (GDPR Art. 4(11)).'
            );
            gateHits += 1;
          }
        }
      }

      // Checked as a wired-up handler, not as a mention. The identifier also
      // appears in the destructuring and in the preference centre's props, so a
      // bare /rejectEverything/ would still pass on a banner whose reject button
      // had been repointed at accept.
      const bannerSource = readFileSync(path.join(process.cwd(), 'app/components/consent-banner.tsx'), 'utf8');
      if (!/onClick=\{\s*rejectEverything\s*\}/.test(bannerSource)) {
        fail(
          'app/components/consent-banner.tsx has no button wired to rejectEverything. ' +
            'Refusing must be one click at the top level, exactly like accepting.'
        );
        gateHits += 1;
      }
      if (!/onClick=\{\s*acceptEverything\s*\}/.test(bannerSource)) {
        fail('app/components/consent-banner.tsx has no button wired to acceptEverything.');
        gateHits += 1;
      }

      const footerSource = readFileSync(path.join(process.cwd(), 'app/components/app-footer.tsx'), 'utf8');
      if (!/onClick=\{\s*openPreferences\s*\}/.test(footerSource)) {
        fail(
          'The footer has no control wired to openPreferences. Withdrawal has to be as easy as consent ' +
            'and reachable from every page (GDPR Art. 7(3)).'
        );
        gateHits += 1;
      }
    }

    if (gateHits === 0) {
      ok('Consent gate present: no pre-ticked categories, one-click reject, withdrawal reachable');
    }
  } else {
    ok('No consent-requiring categories declared; a notice is sufficient');
  }
}

// A production server must not serve a privacy policy with a hole in it. The
// documents are complete in substance and reviewable now; the controller
// identity is not established yet, and shipping the pages without it would be
// publishing an unattributed policy (app/lib/legal/controller.ts).
if (strict && (process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
  const controllerSource = readFileSync(path.join(legalDir, 'controller.ts'), 'utf8');
  const pending = [...controllerSource.matchAll(/^\s*([a-zA-Z]+):\s*PENDING,?$/gm)].map((match) => match[1]);
  if (pending.length > 0) {
    fail(
      `Legal documents are not ready for production: ${pending.join(', ')} still PENDING in ` +
        'app/lib/legal/controller.ts. Register the entity and fill these in (ROADMAP §2.2).'
    );
  } else {
    ok('Legal documents name a controller');
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
