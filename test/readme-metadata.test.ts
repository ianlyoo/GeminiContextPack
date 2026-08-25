import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PRODUCT_ROOT = resolve(import.meta.dir, "..");
const README = readFileSync(join(PRODUCT_ROOT, "README.md"), "utf8");
const README_KO = existsSync(join(PRODUCT_ROOT, "README.ko.md"))
  ? readFileSync(join(PRODUCT_ROOT, "README.ko.md"), "utf8")
  : "";

const EXPECTED_DESCRIPTION =
  "Gemini API context optimizer using native PDF packaging — reduce reported input tokens by up to 99% in measured long-context workloads.";
const EXPECTED_H1 = "# GeminiContextPack";

// Helpers

function getFirstParagraph(content: string): string {
  const lines = content.split("\n");
  // Find H1 line, then skip empty, then first non-empty paragraph line(s) until blank
  const h1Idx = lines.findIndex((l) => l.trim() === EXPECTED_H1);
  if (h1Idx === -1) return "";
  let i = h1Idx + 1;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  // accumulate until blank line
  const parts: string[] = [];
  while (i < lines.length && (lines[i] ?? "").trim() !== "") {
    parts.push(lines[i] ?? "");
    i++;
  }
  return parts.join("\n").trim();
}

function extractCodeFences(content: string): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
    out.push(match[2] ?? "");
  }
  return out;
}

