/**
 * Resolves the `@/*` tsconfig path alias — and extensionless relative imports —
 * for `node --test`.
 *
 * App modules import each other as `@/app/lib/…` (tsconfig `paths`). Next's
 * bundler understands that; bare Node does not, so before this hook existed a
 * unit test could only import modules whose every value-import was relative or
 * a builtin. That ruled out the store layer — exactly the code the cross-tenant
 * tests need to exercise.
 *
 * The same gap applies to relative specifiers: app code writes both
 * `from "./quote"` and `from "./quote.ts"`, and bare Node only resolves the
 * second. `market-provider.ts:2` is the first kind, which made the whole market
 * layer untestable. Extension candidates are tried only after Node's own
 * resolution has failed, so nothing that already worked changes behaviour.
 *
 * Loaded via `--import ./tests/support/alias-hooks.mjs`.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.js"];

function isFile(candidate) {
  try {
    // `@/app/lib/brokers/adapters` names a directory whose entry point is
    // index.ts — resolving to the directory itself would blow up as EISDIR.
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveAliased(specifier) {
  const relative = specifier.slice(2);
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = path.join(projectRoot, `${relative}${extension}`);
    if (isFile(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

function resolveRelativeWithExtension(specifier, parentURL) {
  if (!parentURL || !specifier.startsWith(".")) {
    return null;
  }
  let parentPath;
  try {
    parentPath = fileURLToPath(parentURL);
  } catch {
    return null;
  }
  const base = path.resolve(path.dirname(parentPath), specifier);
  for (const extension of CANDIDATE_EXTENSIONS) {
    if (extension === "") continue;
    const candidate = `${base}${extension}`;
    if (isFile(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const url = resolveAliased(specifier);
      if (url) {
        return { url, shortCircuit: true };
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // Only ever a fallback: Node had its chance and could not find the file.
      const url = resolveRelativeWithExtension(specifier, context.parentURL);
      if (url) {
        return { url, shortCircuit: true };
      }
      throw error;
    }
  }
});
