import { describe, expect, test } from "bun:test";

const pkg = await Bun.file("package.json").json() as Record<string, unknown>;

const EXPECTED_DESCRIPTION =
  "Gemini API context optimizer using native PDF packaging — reduce reported input tokens by up to 99% in measured long-context workloads.";
const EXPECTED_KEYWORDS = [
  "gemini-api",
  "google-gemini",
  "native-pdf",
  "long-context",
  "context-window",
  "context-optimization",
  "token-optimization",
  "pdf",
  "typescript",
  "llm",
  "prompt-engineering",
  "developer-tools",
];

describe("package metadata", () => {
  test("exact name/version/description/license", () => {
    expect(pkg["name"]).toBe("gemini-context-pack");
    expect(pkg["version"]).toBe("0.1.0");
    expect(pkg["description"]).toBe(EXPECTED_DESCRIPTION);
    // Em-dash check (U+2014)
    expect(EXPECTED_DESCRIPTION.includes("—")).toBe(true);
    expect(pkg["license"]).toBe("Apache-2.0");
  });

  test("type is ESM", () => {
    expect(pkg["type"]).toBe("module");
  });

  test("dynamic owner-based URLs", () => {
    const repo = pkg["repository"] as Record<string, string>;
    expect(repo.url).toBe("https://github.com/ianlyoo/GeminiContextPack.git");
    expect(pkg["homepage"]).toBe("https://github.com/ianlyoo/GeminiContextPack");
    const bugs = pkg["bugs"] as Record<string, string>;
    expect(bugs.url).toBe("https://github.com/ianlyoo/GeminiContextPack/issues");
  });

  test("keywords equal 12 approved topics exactly", () => {
    expect(pkg["keywords"]).toEqual(EXPECTED_KEYWORDS);
  });

  test("exports — four subpaths", () => {
    const exportsMap = pkg["exports"] as Record<string, unknown>;
    expect(Object.keys(exportsMap).sort()).toEqual([".", "./accounting", "./gemini", "./node"].sort());
    expect(exportsMap["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(exportsMap["./node"]).toEqual({
      types: "./dist/node.d.ts",
      import: "./dist/node.js",
    });
    expect(exportsMap["./gemini"]).toEqual({
      types: "./dist/gemini/index.d.ts",
      import: "./dist/gemini/index.js",
    });
    expect(exportsMap["./accounting"]).toEqual({
      types: "./dist/accounting/index.d.ts",
      import: "./dist/accounting/index.js",
    });
  });

  test("bin — single CLI entry", () => {
    expect(pkg["bin"]).toEqual({
      "gemini-context-pack": "./dist/cli.js",
    });
  });

  test("absence of publish scripts and old aliases", () => {
    const scripts = (pkg["scripts"] as Record<string, string>) ?? {};
    const forbidden = ["prepublishOnly", "prepublish", "publish", "postpublish", "prepare:publish"];
    for (const key of forbidden) {
      expect(scripts[key]).toBeUndefined();
    }
    // No custom token/publish scripts
    for (const [k, v] of Object.entries(scripts)) {
      expect(v.includes("npm publish")).toBe(false);
    }
    // Old brand check: no risu/pagefold in name/keywords/bin
    const hay = JSON.stringify(pkg).toLowerCase();
    expect(hay.includes("risu")).toBe(false);
    expect(hay.includes("pagefold")).toBe(false);
  });

  test("engines and files are declared", () => {
    const engines = pkg["engines"] as Record<string, string>;
    expect(engines["node"]).toBeDefined();
    expect(pkg["files"]).toBeDefined();
    const files = pkg["files"] as string[];
    expect(files.includes("dist")).toBe(true);
  });

  test("author present", () => {
    expect(pkg["author"]).toBeDefined();
  });
});
