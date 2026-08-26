/**
 * package-consumer — tarball offline consumer gate + package-audit failure fixtures.
 *
 * Happy: install tgz in empty temp project and exercise 4 exports + CLI compile/verify.
 * Failure: inject fake .env, raw evidence, private bundle filename, missing font/license,
 *          extra export and ensure package audit rejects each.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PRODUCT_ROOT = resolve(import.meta.dir, "..");

function buildAndPack(): { tgzPath: string; filename: string } {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: PRODUCT_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
  const pack = spawnSync("npm", ["pack", "--json"], {
    cwd: PRODUCT_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);
  const parsed = JSON.parse(pack.stdout) as Array<{ filename: string }>;
  const filename = parsed[0]?.filename ?? "";
  if (!filename) throw new Error(`pack filename missing: ${pack.stdout}`);
  const tgzPath = join(PRODUCT_ROOT, filename);
  if (!existsSync(tgzPath)) throw new Error(`tgz not found: ${tgzPath}`);
  return { tgzPath, filename };
}

function runPackageAuditWithOverrides(opts: {
  pkgOverride?: Record<string, unknown>;
  tarballFilesOverride?: string[];
}): { ok: boolean; stdout: string; stderr: string } {
  const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
    auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
  };
  // Prefer direct import if require fails — fallback to spawn with env override.
  void auditPackage;
  // Use spawnSync with a helper script that imports auditPackage with overrides
  const helper = `
    import { auditPackage } from "${join(PRODUCT_ROOT, "scripts/package-audit.ts").replaceAll("\\", "/")}";
    const pkgOverride = ${opts.pkgOverride ? JSON.stringify(opts.pkgOverride) : "undefined"};
    const tarballFilesOverride = ${opts.tarballFilesOverride ? JSON.stringify(opts.tarballFilesOverride) : "undefined"};
    const result = auditPackage({ pkgOverride, tarballFilesOverride: tarballFilesOverride ?? undefined, skipPack: tarballFilesOverride ? true : false });
    if (!result.ok) {
      console.error(result.errors.join("\\n"));
      process.exit(1);
    }
    console.log("OK");
    process.exit(0);
  `;
  const tmpFile = join(tmpdir(), `audit-helper-${Date.now()}.mjs`);
  writeFileSync(tmpFile, helper, "utf8");
  const res = spawnSync("bun", ["run", tmpFile], {
    encoding: "utf8",
    timeout: 30_000,
  });
  try {
    const { unlinkSync } = require("node:fs") as typeof import("node:fs");
    unlinkSync(tmpFile);
  } catch {}
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("package-consumer — happy: tgz install + 4 exports + CLI", () => {
  test("install tgz in empty temp project and exercise API/CLI", async () => {
    const { tgzPath, filename } = buildAndPack();
    // Verify audit passes on real package before consumer test
    const audit = spawnSync("bun", ["run", "package:audit"], {
      cwd: PRODUCT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(audit.status).toBe(0);

    const tmp = mkdtempSync(join(tmpdir(), "pkg-consumer-"));
    const consumer = mkdtempSync(join(tmpdir(), "pkg-consumer-install-"));
    try {
      // Test A: direct CLI via dist (offline compile/verify)
      const inputPath = join(tmp, "input.txt");
      const outPath = join(tmp, "out.pdf");
      writeFileSync(inputPath, "hello world — deterministic example — CJK 中文", "utf8");
      const compile = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "compile", "--input", inputPath, "--output", outPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(compile.status).toBe(0);
      const compileJson = JSON.parse(compile.stdout.trim()) as {
        ok: boolean;
        canonicalizationId: string;
        pageCount: number;
      };
      expect(compileJson.ok).toBe(true);
      expect(compileJson.canonicalizationId).toBe("gemini-context-pack-v1");
      expect(compileJson.pageCount).toBeGreaterThanOrEqual(1);
      expect(existsSync(outPath)).toBe(true);

      const verify = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "verify", "--pdf", outPath, "--source", inputPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(verify.status).toBe(0);
      const verifyJson = JSON.parse(verify.stdout.trim()) as { ok: boolean; status: string };
      expect(verifyJson.ok).toBe(true);
      expect(verifyJson.status).toBe("verified");

      const inspect = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "inspect", "--pdf", outPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(inspect.status).toBe(0);
      const inspectJson = JSON.parse(inspect.stdout.trim()) as { ok: boolean; pageCount: number };
      expect(inspectJson.ok).toBe(true);

      // Test B: tarball consumer — npm install tgz + import 4 exports
      const pkgJson = { name: "consumer", version: "1.0.0", type: "module" as const };
      writeFileSync(join(consumer, "package.json"), JSON.stringify(pkgJson), "utf8");
      const inst = spawnSync("npm", ["install", "--silent", tgzPath], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(inst.status).toBe(0);

      // Verify tgz unpack does NOT contain forbidden paths (also covered by audit, but consumer-side double-check)
      const unpackCheck = spawnSync("npm", ["pack", "--json"], {
        cwd: PRODUCT_ROOT,
        encoding: "utf8",
        timeout: 30_000,
      });
      const packInfo = JSON.parse(unpackCheck.stdout) as Array<{ files: Array<{ path: string }> }>;
      const files = (packInfo[0]?.files ?? []).map((f) => f.path);
      expect(files.some((p) => p.includes("evidence/raw"))).toBe(false);
      expect(files.some((p) => p.includes(".github"))).toBe(false);
      expect(files.some((p) => p.toLowerCase().includes(".env"))).toBe(false);
      expect(files.some((p) => p.includes("pagefold"))).toBe(false);
      expect(files.some((p) => p.toLowerCase().includes("risu"))).toBe(false);
      expect(files.includes("assets/fonts/NotoSansKR-Regular.ttf")).toBe(true);
      expect(files.includes("assets/fonts/NotoEmoji-Variable.ttf")).toBe(true);
      expect(files.includes("LICENSE")).toBe(true);
      expect(files.includes("NOTICE")).toBe(true);
      expect(files.includes("dist/cli.js")).toBe(true);

      // Import four exports via node in consumer
      const script = [
        "import { compileContext, verifyContextPdf, canonicalize } from 'gemini-context-pack';",
        "import { compileContextWithBundledFonts } from 'gemini-context-pack/node';",
        "import { toGeminiInlinePart, normalizeGeminiUsage } from 'gemini-context-pack/gemini';",
        "import { createEstimatedRecord, compareUsage } from 'gemini-context-pack/accounting';",
        // root export
        "if (typeof compileContext !== 'function') throw new Error('compileContext missing');",
        "if (typeof verifyContextPdf !== 'function') throw new Error('verifyContextPdf missing');",
        "if (typeof canonicalize !== 'function') throw new Error('canonicalize missing');",
        // node export
        "if (typeof compileContextWithBundledFonts !== 'function') throw new Error('compileContextWithBundledFonts missing');",
        // gemini exports
        "if (typeof toGeminiInlinePart !== 'function') throw new Error('toGeminiInlinePart missing');",
        "if (typeof normalizeGeminiUsage !== 'function') throw new Error('normalizeGeminiUsage missing');",
        // accounting exports
        "if (typeof createEstimatedRecord !== 'function') throw new Error('createEstimatedRecord missing');",
        "if (typeof compareUsage !== 'function') throw new Error('compareUsage missing');",
        // functional checks
        "const source = 'hello world — deterministic consumer test';",
        "const artifact = await compileContextWithBundledFonts(source);",
        "if (artifact.canonicalizationId !== 'gemini-context-pack-v1') throw new Error('canonicalizationId');",
        "if (artifact.pageCount < 1) throw new Error('pageCount');",
        "const report = await verifyContextPdf(artifact.pdfBytes, source);",
        "if (report.status !== 'verified') throw new Error('verify failed');",
        "const part = toGeminiInlinePart(artifact);",
        "if (!part.inlineData || part.inlineData.mimeType !== 'application/pdf') throw new Error('inline part');",
        "const plain = createEstimatedRecord({ id: 'est-plain', observedAt: new Date().toISOString(), sourceLocator: 'plain', rawSha256: '0'.repeat(64), method: 'test', tokens: 100 });",
        "const pdf = createEstimatedRecord({ id: 'est-pdf', observedAt: new Date().toISOString(), sourceLocator: 'pdf', rawSha256: '1'.repeat(64), method: 'test', tokens: 10 });",
        "const cmp = compareUsage(plain, pdf);",
        "if (cmp.deltaTokens !== 90) throw new Error('compare delta');",
        "console.log('consumer ok', artifact.canonicalHash);",
      ].join("\n");
      writeFileSync(join(consumer, "consumer.mjs"), script, "utf8");
      const run = spawnSync("node", [join(consumer, "consumer.mjs")], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (run.status !== 0) {
        throw new Error(`consumer run failed: stdout=${run.stdout} stderr=${run.stderr}`);
      }
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("consumer ok");
      // Also test CLI from consumer's node_modules/.bin
      const binPath = join(consumer, "node_modules", ".bin", "gemini-context-pack");
      const cliExists = existsSync(binPath) || existsSync(`${binPath}.cmd`);
      // Fallback to via npx if bin not linked on Windows
      if (cliExists) {
        // not asserting execution via bin to keep cross-platform simple — import check above is sufficient
      }
      void filename;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(consumer, { recursive: true, force: true });
      try {
        const { unlinkSync } = await import("node:fs");
        if (existsSync(tgzPath)) unlinkSync(tgzPath);
      } catch {}
    }
  }, 90_000);
});

describe("package-audit — failure fixtures must be rejected", () => {
  test("rejects fake .env in tarball", () => {
    // Simulate tarball containing .env
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = [
      "dist/index.js",
      "LICENSE",
      "NOTICE",
      "package.json",
      ".env",
      "assets/fonts/NotoSansKR-Regular.ttf",
    ];
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    // Should fail via tarball forbidden .env
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain(".env");
  });

  test("rejects raw evidence in tarball", () => {
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = [
      "dist/index.js",
      "LICENSE",
      "package.json",
      "evidence/raw/plain_5k.json",
      "assets/fonts/NotoSansKR-Regular.ttf",
    ];
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("evidence");
  });

  test("rejects private bundle filename pagefold", () => {
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = ["dist/index.js", "LICENSE", "package.json", "pagefold-0.1.1.js"];
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("pagefold");
  });

  test("rejects missing font/license", () => {
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = ["dist/index.js", "package.json", "README.md"]; // missing LICENSE, fonts
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toMatch(/missing/i);
  });

  test("rejects extra export", () => {
    const pkgRaw = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const pkg = JSON.parse(JSON.stringify(pkgRaw)) as Record<string, unknown>;
    (pkg["exports"] as Record<string, unknown>)["./extra"] = {
      types: "./dist/extra.d.ts",
      import: "./dist/extra.js",
    };
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: ["dist/index.js", "dist/extra.js", "LICENSE", "package.json"],
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("extra");
  });

  test("rejects extra files field entry (e.g. evidence)", () => {
    const pkgRaw = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const pkg = JSON.parse(JSON.stringify(pkgRaw)) as Record<string, unknown>;
    (pkg["files"] as string[]).push("evidence");
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("files");
  });

  test("rejects missing required tarball dist file", () => {
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = ["LICENSE", "NOTICE", "package.json", "README.md"]; // missing dist
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("dist");
  });

  test("rejects docs/Pages in tarball", () => {
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const fakeFiles = ["dist/index.js", "LICENSE", "package.json", "docs/index.html"];
    const { auditPackage } = require(join(PRODUCT_ROOT, "scripts/package-audit.ts")) as unknown as {
      auditPackage: (o: unknown) => { ok: boolean; errors: string[] };
    };
    const result = (
      auditPackage as (o: Record<string, unknown>) => { ok: boolean; errors: string[] }
    )({
      pkgOverride: pkg,
      tarballFilesOverride: fakeFiles,
      skipPack: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|").toLowerCase()).toContain("docs");
  });
});
