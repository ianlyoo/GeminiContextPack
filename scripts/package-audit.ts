/**
 * package-audit — standalone tarball allowlist gate.
 *
 * Validates:
 * - package.json files/exports/bin/scripts allowlist exact
 * - npm pack --json tarball contains only allowlisted paths
 * - fonts + licenses/README present, evidence/raw, .github, .env, private bundle,
 *   Pages, source-maps policy explicit, missing required, extra export all rejected
 *
 * No network, no secrets, deterministic exit codes.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PRODUCT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(PRODUCT_ROOT, "package.json");

// --- Explicit allowlist policy (MUST be reviewed when changing) ---

// Files field must equal this exactly (order-insensitive). Use narrowed prefix for fonts.
const EXPECTED_FILES = [
  "dist",
  "assets/fonts",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_LICENSES.md",
  "README.md",
] as const;

// For tarball: allowed path prefixes / exact files. Source maps are explicit.
export const SOURCE_MAP_POLICY: "allow" | "deny" = "allow";
// If allow, .map files under dist are permitted; if deny they are forbidden.

// Allowed tarball path prefixes (including npm's always-included quirks)
const ALLOWED_TARBALL_PREFIXES = [
  "dist/",
  "assets/fonts/",
  "package.json",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_LICENSES.md",
  "README.md",
  // npm auto-includes README variants even if not in files; allow explicitly
  "README.ko.md",
] as const;

// Required files that MUST be present in tarball (at least these)
const REQUIRED_TARBALL_PATHS = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_LICENSES.md",
  "README.md",
  "README.ko.md",
  "assets/fonts/NotoSansKR-Regular.ttf",
  "assets/fonts/NotoEmoji-Variable.ttf",
  "assets/fonts/manifest.json",
  "assets/fonts/OFL.txt",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/node.js",
  "dist/node.d.ts",
  "dist/cli.js",
  "dist/gemini/index.js",
  "dist/accounting/index.js",
] as const;

// Forbidden substrings / exact names inside tarball (case-insensitive for .env etc)
const FORBIDDEN_TARBALL_SUBSTRINGS: Array<{ pattern: string; reason: string }> = [
  { pattern: "evidence/raw", reason: "evidence/raw must NOT be in tarball" },
  { pattern: "evidence/", reason: "evidence must NOT be in tarball" },
  { pattern: ".github", reason: ".github must NOT be in tarball" },
  { pattern: ".env", reason: ".env must NOT be in tarball" },
  { pattern: "pagefold", reason: "private bundle pagefold must NOT be in tarball" },
  { pattern: "risu", reason: "forbidden brand must NOT be in tarball" },
  { pattern: "docs/", reason: "Pages/docs must NOT be in tarball" },
  { pattern: ".omo", reason: ".omo must NOT be in tarball" },
  { pattern: ".codegraph", reason: ".codegraph must NOT be in tarball" },
];

// Expected exports — exactly 4 subpaths
const EXPECTED_EXPORTS = {
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./node": { types: "./dist/node.d.ts", import: "./dist/node.js" },
  "./gemini": { types: "./dist/gemini/index.d.ts", import: "./dist/gemini/index.js" },
  "./accounting": { types: "./dist/accounting/index.d.ts", import: "./dist/accounting/index.js" },
} as const;

// Expected bin
const EXPECTED_BIN = { "gemini-context-pack": "./dist/cli.js" } as const;

// Forbidden scripts that would imply publish
const FORBIDDEN_SCRIPTS = [
  "prepublishOnly",
  "prepublish",
  "publish",
  "postpublish",
  "prepare:publish",
] as const;

export interface AuditResult {
  ok: boolean;
  errors: string[];
  tarballFiles?: string[];
}

function fail(errors: string[], msg: string): void {
  errors.push(msg);
}

function isAllowedTarballPath(p: string): boolean {
  // Allow package.json exactly
  if (p === "package.json") return true;
  for (const prefix of ALLOWED_TARBALL_PREFIXES) {
    if (prefix.endsWith("/")) {
      if (p.startsWith(prefix)) return true;
    } else {
      if (p === prefix) return true;
    }
  }
  return false;
}

function getPackFiles(opts?: { productRoot?: string }): string[] {
  const cwd = opts?.productRoot ?? PRODUCT_ROOT;
  const res = spawnSync("npm", ["pack", "--json"], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.status !== 0) {
    throw new Error(`npm pack --json failed: ${res.stderr ?? res.stdout} status ${String(res.status)}`);
  }
  const stdout = (res.stdout ?? "").trim();
  if (!stdout) throw new Error("npm pack --json produced empty stdout");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (e) {
    throw new Error(`npm pack --json not JSON: ${String(e)} stdout=${stdout.slice(0, 500)}`);
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const entry = (arr[0] as Record<string, unknown>) ?? {};
  const files = (entry["files"] as Array<{ path: string }>) ?? [];
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`npm pack --json files missing: ${JSON.stringify(entry).slice(0, 500)}`);
  }
  return files.map((f) => f.path);
}

export function auditPackage(opts: {
  productRoot?: string;
  pkgOverride?: Record<string, unknown>;
  tarballFilesOverride?: string[];
  skipPack?: boolean;
} = {}): AuditResult {
  const errors: string[] = [];
  const productRoot = opts.productRoot ?? PRODUCT_ROOT;

  // Load package.json (or override for failure fixtures)
  let pkg: Record<string, unknown>;
  if (opts.pkgOverride) {
    pkg = opts.pkgOverride;
  } else {
    const raw = readFileSync(join(productRoot, "package.json"), "utf8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  }

  // 1. files field exact
  const files = (pkg["files"] as string[] | undefined) ?? [];
  const expectedFilesSorted = [...EXPECTED_FILES].sort();
  const actualFilesSorted = [...files].sort();
  if (JSON.stringify(actualFilesSorted) !== JSON.stringify(expectedFilesSorted)) {
    fail(
      errors,
      `package.json files mismatch: expected ${JSON.stringify(expectedFilesSorted)} got ${JSON.stringify(actualFilesSorted)} — tarball must contain only dist, fonts, licenses/notices, README per allowlist`
    );
  }
  // Also check dist vs assets/fonts: forbid broad "assets" without suffix (should be assets/fonts)
  if (files.includes("assets") && !files.includes("assets/fonts")) {
    // Allow "assets" only if it's overridden to assets/fonts in expected — but we require assets/fonts
    fail(errors, `package.json files must use "assets/fonts" not bare "assets" for explicit allowlist`);
  }

  // 2. exports exactly 4
  const exportsMap = pkg["exports"] as Record<string, unknown> | undefined;
  if (!exportsMap) {
    fail(errors, `package.json exports missing`);
  } else {
    const gotKeys = Object.keys(exportsMap).sort();
    const expKeys = Object.keys(EXPECTED_EXPORTS).sort();
    if (JSON.stringify(gotKeys) !== JSON.stringify(expKeys)) {
      fail(errors, `exports keys mismatch: expected ${JSON.stringify(expKeys)} got ${JSON.stringify(gotKeys)}`);
    }
    for (const [k, v] of Object.entries(EXPECTED_EXPORTS)) {
      const got = exportsMap[k];
      if (JSON.stringify(got) !== JSON.stringify(v)) {
        fail(errors, `exports[${k}] mismatch: expected ${JSON.stringify(v)} got ${JSON.stringify(got)}`);
      }
    }
    // Extra export detection (already via keys check, but explicit)
    for (const k of gotKeys) {
      if (!(k in EXPECTED_EXPORTS)) {
        fail(errors, `extra export not allowed: ${k}`);
      }
    }
  }

  // 3. bin exactly
  const bin = pkg["bin"] as Record<string, string> | undefined;
  if (JSON.stringify(bin) !== JSON.stringify(EXPECTED_BIN)) {
    fail(errors, `bin mismatch: expected ${JSON.stringify(EXPECTED_BIN)} got ${JSON.stringify(bin)}`);
  }

  // 4. scripts — no publish
  const scripts = (pkg["scripts"] as Record<string, string> | undefined) ?? {};
  for (const key of FORBIDDEN_SCRIPTS) {
    if (key in scripts) fail(errors, `forbidden script present: ${key}`);
  }
  for (const [k, v] of Object.entries(scripts)) {
    if (typeof v === "string" && v.includes("npm publish")) {
      fail(errors, `script ${k} must not contain "npm publish": ${v}`);
    }
  }

  // 5. package metadata exact (name/version/license to catch drift)
  if (pkg["name"] !== "gemini-context-pack") fail(errors, `name must be gemini-context-pack got ${String(pkg["name"])}`);
  if (pkg["version"] !== "0.1.0") fail(errors, `version must be 0.1.0 got ${String(pkg["version"])}`);
  if (pkg["license"] !== "Apache-2.0") fail(errors, `license must be Apache-2.0 got ${String(pkg["license"])}`);

  // 6. tarball audit via npm pack --json (unless skipPack)
  let tarballFiles: string[] = [];
  if (opts.tarballFilesOverride) {
    tarballFiles = opts.tarballFilesOverride;
  } else if (!opts.skipPack) {
    try {
      tarballFiles = getPackFiles({ productRoot });
    } catch (e) {
      fail(errors, `npm pack audit failed: ${String(e)}`);
      return { ok: false, errors, tarballFiles };
    }
  }

  if (tarballFiles.length > 0) {
    // 6a. Check forbidden substrings
    for (const f of tarballFiles) {
      const lower = f.toLowerCase();
      for (const { pattern, reason } of FORBIDDEN_TARBALL_SUBSTRINGS) {
        if (lower.includes(pattern.toLowerCase())) {
          fail(errors, `tarball forbidden ${reason}: ${f}`);
        }
      }
      // Extra forbidden: anything starting with . (hidden) except allowed
      if (f.startsWith(".") && f !== ".nojekyll") {
        fail(errors, `tarball must not contain dotfile: ${f}`);
      }
    }

    // 6b. Source maps policy explicit
    const mapFiles = tarballFiles.filter((p) => p.endsWith(".map"));
    if (SOURCE_MAP_POLICY === "deny" && mapFiles.length > 0) {
      fail(errors, `source maps forbidden by policy but found ${mapFiles.length} .map files: ${mapFiles.slice(0, 3).join(", ")}`);
    }
    if (SOURCE_MAP_POLICY === "allow") {
      // When allowing, we still enforce they are only under dist/ (already via allowlist)
      for (const m of mapFiles) {
        if (!m.startsWith("dist/")) {
          fail(errors, `source map outside dist not allowed: ${m}`);
        }
      }
    }

    // 6c. Allowlist check — every file must be allowed
    for (const f of tarballFiles) {
      if (!isAllowedTarballPath(f)) {
        fail(errors, `tarball file not allowlisted: ${f} — allowed prefixes are ${ALLOWED_TARBALL_PREFIXES.join(", ")} (+ source maps under dist when policy=allow)`);
      }
    }

    // 6d. Required files present
    for (const req of REQUIRED_TARBALL_PATHS) {
      if (!tarballFiles.includes(req)) {
        fail(errors, `required tarball file missing: ${req}`);
      }
    }

    // 6e. Specific font/license presence already covered, but double-check extensions
    const hasFont = tarballFiles.some((p) => p.endsWith(".ttf"));
    if (!hasFont) fail(errors, `tarball missing .ttf font asset`);
    const hasLicense = tarballFiles.includes("LICENSE");
    if (!hasLicense) fail(errors, `tarball missing LICENSE`);
    const hasNotice = tarballFiles.includes("NOTICE");
    if (!hasNotice) fail(errors, `tarball missing NOTICE`);
  }

  // 7. Also ensure evidence/raw not referenced in files field (already via allowlist but explicit)
  if (files.some((f) => f.includes("evidence") || f.includes("raw"))) {
    fail(errors, `files field must not reference evidence/raw`);
  }
  if (files.some((f) => f.includes(".github"))) {
    fail(errors, `files field must not reference .github`);
  }
  if (files.some((f) => f.includes(".env"))) {
    fail(errors, `files field must not reference .env`);
  }

  return { ok: errors.length === 0, errors, tarballFiles };
}

function main(): void {
  const result = auditPackage();
  if (result.ok) {
    console.log(
      `[package-audit] OK — files ${JSON.stringify([...EXPECTED_FILES].sort())}, exports 4, bin 1, sourceMaps ${SOURCE_MAP_POLICY}, tarball ${result.tarballFiles?.length ?? 0} files, all allowlisted`
    );
    if (result.tarballFiles) {
      // List summary for evidence log
      for (const f of result.tarballFiles) console.log(`  - ${f}`);
    }
    process.exit(0);
  } else {
    console.error(`[package-audit] FAIL — ${result.errors.length} error(s)`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
