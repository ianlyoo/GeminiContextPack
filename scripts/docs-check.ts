/**
 * docs:check — architecture, metadata, community, claim, snippet gates.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const PRODUCT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface CheckError { file: string; field: string; message: string; }
const errors: CheckError[] = [];
function fail(file: string, field: string, message: string): void { errors.push({ file, field, message }); }
function readText(p: string): string { return readFileSync(p, "utf8"); }
function expectFileExists(rel: string, label: string): boolean {
  const full = join(PRODUCT_ROOT, rel);
  if (!existsSync(full)) { fail(rel, label, `missing required file: ${rel}`); return false; }
  return true;
}

const EXACT_DESCRIPTION = "Gemini API context optimizer using native PDF packaging — reduce reported input tokens by up to 99% in measured long-context workloads.";
const OWNER = "ianlyoo";
const REPO_URL = "https://github.com/ianlyoo/GeminiContextPack";
const REPO_URL_GIT = "https://github.com/ianlyoo/GeminiContextPack.git";
const ISSUES_URL = "https://github.com/ianlyoo/GeminiContextPack/issues";
const KEYWORDS = ["gemini-api","google-gemini","native-pdf","long-context","context-window","context-optimization","token-optimization","pdf","typescript","llm","prompt-engineering","developer-tools"];
const VERSION = "0.1.0";
const LICENSE = "Apache-2.0";
const FORBIDDEN_BRAND_RE = /\b(Risu|RisuAI|PageFold)\b/i;
const FORBIDDEN_BRAND_GLOBAL = /\b(Risu|RisuAI|PageFold)\b/gi;
const PLACEHOLDER_RE = /\b(TODO|FIXME)\b/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// package.json
let pkg: Record<string, unknown> = {};
const pkgPath = join(PRODUCT_ROOT, "package.json");
try { pkg = JSON.parse(readText(pkgPath)) as Record<string, unknown>; } catch (e) { fail("package.json","parse",String(e)); }
if (pkg["name"] !== "gemini-context-pack") fail("package.json","name",`expected gemini-context-pack, got ${String(pkg["name"])}`);
if (pkg["version"] !== VERSION) fail("package.json","version",`expected ${VERSION}`);
if (pkg["description"] !== EXACT_DESCRIPTION) fail("package.json","description",`must equal exact approved string`);
if (pkg["license"] !== LICENSE) fail("package.json","license",`expected ${LICENSE}`);
if (pkg["author"] !== OWNER) fail("package.json","author",`expected ${OWNER}`);
const repoUrl = ((pkg["repository"] as Record<string,string> | undefined)?.["url"]) ?? "";
if (repoUrl !== REPO_URL_GIT) fail("package.json","repository.url",`expected ${REPO_URL_GIT}, got ${repoUrl}`);
if ((pkg["homepage"] as string) !== REPO_URL) fail("package.json","homepage",`expected ${REPO_URL}`);
if (((pkg["bugs"] as Record<string,string> | undefined)?.["url"]) !== ISSUES_URL) fail("package.json","bugs.url",`expected ${ISSUES_URL}`);
const keywords = (pkg["keywords"] as string[] | undefined) ?? [];
for (const kw of KEYWORDS) if (!keywords.includes(kw)) fail("package.json",`keywords.${kw}`,`missing ${kw}`);
if (keywords.length !== KEYWORDS.length) fail("package.json","keywords.length",`expected ${KEYWORDS.length}`);

// CITATION.cff
const cffPath = join(PRODUCT_ROOT, "CITATION.cff");
if (expectFileExists("CITATION.cff","citation")) {
  const cff = readText(cffPath);
  function cffField(key: string): string | null { const m = cff.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`,"m")); return m?.[1]?.trim() ?? null; }
  if (cffField("title") !== "GeminiContextPack") fail("CITATION.cff","title",`expected GeminiContextPack`);
  if (cffField("version") !== VERSION) fail("CITATION.cff","version",`expected ${VERSION}`);
  if (cffField("license") !== LICENSE) fail("CITATION.cff","license",`expected ${LICENSE}`);
  if (!cff.includes(EXACT_DESCRIPTION)) fail("CITATION.cff","abstract",`must contain exact description`);
  if (!cff.includes(REPO_URL)) fail("CITATION.cff","repository-code",`must contain ${REPO_URL}`);
  for (const kw of KEYWORDS) if (!cff.includes(kw)) fail("CITATION.cff",`keywords.${kw}`,`missing ${kw}`);
  if (!cff.includes(OWNER)) fail("CITATION.cff","author",`must contain ${OWNER}`);
  if (!cff.includes("cff-version:")) fail("CITATION.cff","cff-version",`missing`);
}

// codemeta.json
if (expectFileExists("codemeta.json","codemeta")) {
  try {
    const cm = JSON.parse(readText(join(PRODUCT_ROOT,"codemeta.json"))) as Record<string,unknown>;
    if (cm["name"] !== "GeminiContextPack") fail("codemeta.json","name",`expected GeminiContextPack`);
    if (cm["description"] !== EXACT_DESCRIPTION) fail("codemeta.json","description",`must equal exact`);
    if (cm["version"] !== VERSION) fail("codemeta.json","version",`expected ${VERSION}`);
    const lic = cm["license"] as string | undefined;
    if (lic !== "https://spdx.org/licenses/Apache-2.0" && lic !== LICENSE) fail("codemeta.json","license",`expected SPDX Apache-2.0`);
    if (cm["codeRepository"] !== REPO_URL) fail("codemeta.json","codeRepository",`expected ${REPO_URL}`);
    if ((cm["url"] as string) !== REPO_URL) fail("codemeta.json","url",`expected ${REPO_URL}`);
    const cmKw = (cm["keywords"] as string[] | undefined) ?? [];
    for (const kw of KEYWORDS) if (!cmKw.includes(kw)) fail("codemeta.json",`keywords.${kw}`,`missing ${kw}`);
    const authors = cm["author"] as Array<Record<string,string>> | undefined;
    if (!authors?.some(a => a["alternateName"]===OWNER || a["givenName"]==="Ian")) fail("codemeta.json","author",`must contain ${OWNER}`);
  } catch (e) { fail("codemeta.json","parse",String(e)); }
}

// CHANGELOG
if (expectFileExists("CHANGELOG.md","changelog")) {
  const ch = readText(join(PRODUCT_ROOT,"CHANGELOG.md"));
  if (!ch.includes(`## [${VERSION}]`)) fail("CHANGELOG.md","version",`must contain ## [${VERSION}]`);
  if (!ch.includes(REPO_URL)) fail("CHANGELOG.md","url",`should reference repo URL`);
  if (FORBIDDEN_BRAND_RE.test(ch)) fail("CHANGELOG.md","brand",`contains forbidden brand`);
}

// README
if (expectFileExists("README.md","readme")) {
  const readme = readText(join(PRODUCT_ROOT,"README.md"));
  if (!readme.startsWith("# GeminiContextPack")) fail("README.md","H1",`must start with # GeminiContextPack`);
  if (!readme.includes(EXACT_DESCRIPTION)) fail("README.md","description",`must contain exact description`);
}

// docs/architecture A-J
const archPath = join(PRODUCT_ROOT,"docs/architecture.md");
if (expectFileExists("docs/architecture.md","architecture")) {
  const arch = readText(archPath);
  const headingRe = /^##\s+([A-J])\.\s+.+$/gm;
  const found: string[] = []; let m: RegExpExecArray | null;
  while ((m = headingRe.exec(arch)) !== null) found.push(m[1]!);
  const expected = ["A","B","C","D","E","F","G","H","I","J"];
  if (found.length !== 10) fail("docs/architecture.md","A-J count",`expected 10 headings A-J, found ${found.length}: ${found.join(",")}`);
  else for (let i=0;i<10;i++) if (found[i] !== expected[i]) fail("docs/architecture.md",`A-J order[${i}]`,`expected ${expected[i]}, got ${found[i]}`);
  const requiredLabels = [
    { letter:"A", keywords:["current private audit","private audit"] },
    { letter:"B", keywords:["evidence validity"] },
    { letter:"C", keywords:["considered options"] },
    { letter:"D", keywords:["product"] },
    { letter:"E", keywords:["modules"] },
    { letter:"F", keywords:["integrity"] },
    { letter:"G", keywords:["qa","benchmark"] },
    { letter:"H", keywords:["clean-room","clean room"] },
    { letter:"I", keywords:["discoverability"] },
    { letter:"J", keywords:["v1","later"] },
  ];
  for (const req of requiredLabels) {
    const line = arch.match(new RegExp(`^##\\s+${req.letter}\\.\\s+.+$`,"im"))?.[0]?.toLowerCase() ?? "";
    if (!req.keywords.some(k => line.includes(k))) fail("docs/architecture.md",`${req.letter} heading`,`must contain one of: ${req.keywords.join(", ")}`);
  }
  if (!arch.includes(OWNER)) fail("docs/architecture.md","owner",`must mention ${OWNER}`);
  if (!arch.includes(REPO_URL)) fail("docs/architecture.md","repo url",`must contain ${REPO_URL}`);
  if (!arch.toLowerCase().includes("not an official google product")) fail("docs/architecture.md","disclaimer",`must contain disclaimer`);
  if (!arch.toLowerCase().includes("synthetic")) fail("docs/architecture.md","limitations",`must mention synthetic`);
  if (!arch.toLowerCase().includes("one run")) fail("docs/architecture.md","limitations",`must mention one run`);
  if (!arch.includes("gemini-2.5-flash")) fail("docs/architecture.md","limitations",`must mention gemini-2.5-flash`);
  if (!arch.toLowerCase().includes("no invoice")) fail("docs/architecture.md","limitations",`must mention no invoice`);
}

for (const rel of ["docs/accounting-and-claims.md","docs/validation-methodology.md","docs/responsible-use.md"]) {
  if (expectFileExists(rel,"doc")) {
    const txt = readText(join(PRODUCT_ROOT, rel));
    if (txt.length < 200) fail(rel,"length",`too short`);
  }
}

// CONTRIBUTING / CODE_OF_CONDUCT / SECURITY
if (expectFileExists("CONTRIBUTING.md","contributing")) {
  const c = readText(join(PRODUCT_ROOT,"CONTRIBUTING.md"));
  if (!c.toLowerCase().includes("contributor covenant") && !c.includes("CODE_OF_CONDUCT")) fail("CONTRIBUTING.md","CoC reference",`should reference CODE_OF_CONDUCT`);
}
if (expectFileExists("CODE_OF_CONDUCT.md","code_of_conduct")) {
  const coc = readText(join(PRODUCT_ROOT,"CODE_OF_CONDUCT.md"));
  if (!coc.includes("Contributor Covenant")) fail("CODE_OF_CONDUCT.md","attribution",`must attribute Contributor Covenant`);
  if (!coc.includes("https://www.contributor-covenant.org/version/2/1/code_of_conduct.html")) fail("CODE_OF_CONDUCT.md","attribution url",`must contain Covenant 2.1 URL`);
  if (!coc.toLowerCase().includes("enforcement")) fail("CODE_OF_CONDUCT.md","enforcement",`must contain enforcement`);
}
if (expectFileExists("SECURITY.md","security")) {
  const sec = readText(join(PRODUCT_ROOT,"SECURITY.md"));
  const lower = sec.toLowerCase();
  if (!lower.includes("private vulnerability reporting") && !lower.includes("report a vulnerability")) fail("SECURITY.md","vuln reporting",`must describe GitHub private vulnerability reporting`);
  if (!sec.includes("https://github.com/ianlyoo/GeminiContextPack/security/advisories/new") && !lower.includes("security → report a vulnerability")) fail("SECURITY.md","vuln reporting url",`must contain private reporting URL`);
  // email check: file should have no email addresses, but may contain "Do not use email"
  const hasEmail = EMAIL_RE.test(sec);
  // if file contains email pattern on a line that is not a "Do not" disclaimer, fail
  if (hasEmail) {
    const lines = sec.split("\n");
    for (const line of lines) {
      if (EMAIL_RE.test(line) && !line.toLowerCase().includes("do not") && !line.includes("example.com")) {
        fail("SECURITY.md","email",`must not contain email contact; use GitHub private vulnerability reporting`);
        break;
      }
    }
  }
  if (!lower.includes("do not use email") && !lower.includes("do not open a public issue")) fail("SECURITY.md","instructions",`should instruct not to open public issue and not to use email`);
}

// Issue/PR templates
if (!expectFileExists(".github/ISSUE_TEMPLATE/bug_report.md","bug_report")) {}
else { const t = readText(join(PRODUCT_ROOT,".github/ISSUE_TEMPLATE/bug_report.md")); if (!t.toLowerCase().includes("reproduction")) fail(".github/ISSUE_TEMPLATE/bug_report.md","content",`should contain reproduction`); }
if (!expectFileExists(".github/ISSUE_TEMPLATE/feature_request.md","feature_request")) {}
else { const t = readText(join(PRODUCT_ROOT,".github/ISSUE_TEMPLATE/feature_request.md")); if (!t.toLowerCase().includes("motivation") && !t.toLowerCase().includes("proposed")) fail(".github/ISSUE_TEMPLATE/feature_request.md","content",`should contain motivation/proposed`); }
if (!expectFileExists(".github/PULL_REQUEST_TEMPLATE.md","pr_template")) {}
else { const t = readText(join(PRODUCT_ROOT,".github/PULL_REQUEST_TEMPLATE.md")); if (!t.toLowerCase().includes("verification")) fail(".github/PULL_REQUEST_TEMPLATE.md","content",`should contain verification`); if (!t.includes("bun run docs:check")) fail(".github/PULL_REQUEST_TEMPLATE.md","docs:check",`should reference docs:check`); }

// ---------- Narrow scans: only docs + metadata, not scripts/tests/benchmarks ----------
const scanFiles = [
  "README.md",
  "README.ko.md",
  "docs/architecture.md",
  "docs/accounting-and-claims.md",
  "docs/validation-methodology.md",
  "docs/responsible-use.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CITATION.cff",
  "codemeta.json",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "evidence/results.json",
  "evidence/results.md",
].filter(rel => existsSync(join(PRODUCT_ROOT, rel)));

for (const rel of scanFiles) {
  let txt = "";
  try { txt = readText(join(PRODUCT_ROOT, rel)); } catch { continue; }
  if (PLACEHOLDER_RE.test(txt)) {
    // Allow placeholder mention in checklists that say "No placeholder markers" — but we removed TODO literals, so any hit is real
    // Check if line is part of docs-check's own regex definition is not in scanFiles, so safe
    fail(rel,"placeholder",`contains placeholder TODO/FIXME — must be resolved`);
  }
  const brandMatch = txt.match(FORBIDDEN_BRAND_GLOBAL);
  if (brandMatch) fail(rel,"forbidden brand",`contains forbidden brand word: ${brandMatch[0]}`);
}

// Unsupported claims — only docs/README/CITATION/codemeta/changelog
const docsForClaims = [
  "README.md",
  "README.ko.md",
  "docs/architecture.md",
  "docs/accounting-and-claims.md",
  "docs/validation-methodology.md",
  "docs/responsible-use.md",
  "CHANGELOG.md",
];
for (const rel of docsForClaims) {
  const full = join(PRODUCT_ROOT, rel);
  if (!existsSync(full)) continue;
  const txt = readText(full);
  const lines = txt.split("\n");
  for (let i=0;i<lines.length;i++) {
    const line = lines[i] ?? "";
    const ll = line.toLowerCase();
    // Skip lines that describe what NOT to do (contain FAIL, does not, do not, avoid, rejected/rejects, must not)
    const isNegativeContext = /fail|does not|do not|avoid|reject|must not|should not|unqualified.*fail|without/i.test(line);
    if (isNegativeContext) continue;
    if (/99%\s*\+/.test(line)) fail(rel,"unsupported claim",`line ${i+1} contains 99%+ : ${line.slice(0,120)}`);
    if (/99\.9%/.test(line)) fail(rel,"unsupported claim",`line ${i+1} contains 99.9% : ${line.slice(0,120)}`);
    if (/\balways\b.*99%/i.test(line)) fail(rel,"unsupported claim",`line ${i+1} contains always 99%`);
    if (/\bguaranteed\b/i.test(line)) fail(rel,"unsupported claim",`line ${i+1} contains guaranteed`);
    if (/ranking\s*#\s*1/i.test(line)) fail(rel,"unsupported claim",`line ${i+1} contains ranking #1`);
    // invoice + saving without disclaimer, but skip negative context already
    if (ll.includes("invoice") && (ll.includes("saving") || ll.includes("dollar")) ) {
      if (!ll.includes("no invoice") && !ll.includes("no dollar") && !ll.includes("no cost")) {
        fail(rel,"invoice claim",`line ${i+1} contains invoice+cost/savings without disclaimer: ${line.slice(0,120)}`);
      }
    }
  }
  // 99% adjacency: only enforce if file contains 99% and does NOT contain both qualified markers in file overall
  if (txt.includes("99%")) {
    const lower = txt.toLowerCase();
    const hasQualifiedInFile = lower.includes("up to 99%") && lower.includes("measured");
    const hasLimitInFile = lower.includes("synthetic") && lower.includes("one run") && lower.includes("no invoice");
    if (!hasQualifiedInFile && !hasLimitInFile) {
      fail(rel,"99% claim",`99% claim must be qualified with up to 99% + measured or synthetic+one run+no invoice`);
    } else {
      // additionally, for each 99% occurrence, check window has either measured or synthetic within 1000 chars
      let pos=0;
      while (true) {
        const idx = txt.indexOf("99%", pos);
        if (idx===-1) break;
        const window = txt.slice(Math.max(0, idx-1000), idx+1000).toLowerCase();
        const wQualified = window.includes("up to 99%") && window.includes("measured");
        const wLimit = window.includes("synthetic") && window.includes("one run");
        if (!wQualified && !wLimit) {
          fail(rel,"99% claim",`99% at offset ${idx} must have adjacent measured or synthetic+one run within 1000 chars`);
        }
        pos = idx+3;
      }
    }
  }
}

// Code snippet typecheck
function extractCodeFences(text: string): Array<{lang:string, code:string}> {
  const fences: Array<{lang:string,code:string}> = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) fences.push({ lang:(m[1]??"").toLowerCase(), code:m[2]??"" });
  return fences;
}
const snippetFilesToCheck = ["README.md","README.ko.md","docs/architecture.md","docs/accounting-and-claims.md","docs/validation-methodology.md","docs/responsible-use.md"];
let tsSnippets: Array<{file:string, code:string}> = [];
for (const rel of snippetFilesToCheck) {
  const full = join(PRODUCT_ROOT, rel);
  if (!existsSync(full)) continue;
  const txt = readText(full);
  for (const f of extractCodeFences(txt)) {
    if (["ts","typescript"].includes(f.lang) && (f.code.includes("import") || f.code.includes("compileContext") || f.code.includes("verifyContextPdf") || f.code.includes("normalizeGeminiUsage") || f.code.includes("toGeminiInlinePart"))) {
      tsSnippets.push({ file: rel, code: f.code });
    }
  }
}
if (tsSnippets.length===0) fail("docs/* + README","snippets",`no TypeScript code snippets found`);
else {
  const tmpDir = mkdtempSync(join(tmpdir(), "docs-check-"));
  try {
    const bodies: Array<{file:string, body:string}> = [];
    for (let i=0;i<tsSnippets.length;i++) {
      let code = tsSnippets[i]!.code
        .replace(/from\s+"gemini-context-pack\/node"/g, `from "${join(PRODUCT_ROOT,"src/node.ts").replace(/\\/g,"/")}"`)
        .replace(/from\s+"gemini-context-pack\/gemini"/g, `from "${join(PRODUCT_ROOT,"src/gemini/index.ts").replace(/\\/g,"/")}"`)
        .replace(/from\s+"gemini-context-pack\/accounting"/g, `from "${join(PRODUCT_ROOT,"src/accounting/index.ts").replace(/\\/g,"/")}"`)
        .replace(/from\s+"gemini-context-pack"/g, `from "${join(PRODUCT_ROOT,"src/index.ts").replace(/\\/g,"/")}"`);
      code = code.replace(/from\s+"([^"]+)\.ts"/g, 'from "$1.js"');
      const lines = code.split("\n");
      const bodyLines: string[] = [];
      for (const l of lines) {
        if (l.trim().startsWith("import ") && l.includes(" from ")) continue;
        bodyLines.push(l);
      }
      bodies.push({ file: tsSnippets[i]!.file, body: bodyLines.join("\n") });
    }
    let combined = `// auto-generated docs snippet typecheck\n`;
    combined += `declare const process: { env: Record<string,string> };\n`;
    combined += `import { compileContextWithBundledFonts } from "${join(PRODUCT_ROOT,"src/node.ts").replace(/\\/g,"/").replace(/\.ts$/,".js") }";\n`;
    combined += `import { verifyContextPdf } from "${join(PRODUCT_ROOT,"src/compiler.ts").replace(/\\/g,"/").replace(/\.ts$/,".js") }";\n`;
    combined += `import { toGeminiInlinePart, normalizeGeminiUsage } from "${join(PRODUCT_ROOT,"src/gemini/index.ts").replace(/\\/g,"/").replace(/\.ts$/,".js") }";\n`;
    combined += `import { GoogleGenAI } from "@google/genai";\n`;
    combined += `void compileContextWithBundledFonts; void verifyContextPdf; void toGeminiInlinePart; void normalizeGeminiUsage; void GoogleGenAI;\n\n`;
    for (let i=0;i<bodies.length;i++) {
      combined += `\n// snippet ${i+1} from ${bodies[i]!.file}\nasync function snippet_${i}() {\n${bodies[i]!.body}\n}\nvoid snippet_${i};\n`;
    }
    const tmpFile = join(tmpDir, "check.ts");
    // Inject references for ambient and fontkit
    const fontkitDts = join(PRODUCT_ROOT, "src", "fontkit.d.ts");
    combined = `/// <reference path="${join(tmpDir, "ambient.d.ts").replace(/\\/g,"/")}" />\n/// <reference path="${fontkitDts.replace(/\\/g,"/")}" />\n` + combined;
    writeFileSync(tmpFile, combined);
    // Provide ambient declarations for @google/genai
    writeFileSync(join(tmpDir, "ambient.d.ts"), `declare module "@google/genai" { export class GoogleGenAI { constructor(opts: unknown); models: { generateContent(opts: unknown): Promise<unknown> }; } }\n`);
    const tscBin = join(PRODUCT_ROOT, "node_modules", ".bin", "tsc");
    const tscCmd = existsSync(tscBin) ? tscBin : "tsc";
    const res = spawnSync(tscCmd, ["--noEmit","--skipLibCheck","--target","ES2022","--module","ESNext","--moduleResolution","bundler","--strict", tmpFile, join(tmpDir,"ambient.d.ts"), fontkitDts], { cwd: PRODUCT_ROOT, encoding:"utf8", timeout:30000, shell: true });
    const out = ((res.stdout as string) ?? "") + ((res.stderr as string) ?? "");
    if (res.status !== 0) fail("docs/snippets","typecheck",`TypeScript snippets failed to typecheck via tsc:\n${out.slice(0,3000)}\n---combined---\n${combined.slice(0,1500)}`);
  } catch (e) { fail("docs/snippets","typecheck",`failed to run tsc: ${String(e)}`); }
  finally { try { rmSync(tmpDir,{recursive:true, force:true}); } catch {} }
}

if (errors.length===0) {
  console.log(`[docs:check] OK — ${scanFiles.length} files scanned, ${tsSnippets.length} snippets typechecked, A–J order verified, metadata cross-file equality passed`);
  process.exit(0);
} else {
  console.error(`[docs:check] FAIL — ${errors.length} error(s)`);
  for (const e of errors) console.error(`  - ${e.file} :: ${e.field} :: ${e.message}`);
  process.exit(1);
}