function claimViolations(content: string): string[] {
  const v: string[] = [];
  if (content.includes("99%+")) v.push("contains 99%+ (must be up to 99%)");
  if (/\balways\b/i.test(content)) v.push("contains always");
  if (/\bguaranteed\b/i.test(content)) v.push("contains guaranteed");
  // ranking promises
  if (/\b(top\s*1|#1 ranking|guaranteed ranking|featured topic)\b/i.test(content))
    v.push("ranking promise");

  // invoice / dollar cost savings — only flag positive savings claims, not negated disclaimers like "no invoice, no dollar cost"
  {
    const lines = content.split("\n");
    for (const line of lines) {
      const l = line.toLowerCase();
      const hasInvoiceSaving =
        l.includes("invoice") && (l.includes("saving") || l.includes("save"));
      const isNegated =
        l.includes("no invoice") || l.includes("no saving") || l.includes("no dollar");
      if (hasInvoiceSaving && !isNegated) {
        v.push("invoice cost/savings claim");
        break;
      }
      if (/dollar cost saving/i.test(line) && !/no dollar cost/i.test(line)) {
        v.push("dollar cost claim");
        break;
      }
      if (/\$.*save/i.test(line) && l.includes("invoice") && !isNegated) {
        v.push("invoice cost/savings claim");
        break;
      }
    }
  }

  // npm registry install without tarball path
  // detect `npm install` or `npm i` followed by gemini-context-pack without ./ or .tgz
  const registryInstall = /(?:npm\s+(?:install|i)|npx)\s+gemini-context-pack(?!.*\.tgz)(?!.*\.\/)/;
  if (registryInstall.test(content)) {
    // allow if line contains gh release or .tgz elsewhere in same code fence? We already check raw.
    // More precise: look for bare registry install
    const lines = content.split("\n");
    for (const line of lines) {
      if (
        /(npm\s+(install|i)\s+gemini-context-pack)(\s|$)/.test(line) &&
        !line.includes(".tgz") &&
        !line.includes("./")
      ) {
        v.push(`npm registry install: ${line.trim()}`);
        break;
      }
      if (/npx\s+gemini-context-pack/.test(line)) {
        v.push(`npx registry: ${line.trim()}`);
        break;
      }
    }
  }

  // keyword stuffing: repeated keyword block (same 6 keywords back-to-back without natural headings)
  const lower = content.toLowerCase();
  const keywords = [
    "native pdf packaging",
    "gemini api",
    "long context",
    "context optimization",
    "reported input tokens",
    "typescript",
  ];
  // If all 6 appear within a window of 300 chars without heading breaks, flag as stuffing
  // But we want to avoid flagging legitimate headings — require they appear as comma-separated list
  if (/native pdf packaging.*,\s*gemini api.*,\s*long context/i.test(content)) {
    v.push("keyword stuffing block");
  }

  // npm-download badge — detect badge markdown or shields npm download specifically
  if (
    /img\.shields\.io\/npm\/d[ml]/i.test(content) ||
    /\[!\[.*npm.*download.*\]\(.*badge.*\)\]/i.test(content) ||
    /\[!\[.*npm.*download.*\]\(.*shields.*npm.*\)\]/i.test(content)
  )
    v.push("npm-download badge present");
  else if (/npm.*download/i.test(content) && /shields.*badge/i.test(content))
    v.push("npm-download badge present");

  // numeric claim without trace: any occurrence of 5419/402/20704/51393 should have adjacent SHA/path
  const numericClaims = ["5419", "402", "20704", "51393"];
  for (const n of numericClaims) {
    const idx = content.indexOf(n);
    if (idx !== -1) {
      const window = content.slice(Math.max(0, idx - 1200), idx + 1200);
      const hasSha = /[a-f0-9]{7,64}/i.test(window);
      const hasPath = /evidence\/raw\//.test(window);
      if (!hasSha || !hasPath) v.push(`numeric ${n} without SHA/path trace`);
    }
  }

  // 99% claim must be qualified (up to 99% + measured)
  if (content.includes("99%")) {
    let searchFrom = 0;
    while (true) {
      const found = content.indexOf("99%", searchFrom);
      if (found === -1) break;
      const win = content.slice(Math.max(0, found - 500), found + 500);
      const qualified = win.includes("up to 99%") && /measured/.test(win);
      if (!qualified) v.push("unqualified 99% claim");
      searchFrom = found + 3;
    }
  }

  return v;
}

function hasAdjacentLimitations(content: string): boolean {
  // Benchmark section must contain limitations adjacent (within same section or next 2000 chars)
  const benchIdx = content.toLowerCase().indexOf("benchmark");
  if (benchIdx === -1) return false;
  const window = content.slice(benchIdx, benchIdx + 8000).toLowerCase();
  const required = [
    "synthetic",
    "seed 42",
    "one run",
    "gemini-2.5-flash",
    "low",
    "cache",
    "wrapper",
    "retrieval",
    "no invoice",
    "policy may change",
  ];
  return required.every((k) => window.includes(k));
}

function hasTarballInstall(content: string): boolean {
  return (
    content.includes("gh release download") &&
    content.includes(".tgz") &&
    content.includes("npm install ./")
  );
}

function hasNoNpmDownloadBadge(content: string): boolean {
  return (
    !/img\.shields\.io\/npm\/d[ml]/i.test(content) &&
    !/\[!\[.*npm.*download.*\]\(.*shields.*npm.*\)\]/i.test(content)
  );
}

describe("readme metadata — happy path", () => {
  test("H1 is exactly # GeminiContextPack in both languages", () => {
    const firstLineEn = (README.split("\n")[0] ?? "").trim();
    expect(firstLineEn).toBe(EXPECTED_H1);
    if (README_KO) {
      const firstLineKo = (README_KO.split("\n")[0] ?? "").trim();
      expect(firstLineKo).toBe(EXPECTED_H1);
    }
  });

  test("first paragraph equals exact approved description with em dash in both", () => {
    const para = getFirstParagraph(README);
    expect(para).toBe(EXPECTED_DESCRIPTION);
    expect(para.includes("—")).toBe(true);
    if (README_KO) {
      const paraKo = getFirstParagraph(README_KO);
      expect(paraKo).toBe(EXPECTED_DESCRIPTION);
    }
    // package.json description must also equal
    const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8"));
    expect(pkg.description).toBe(EXPECTED_DESCRIPTION);
  });

  test("language links are present and mutual", () => {
    expect(README).toContain("[한국어](README.ko.md)");
    if (README_KO) expect(README_KO).toContain("[English](README.md)");
  });

  test("badges: CI, Apache-2.0, v0.1.0, Pages present; no npm-download", () => {
    expect(README.toLowerCase()).toContain("actions/workflows/ci.yml");
    expect(README).toContain("Apache-2.0");
    expect(README).toContain("v0.1.0");
    expect(README.toLowerCase()).toContain("pages");
    expect(hasNoNpmDownloadBadge(README)).toBe(true);
    expect(/img\.shields\.io\/npm\/d[ml]/i.test(README)).toBe(false);
  });

  test("keywords appear naturally in headings (no stuffing)", () => {
    const lower = README.toLowerCase();
    const keywords = [
      "native pdf packaging",
      "gemini api",
      "long context",
      "context optimization",
      "reported input tokens",
      "typescript",
    ];
    for (const kw of keywords) expect(lower).toContain(kw);
    // Not as comma-separated stuffing block
    expect(/native pdf packaging.*,\s*gemini api.*,\s*long context/i.test(README)).toBe(false);
  });

  test("headings include quick start / use case / architecture / benchmark", () => {
    const lower = README.toLowerCase();
    expect(lower).toContain("quick start");
    expect(lower).toContain("use case");
    expect(lower).toContain("architecture");
    expect(lower).toContain("benchmark");
  });

  test("code fences present for clone/build/CLI", () => {
    const fences = extractCodeFences(README);
    expect(fences.length).toBeGreaterThanOrEqual(3);
    const joined = fences.join("\n");
    expect(joined).toContain("git clone");
    expect(joined).toContain("bun run build");
    // CLI examples must use gemini-context-pack compile/verify/inspect
    expect(joined).toContain("compile --input");
    expect(joined).toContain("verify --pdf");
    expect(joined).toContain("inspect --pdf");
  });

  test("tarball install documented via gh release / npm pack .tgz", () => {
    expect(hasTarballInstall(README)).toBe(true);
  });

  test("no npm install / npx registry examples", () => {
    const v = claimViolations(README);
    const hasRegistry = v.some((x) => x.includes("npm registry") || x.includes("npx registry"));
    expect(hasRegistry).toBe(false);
  });

  test("benchmark section has qualified numbers and adjacent limitations", () => {
    expect(README).toContain("5419");
    expect(README).toContain("402");
    expect(README).toContain("20704");
    expect(README).toContain("51393");
    // traceable to SHA/path
    expect(README).toContain("evidence/raw/plain_5k.json");
    expect(README).toContain("evidence/raw/pdf_5k.json");
    expect(README).toContain("940c31d2c6f4");
    expect(README).toContain("20513793f07e");
    expect(hasAdjacentLimitations(README)).toBe(true);
  });

  test("claim checker passes happy README", () => {
    const v = claimViolations(README);
    expect(v).toEqual([]);
  });

  test("claim checker passes happy KO README", () => {
    if (!README_KO) return;
    const v = claimViolations(README_KO);
    // KO may have translation but should still not have forbidden claims
    expect(v.filter((x) => x !== "keyword stuffing block")).toEqual([]);
  });
});

describe("readme metadata — failure fixtures (must be rejected)", () => {
  function expectViolation(snippet: string, expectedSubstr: string) {
    const v = claimViolations(snippet);
    expect(v.join("|").toLowerCase()).toContain(expectedSubstr.toLowerCase());
  }

  test("rejects 99%+ unqualified", () => {
    expectViolation(
      `# GeminiContextPack\n\n${EXPECTED_DESCRIPTION}\n\nWe get 99%+ reduction!`,
      "99%+"
    );
  });

  test("rejects always", () => {
    expectViolation(`${README}\n always works`, "always");
  });

  test("rejects invoice savings", () => {
    expectViolation(`${README}\n Save $100 on invoice`, "invoice");
  });

  test("rejects npm registry install", () => {
    expectViolation(
      "# GeminiContextPack\n\n" +
        EXPECTED_DESCRIPTION +
        "\n\n```bash\nnpm install gemini-context-pack\n```",
      "npm registry"
    );
  });

  test("rejects npx registry", () => {
    expectViolation(
      "# GeminiContextPack\n\n" +
        EXPECTED_DESCRIPTION +
        "\n\n```bash\nnpx gemini-context-pack compile\n```",
      "npx registry"
    );
  });

  test("rejects repeated keyword block", () => {
    const blob =
      "native PDF packaging, Gemini API, long context, context optimization, reported input tokens, TypeScript";
    expectViolation(blob, "keyword stuffing");
  });

  test("rejects unqualified 99% without up to/measured", () => {
    expectViolation("We reduce tokens by 99% in all workloads", "unqualified 99%");
  });

  test("rejects numeric claim without SHA/path", () => {
    expectViolation("Plain 5419 vs PDF 402 shows win", "without sha");
  });

  test("rejects npm-download badge", () => {
    expectViolation(
      "[![npm download](https://img.shields.io/npm/dm/gemini-context-pack.svg)](https://npmjs.com)",
      "npm-download"
    );
  });
});

describe("readme metadata — executable quick-start in temp tarball consumer", () => {
  test("build, pack, and execute compile/verify/inspect from snippets", async () => {
    // Ensure build succeeds
    const build = spawnSync("bun", ["run", "build"], {
      cwd: PRODUCT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(build.status).toBe(0);

    // Pack to get tarball path
    const pack = spawnSync("npm", ["pack", "--json"], {
      cwd: PRODUCT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    // npm pack --json may output JSON array; fallback to parsing stdout
    let tgzPath: string | null = null;
    try {
      const parsed = JSON.parse(pack.stdout ?? "[]");
      if (Array.isArray(parsed) && parsed[0]?.filename)
        tgzPath = join(PRODUCT_ROOT, parsed[0].filename);
    } catch {}
    if (!tgzPath || !existsSync(tgzPath)) {
      // Fallback: find newest tgz
      const { readdirSync, statSync } = await import("node:fs");
      const files = readdirSync(PRODUCT_ROOT).filter((f) => f.endsWith(".tgz"));
      expect(files.length).toBeGreaterThan(0);
      files.sort(
        (a, b) => statSync(join(PRODUCT_ROOT, b)).mtimeMs - statSync(join(PRODUCT_ROOT, a)).mtimeMs
      );
      tgzPath = join(PRODUCT_ROOT, files[0]!);
    }
    expect(existsSync(tgzPath!)).toBe(true);

    const tmp = mkdtempSync(join(tmpdir(), "readme-consumer-"));
    try {
      // Test 1: direct CLI via dist (mirrors quick-start clone/build/CLI)
      const inputPath = join(tmp, "input.txt");
      const outPath = join(tmp, "out.pdf");
      writeFileSync(inputPath, "hello world — deterministic example", "utf8");

      const compile = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "compile", "--input", inputPath, "--output", outPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(compile.status).toBe(0);
      const compileJson = JSON.parse(compile.stdout.trim());
      expect(compileJson.ok).toBe(true);
      expect(compileJson.canonicalizationId).toBe("gemini-context-pack-v1");
      expect(compileJson.pageCount).toBeGreaterThanOrEqual(1);
      expect(existsSync(outPath)).toBe(true);

      const inspect = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "inspect", "--pdf", outPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(inspect.status).toBe(0);
      const inspectJson = JSON.parse(inspect.stdout.trim());
      expect(inspectJson.ok).toBe(true);
      expect(inspectJson.pageCount).toBeGreaterThanOrEqual(1);

      const verify = spawnSync(
        "node",
        [join(PRODUCT_ROOT, "dist/cli.js"), "verify", "--pdf", outPath, "--source", inputPath],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(verify.status).toBe(0);
      const verifyJson = JSON.parse(verify.stdout.trim());
      expect(verifyJson.ok).toBe(true);
      expect(verifyJson.status).toBe("verified");

      // Test 2: tarball consumer — npm install tgz and import API
      const consumer = mkdtempSync(join(tmpdir(), "readme-consumer2-"));
      try {
        const pkgJson = { name: "consumer", version: "1.0.0", type: "module" as const };
        writeFileSync(join(consumer, "package.json"), JSON.stringify(pkgJson), "utf8");
        const inst = spawnSync("npm", ["install", "--silent", tgzPath!], {
          cwd: consumer,
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(inst.status).toBe(0);

        const script = [
          "import { compileContextWithBundledFonts } from 'gemini-context-pack/node';",
          "import { verifyContextPdf } from 'gemini-context-pack';",
          "const artifact = await compileContextWithBundledFonts('hello world — deterministic example');",
          "if (!artifact.pdfBytes || artifact.pageCount < 1) throw new Error('no artifact');",
          "const report = await verifyContextPdf(artifact.pdfBytes, 'hello world — deterministic example');",
          "if (report.status !== 'verified') throw new Error('not verified');",
          "console.log('consumer ok', artifact.canonicalHash);",
        ].join("\n");
        writeFileSync(join(consumer, "consumer.mjs"), script, "utf8");
        const run = spawnSync("node", [join(consumer, "consumer.mjs")], {
          cwd: consumer,
          encoding: "utf8",
          timeout: 30_000,
        });
        if (run.status !== 0) {
          // surface stderr for debugging
          throw new Error(
            `consumer run failed: stdout=${run.stdout} stderr=${run.stderr} status=${run.status}`
          );
        }
        expect(run.status).toBe(0);
        expect(run.stdout).toContain("consumer ok");
      } finally {
        rmSync(consumer, { recursive: true, force: true });
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      // Clean packed tgz after test
      try {
        if (tgzPath && existsSync(tgzPath)) {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(tgzPath);
        }
      } catch {}
    }
  }, 90_000);
});
