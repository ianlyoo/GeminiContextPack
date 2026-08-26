import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditRelease } from "../scripts/release-audit.ts";

const PRODUCT_ROOT = resolve(join(import.meta.dir, ".."));
const SOURCE_ROOT = "C:\\Users\\torch\\Documents\\code\\pdftokenizer";

function makeTempProduct(): string {
  const dir = mkdtempSync(join(tmpdir(), "release-audit-test-"));
  // Copy minimal structure needed for auditRelease to avoid scanning real product for failure fixtures
  // We use overrides instead of real files for isolation
  return dir;
}

describe("release-audit happy", () => {
  test("clean release candidate passes all gates", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      skipPack: true,
    });
    // skipPack true still checks other gates; for happy we expect clean even without tarball scan
    // But tarballScanned false is okay
    expect(result.historyOverlap).toBe(0);
    expect(result.forbiddenHits).toBe(0);
    expect(result.secretHits).toBe(0);
    expect(result.claimViolations).toBe(0);
    expect(result.license).toBe("Apache-2.0");
    expect([0, 1]).toContain(result.remoteCount);
    expect(result.allowedTrackedViolations).toBe(0);
    expect(result.details.rootOutsideAncestor).toBe(true);
    // If we skipPack, ok may still be true (tarball not required for this check)
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("full audit with tarball unpack also passes", () => {
    // This test exercises real npm pack unpack — may be slower
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
    });
    expect(result.historyOverlap).toBe(0);
    expect(result.forbiddenHits).toBe(0);
    expect(result.secretHits).toBe(0);
    expect(result.claimViolations).toBe(0);
    expect(result.license).toBe("Apache-2.0");
    expect([0, 1]).toContain(result.remoteCount);
    expect(result.details.tarballScanned).toBe(true);
    expect(result.ok).toBe(true);
  }, 60_000);
});

describe("release-audit failure fixtures (isolated, no private source touch)", () => {
  test("injects one ancestor SHA overlap is detected", () => {
    const fakeSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      productShasOverride: [fakeSha, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      sourceShasOverride: [fakeSha, "cccccccccccccccccccccccccccccccccccccccc"],
      skipPack: true,
    });
    expect(result.historyOverlap).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("history overlap"))).toBe(true);
  });

  test("forbidden word in filename is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["src/Risu.ts", "README.md"],
      skipPack: true,
    });
    expect(result.forbiddenHits).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("forbidden brand in filename"))).toBe(true);
  });

  test("forbidden word in binary/content is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["src/ok.ts"],
      extraFileContents: new Map([["src/ok.ts", "hello PageFold world"]]),
      skipPack: true,
    });
    expect(result.forbiddenHits).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("forbidden brand in content"))).toBe(true);
  });

  test("forbidden word in commit message is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      commitMessagesOverride: "feat: integrate RisuAI helper",
      skipPack: true,
    });
    expect(result.forbiddenHits).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("commit messages"))).toBe(true);
  });

  test("credential secret is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["src/secret.ts"],
      extraFileContents: new Map([
        ["src/secret.ts", "token = ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD"],
      ]),
      skipPack: true,
    });
    expect(result.secretHits).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("secret"))).toBe(true);
  });

  test("license drift is detected", () => {
    // Create temp product with MIT license to isolate
    const tmp = makeTempProduct();
    try {
      writeFileSync(
        join(tmp, "package.json"),
        JSON.stringify({ name: "gemini-context-pack", version: "0.1.0", license: "MIT" })
      );
      writeFileSync(join(tmp, "LICENSE"), "MIT License");
      writeFileSync(join(tmp, "NOTICE"), "Copyright 2026 ianlyoo");
      writeFileSync(join(tmp, "THIRD_PARTY_LICENSES.md"), "MIT");
      // Need to init git to satisfy toplevel check; use real product for other checks but override license via temp
      // Instead, test license drift by checking that audit with temp product fails
      const result = auditRelease({
        productRoot: tmp,
        sourceRoot: SOURCE_ROOT,
        trackedFilesOverride: [],
        skipPack: true,
      });
      expect(result.license).toBe("MIT");
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("Apache-2.0"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("99%+ claim is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["virtual-99plus.md"],
      extraFileContents: new Map([
        ["virtual-99plus.md", "# Title\nReduce tokens by 99%+ guaranteed savings."],
      ]),
      skipPack: true,
    });
    // 99%+ should be flagged as claim violation
    expect(result.claimViolations).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  test("unqualified 99% without adjacency is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["virtual-claim.md"],
      extraFileContents: new Map([
        ["virtual-claim.md", "We reduce tokens by 99% without limitations."],
      ]),
      skipPack: true,
    });
    expect(result.claimViolations).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("claim"))).toBe(true);
  });

  test("forbidden word in tarball filename is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["README.md"],
      tarballFilesOverride: ["dist/index.js", "PageFold-extra.js"],
    });
    expect(result.forbiddenHits).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  test("allowed tracked path violation is detected", () => {
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      trackedFilesOverride: ["src/index.ts", ".omo/secret.txt"],
      skipPack: true,
    });
    expect(result.allowedTrackedViolations).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  test("private source path not leaked in errors (hash not exposed)", () => {
    const fakeSha = "dddddddddddddddddddddddddddddddddddddddd";
    const result = auditRelease({
      productRoot: PRODUCT_ROOT,
      sourceRoot: SOURCE_ROOT,
      productShasOverride: [fakeSha],
      sourceShasOverride: [fakeSha],
      skipPack: true,
    });
    const hay = JSON.stringify(result);
    // Should not contain sourceRoot absolute path
    expect(hay.includes(SOURCE_ROOT)).toBe(false);
    expect(hay.includes("C:\\Users\\torch\\Documents\\code")).toBe(false);
    // History overlap count is present, but not the hash itself in errors (we push generic message)
    // Ensure errors do not contain the raw sha (we only report count)
    for (const e of result.errors) {
      expect(e.includes(fakeSha)).toBe(false);
    }
  });
});

describe("release-audit CLI", () => {
  test("CLI exits 0 with required JSON fields", () => {
    const scriptPath = join(PRODUCT_ROOT, "scripts/release-audit.ts");
    const res = spawnSync(
      "bun",
      [scriptPath, "--", "--source-root", SOURCE_ROOT, "--product-root", PRODUCT_ROOT],
      {
        cwd: PRODUCT_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      }
    );
    expect(res.status).toBe(0);
    const stdout = (res.stdout as string) ?? "";
    const json = JSON.parse(stdout) as Record<string, unknown>;
    expect(json["historyOverlap"]).toBe(0);
    expect(json["forbiddenHits"]).toBe(0);
    expect(json["secretHits"]).toBe(0);
    expect(json["claimViolations"]).toBe(0);
    expect(json["license"]).toBe("Apache-2.0");
    expect([0, 1]).toContain(json["remoteCount"] as number);
    expect(json["ok"] as boolean).toBe(true);
  }, 60_000);
});
