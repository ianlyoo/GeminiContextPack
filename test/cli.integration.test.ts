import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");

function runCli(args: readonly string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], { encoding: "utf8" });
  return {
    stdout: (result.stdout as string) ?? "",
    stderr: (result.stderr as string) ?? "",
    status: result.status ?? 0,
  };
}

function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text.trim()) as Record<string, unknown>;
}

function isHex64(s: unknown): boolean {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

function assertNoLeak(obj: unknown, raw: string): void {
  const lower = raw.toLowerCase();
  expect(lower).not.toContain("stack");
  expect(lower).not.toContain("at node:");
  expect(lower).not.toContain("apikey");
  expect(lower).not.toContain("api_key");
  // No stack trace pattern "at <file>:"
  expect(JSON.stringify(obj)).not.toContain("\"stack\"");
}

function make5kSource(): string {
  // Safe 5k source that deterministically round-trips (no wrap-trim spaces)
  // Pure 'a' avoids whitespace trimming at wrap boundaries
  return "a".repeat(5000);
}

describe("cli integration — task 12", () => {
  beforeAll(() => {
    // Ensure built
    if (!existsSync(CLI_PATH)) {
      throw new Error(`CLI not built at ${CLI_PATH}; run bun run build first`);
    }
  });

  afterAll(() => {
    // no global cleanup
  });

  test("help exits 0", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("compile");
  });

  test("happy — compile→inspect→verify 5k source in temp directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-happy-"));
    try {
      const source = make5kSource();
      const input = join(dir, "source.txt");
      const pdf = join(dir, "out.pdf");
      writeFileSync(input, source, "utf8");
      const inputStatBefore = readFileSync(input, "utf8");

      // compile
      const c = runCli(["compile", "--input", input, "--output", pdf]);
      expect(c.status).toBe(0);
      expect(c.stderr.trim()).toBe("");
      const cJson = parseJson(c.stdout);
      expect(cJson.ok).toBe(true);
      expect(cJson.command).toBe("compile");
      expect(cJson.canonicalizationId).toBe("gemini-context-pack-v1");
      expect(isHex64(cJson.canonicalHash)).toBe(true);
      expect(typeof cJson.pageCount).toBe("number");
      expect((cJson.pageCount as number) >= 1 && (cJson.pageCount as number) <= 32).toBe(true);
      expect(typeof cJson.bytes).toBe("number");
      expect((cJson.bytes as number) > 0).toBe(true);
      assertNoLeak(cJson, c.stdout);
      expect(existsSync(pdf)).toBe(true);
      const pdfBytes = readFileSync(pdf);
      expect(pdfBytes.length).toBe(cJson.bytes as number);
      expect(pdfBytes.slice(0, 4).toString()).toBe("%PDF");
      // canonicalHash equals hashCanonical(source)
      const expectedHash = createHash("sha256").update(source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC"), "utf8").digest("hex");
      expect(cJson.canonicalHash).toBe(expectedHash);
      // input preserved
      expect(readFileSync(input, "utf8")).toBe(inputStatBefore);

      // inspect
      const ins = runCli(["inspect", "--pdf", pdf]);
      expect(ins.status).toBe(0);
      const insJson = parseJson(ins.stdout);
      expect(insJson.ok).toBe(true);
      expect(insJson.command).toBe("inspect");
      expect(insJson.canonicalizationId).toBe("gemini-context-pack-v1");
      expect(isHex64(insJson.extractedHash)).toBe(true);
      expect(insJson.extractedHash).toBe(cJson.canonicalHash);
      expect(typeof insJson.pageCount).toBe("number");
      expect(insJson.pageCount).toBe(cJson.pageCount);
      expect(typeof insJson.bytes).toBe("number");
      expect(insJson.bytes).toBe(cJson.bytes as number);
      assertNoLeak(insJson, ins.stdout);

      // verify
      const v = runCli(["verify", "--pdf", pdf, "--source", input]);
      expect(v.status).toBe(0);
      const vJson = parseJson(v.stdout);
      expect(vJson.ok).toBe(true);
      expect(vJson.command).toBe("verify");
      expect(vJson.status).toBe("verified");
      expect(vJson.canonicalizationId).toBe("gemini-context-pack-v1");
      expect(isHex64(vJson.expectedHash)).toBe(true);
      expect(isHex64(vJson.extractedHash)).toBe(true);
      expect(vJson.expectedHash).toBe(vJson.extractedHash);
      expect(vJson.expectedHash).toBe(cJson.canonicalHash);
      assertNoLeak(vJson, v.stdout);

      // files preserved
      expect(existsSync(input)).toBe(true);
      expect(existsSync(pdf)).toBe(true);
      expect(readFileSync(input, "utf8")).toBe(source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("failure — existing output without --force preserves files and returns OUTPUT_EXISTS", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-exists-"));
    try {
      const source = "existing output test";
      const input = join(dir, "source.txt");
      const pdf = join(dir, "out.pdf");
      writeFileSync(input, source, "utf8");
      const first = runCli(["compile", "--input", input, "--output", pdf]);
      expect(first.status).toBe(0);
      const beforeBytes = readFileSync(pdf);
      const beforeHash = createHash("sha256").update(beforeBytes).digest("hex");

      const second = runCli(["compile", "--input", input, "--output", pdf]);
      expect(second.status).toBe(2);
      expect(second.stdout.trim()).toBe("");
      const j = parseJson(second.stderr);
      expect(j.ok).toBe(false);
      expect(j.code).toBe("OUTPUT_EXISTS");
      assertNoLeak(j, second.stderr);
      // preserved
      expect(existsSync(input)).toBe(true);
      expect(readFileSync(input, "utf8")).toBe(source);
      expect(existsSync(pdf)).toBe(true);
      const afterBytes = readFileSync(pdf);
      expect(createHash("sha256").update(afterBytes).digest("hex")).toBe(beforeHash);

      // with --force succeeds and overwrites
      const forced = runCli(["compile", "--input", input, "--output", pdf, "--force"]);
      expect(forced.status).toBe(0);
      const forcedJson = parseJson(forced.stdout);
      expect(forcedJson.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("failure — wrong source returns INTEGRITY_MISMATCH and preserves files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-wrong-"));
    try {
      const source = "original source for wrong test";
      const wrong = "different wrong source";
      const input = join(dir, "source.txt");
      const wrongInput = join(dir, "wrong.txt");
      const pdf = join(dir, "out.pdf");
      writeFileSync(input, source, "utf8");
      writeFileSync(wrongInput, wrong, "utf8");
      const c = runCli(["compile", "--input", input, "--output", pdf]);
      expect(c.status).toBe(0);
      const pdfHashBefore = createHash("sha256").update(readFileSync(pdf)).digest("hex");
      const sourceHashBefore = createHash("sha256").update(readFileSync(input)).digest("hex");

      const v = runCli(["verify", "--pdf", pdf, "--source", wrongInput]);
      expect(v.status).toBe(2);
      const j = parseJson(v.stderr);
      expect(j.ok).toBe(false);
      expect(j.code).toBe("INTEGRITY_MISMATCH");
      assertNoLeak(j, v.stderr);
      expect(j.details).toBeDefined();
      // preserved
      expect(createHash("sha256").update(readFileSync(pdf)).digest("hex")).toBe(pdfHashBefore);
      expect(createHash("sha256").update(readFileSync(input)).digest("hex")).toBe(sourceHashBefore);
      expect(readFileSync(wrongInput, "utf8")).toBe(wrong);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("failure — malformed PDF returns MALFORMED_PDF and preserves files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-malformed-"));
    try {
      const source = "malformed pdf test source";
      const input = join(dir, "source.txt");
      const badPdf = join(dir, "bad.pdf");
      writeFileSync(input, source, "utf8");
      writeFileSync(badPdf, Buffer.from("not a pdf at all %PDF truncated", "utf8"));

      const badHashBefore = createHash("sha256").update(readFileSync(badPdf)).digest("hex");
      const sourceHashBefore = createHash("sha256").update(readFileSync(input)).digest("hex");

      const v = runCli(["verify", "--pdf", badPdf, "--source", input]);
      expect(v.status).toBe(2);
      const vj = parseJson(v.stderr);
      expect(vj.ok).toBe(false);
      expect(vj.code).toBe("MALFORMED_PDF");
      assertNoLeak(vj, v.stderr);

      const ins = runCli(["inspect", "--pdf", badPdf]);
      expect(ins.status).toBe(2);
      const insJ = parseJson(ins.stderr);
      expect(insJ.ok).toBe(false);
      expect(insJ.code === "MALFORMED_PDF" || insJ.code === "INVALID_TRANSPORT").toBe(true);
      assertNoLeak(insJ, ins.stderr);

      // preserved
      expect(createHash("sha256").update(readFileSync(badPdf)).digest("hex")).toBe(badHashBefore);
      expect(createHash("sha256").update(readFileSync(input)).digest("hex")).toBe(sourceHashBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("failure — page overflow returns PAGE_BUDGET_EXCEEDED and preserves files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-overflow-"));
    try {
      const smallSource = "page overflow trigger";
      const input = join(dir, "big.txt");
      const pdf = join(dir, "out.pdf");
      writeFileSync(input, smallSource, "utf8");
      const beforeInputHash = createHash("sha256").update(readFileSync(input)).digest("hex");

      // Use page-budget 0 to force PAGE_BUDGET_EXCEEDED without huge payload
      const c = runCli(["compile", "--input", input, "--output", pdf, "--page-budget", "0"]);
      expect(c.status).toBe(2);
      const j = parseJson(c.stderr);
      expect(j.ok).toBe(false);
      expect(j.code).toBe("PAGE_BUDGET_EXCEEDED");
      assertNoLeak(j, c.stderr);
      // No partial output
      expect(existsSync(pdf)).toBe(false);
      expect(readFileSync(input, "utf8")).toBe(smallSource);
      expect(createHash("sha256").update(readFileSync(input)).digest("hex")).toBe(beforeInputHash);

      // Also test that existing output is preserved on overflow when file already exists
      const secondSource = "small";
      const smallPdf = join(dir, "small.pdf");
      const smallInput = join(dir, "small.txt");
      writeFileSync(smallInput, secondSource, "utf8");
      const ok = runCli(["compile", "--input", smallInput, "--output", smallPdf]);
      expect(ok.status).toBe(0);
      const smallHashBefore = createHash("sha256").update(readFileSync(smallPdf)).digest("hex");
      const overflowSecond = runCli([
        "compile",
        "--input",
        input,
        "--output",
        smallPdf,
        "--page-budget",
        "0",
        "--force",
      ]);
      expect(overflowSecond.status).toBe(2);
      const j2 = parseJson(overflowSecond.stderr);
      expect(j2.code).toBe("PAGE_BUDGET_EXCEEDED");
      expect(createHash("sha256").update(readFileSync(smallPdf)).digest("hex")).toBe(smallHashBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("usage — missing required args returns USAGE_ERROR exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-usage-"));
    try {
      const input = join(dir, "source.txt");
      writeFileSync(input, "hello", "utf8");
      const r1 = runCli(["compile", "--input", input]);
      expect(r1.status).toBe(1);
      const j1 = parseJson(r1.stderr);
      expect(j1.code).toBe("USAGE_ERROR");
      assertNoLeak(j1, r1.stderr);

      const r2 = runCli(["verify", "--pdf", join(dir, "x.pdf")]);
      expect(r2.status).toBe(1);
      const j2 = parseJson(r2.stderr);
      expect(j2.code).toBe("USAGE_ERROR");

      const r3 = runCli(["inspect"]);
      expect(r3.status).toBe(1);
      const j3 = parseJson(r3.stderr);
      expect(j3.code).toBe("USAGE_ERROR");

      const r4 = runCli(["unknowncmd"]);
      expect(r4.status).toBe(1);
      const j4 = parseJson(r4.stderr);
      expect(j4.code).toBe("USAGE_ERROR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no API key/provider/network options are accepted — unknown flag is USAGE", () => {
    const dir = mkdtempSync(join(tmpdir(), "gcp-cli-nokeys-"));
    try {
      const input = join(dir, "source.txt");
      const pdf = join(dir, "out.pdf");
      writeFileSync(input, "hello", "utf8");
      const r = runCli(["compile", "--input", input, "--output", pdf, "--api-key", "secret"]);
      expect(r.status).toBe(1);
      const j = parseJson(r.stderr);
      expect(j.code).toBe("USAGE_ERROR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
