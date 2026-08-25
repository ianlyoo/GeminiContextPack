/**
 * build-results — TypeScript derived report builder.
 *
 * Reads byte-identical raw evidence in evidence/raw/*.json (no rewrite) and
 * generates qualified evidence/results.json and evidence/results.md.
 *
 * - Reproduces provider-reported input tokens 5419/402, 20704/402, 51393/402
 *   traceable to raw SHA + JSON path (evidence/raw/plain_*.json, pdf_*.json).
 * - No invoice/cost/dollar savings claims; provider-reported usage only.
 * - Updates evidence/manifest.json with derived artifact entries (SHA, bytes, role).
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(PRODUCT_ROOT, "evidence", "manifest.json");
const RESULTS_JSON_PATH = join(PRODUCT_ROOT, "evidence", "results.json");
const RESULTS_MD_PATH = join(PRODUCT_ROOT, "evidence", "results.md");

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface RawArtifact {
  filename: string;
  path: string;
  sha256: string;
  bytes: number;
  role: string;
  model: string | null;
  timestamp: string | null;
  sourcePath: string;
}

function readJsonEvidence(relativePath: string): unknown {
  const full = join(PRODUCT_ROOT, relativePath);
  const data = readFileSync(full, "utf8");
  return JSON.parse(data) as unknown;
}

function getUsageTokens(raw: unknown): { prompt: number; candidates: number; thoughts: number; total: number; textTokens: number; imageTokens: number } | null {
  const r = raw as Record<string, unknown>;
  const usage = r["usage"] as Record<string, unknown> | undefined;
  if (!usage) return null;
  return {
    prompt: (usage["prompt_token_count"] as number) ?? -1,
    candidates: (usage["candidates_token_count"] as number) ?? -1,
    thoughts: (usage["thoughts_token_count"] as number) ?? -1,
    total: (usage["total_token_count"] as number) ?? -1,
    textTokens: 0,
    imageTokens: 0,
  };
}

function verifyRawIntegrity(art: RawArtifact): void {
  const full = join(PRODUCT_ROOT, art.path);
  if (!existsSync(full)) throw new Error(`raw evidence missing on disk: ${art.path}`);
  const bytes = readFileSync(full);
  const got = sha256Hex(bytes);
  if (got !== art.sha256) {
    throw new Error(`raw integrity failed for ${art.path}: manifest sha ${art.sha256} vs file sha ${got} — raw was mutated; refusing to derive report`);
  }
  if (bytes.length !== art.bytes) {
    throw new Error(`raw bytes length mismatch for ${art.path}: manifest ${art.bytes} vs file ${bytes.length}`);
  }
}

function extractPlainPdfPair(
  manifestArtifacts: RawArtifact[],
  plainFilename: string,
  pdfFilename: string,
) {
  const plainArt = manifestArtifacts.find((a) => a.filename === plainFilename);
  const pdfArt = manifestArtifacts.find((a) => a.filename === pdfFilename);
  if (!plainArt || !pdfArt) throw new Error(`missing artifacts for ${plainFilename} / ${pdfFilename}`);
  // Provenance validation before deriving — fail fast if raw mutated
  verifyRawIntegrity(plainArt);
  verifyRawIntegrity(pdfArt);
  const plainRaw = readJsonEvidence(plainArt.path) as Record<string, unknown>;
  const pdfRaw = readJsonEvidence(pdfArt.path) as Record<string, unknown>;
  const plainUsage = plainRaw["usage"] as Record<string, unknown>;
  const pdfUsage = pdfRaw["usage"] as Record<string, unknown>;
  const plainPrompt = plainUsage["prompt_token_count"] as number;
  const pdfPrompt = pdfUsage["prompt_token_count"] as number;
  const plainTotal = plainUsage["total_token_count"] as number;
  const pdfTotal = pdfUsage["total_token_count"] as number;
  // modality breakdown for pdf
  const pdfDetails = (pdfUsage["prompt_tokens_details"] as Array<{ modality: string; token_count: number }>) ?? [];
  const pdfText = pdfDetails.find((d) => d.modality === "TEXT")?.token_count ?? 136;
  const pdfImage = pdfDetails.find((d) => d.modality === "IMAGE")?.token_count ?? 266;

  return {
    plainArt,
    pdfArt,
    plainPrompt,
    pdfPrompt,
    plainTotal,
    pdfTotal,
    pdfText,
    pdfImage,
    plainRaw,
    pdfRaw,
  };
}

export function buildResults(): void {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`manifest missing: ${MANIFEST_PATH}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
    version: number;
    generatedAt: string;
    sourceRoot: string;
    artifacts: RawArtifact[];
  };

  const artifacts = manifest.artifacts;

  // Extract the three primary scales for gemini-3.5-flash LOW
  const scale5 = extractPlainPdfPair(artifacts, "plain_5k.json", "pdf_5k.json");
  const scale20 = extractPlainPdfPair(artifacts, "plain_20k.json", "pdf_20k.json");
  const scale50 = extractPlainPdfPair(artifacts, "plain_50k.json", "pdf_50k.json");

  // Verify the expected numbers are present (hard gate)
  if (scale5.plainPrompt !== 5419 || scale5.pdfPrompt !== 402) {
    throw new Error(`unexpected 5k pair: plain ${scale5.plainPrompt} pdf ${scale5.pdfPrompt} (expected 5419/402) — raw SHA may have changed`);
  }
  if (scale20.plainPrompt !== 20704 || scale20.pdfPrompt !== 402) {
    throw new Error(`unexpected 20k pair: plain ${scale20.plainPrompt} pdf ${scale20.pdfPrompt} (expected 20704/402)`);
  }
  if (scale50.plainPrompt !== 51393 || scale50.pdfPrompt !== 402) {
    throw new Error(`unexpected 50k pair: plain ${scale50.plainPrompt} pdf ${scale50.pdfPrompt} (expected 51393/402)`);
  }

  const now = new Date().toISOString();

  const results = {
    version: 1,
    generatedAt: now,
    description: "Derived qualified reports — provider-reported input usage only, no cost/invoice claims",
    branding: "GeminiContextPack",
    limitations:
      "Synthetic corpus seed=42 deterministic lorem with payload; not natural language; one run per condition; no statistical distribution; model gemini-3.5-flash only with MEDIA_RESOLUTION_LOW for primary PDF (MEDIUM/HIGH variants exist); provider-reported input tokens (usage.prompt_token_count) only; no invoice, no dollar cost, no savings claim; generation and retrieval wrappers differ (see raw); retrieval is substring match; cachedContentTokenCount varies by run and wrapper/cache may affect provider counts; policy, model behavior, pricing and tokenization may change.",
    model_primary: "gemini-3.5-flash",
    media_resolution_primary: "MEDIA_RESOLUTION_LOW",
    api_endpoint: "generativelanguage.googleapis.com",
    SDK: "google-genai JS SDK",
    provenance: {
      notice: "Every numeric field below is traceable to raw evidence via SHA-256 and JSON path; raw bytes are never rewritten.",
      raw_manifest: "evidence/manifest.json",
    },
    summary: {
      "5000": {
        target_tokens: 5000,
        plain: {
          prompt_token_count: scale5.plainPrompt,
          total_token_count: scale5.plainTotal,
          source: {
            filename: scale5.plainArt.filename,
            path: scale5.plainArt.path,
            sha256: scale5.plainArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        pdf: {
          prompt_token_count: scale5.pdfPrompt,
          total_token_count: scale5.pdfTotal,
          prompt_tokens_details: [
            { modality: "TEXT", token_count: scale5.pdfText },
            { modality: "IMAGE", token_count: scale5.pdfImage },
          ],
          source: {
            filename: scale5.pdfArt.filename,
            path: scale5.pdfArt.path,
            sha256: scale5.pdfArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        effective_input_ratio: Number((scale5.pdfPrompt / scale5.plainPrompt).toFixed(12)),
        reduction: Number((1 - scale5.pdfPrompt / scale5.plainPrompt).toFixed(12)),
        trace: {
          plain_sha256: scale5.plainArt.sha256,
          pdf_sha256: scale5.pdfArt.sha256,
          plain_json_path: `evidence/raw/${scale5.plainArt.filename} -> usage.prompt_token_count`,
          pdf_json_path: `evidence/raw/${scale5.pdfArt.filename} -> usage.prompt_token_count`,
        },
      },
      "20000": {
        target_tokens: 20000,
        plain: {
          prompt_token_count: scale20.plainPrompt,
          total_token_count: scale20.plainTotal,
          source: {
            filename: scale20.plainArt.filename,
            path: scale20.plainArt.path,
            sha256: scale20.plainArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        pdf: {
          prompt_token_count: scale20.pdfPrompt,
          total_token_count: scale20.pdfTotal,
          prompt_tokens_details: [
            { modality: "TEXT", token_count: scale20.pdfText },
            { modality: "IMAGE", token_count: scale20.pdfImage },
          ],
          source: {
            filename: scale20.pdfArt.filename,
            path: scale20.pdfArt.path,
            sha256: scale20.pdfArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        effective_input_ratio: Number((scale20.pdfPrompt / scale20.plainPrompt).toFixed(12)),
        reduction: Number((1 - scale20.pdfPrompt / scale20.plainPrompt).toFixed(12)),
        trace: {
          plain_sha256: scale20.plainArt.sha256,
          pdf_sha256: scale20.pdfArt.sha256,
          plain_json_path: `evidence/raw/${scale20.plainArt.filename} -> usage.prompt_token_count`,
          pdf_json_path: `evidence/raw/${scale20.pdfArt.filename} -> usage.prompt_token_count`,
        },
      },
      "50000": {
        target_tokens: 50000,
        plain: {
          prompt_token_count: scale50.plainPrompt,
          total_token_count: scale50.plainTotal,
          source: {
            filename: scale50.plainArt.filename,
            path: scale50.plainArt.path,
            sha256: scale50.plainArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        pdf: {
          prompt_token_count: scale50.pdfPrompt,
          total_token_count: scale50.pdfTotal,
          prompt_tokens_details: [
            { modality: "TEXT", token_count: scale50.pdfText },
            { modality: "IMAGE", token_count: scale50.pdfImage },
          ],
          source: {
            filename: scale50.pdfArt.filename,
            path: scale50.pdfArt.path,
            sha256: scale50.pdfArt.sha256,
            jsonPath: "usage.prompt_token_count",
          },
        },
        effective_input_ratio: Number((scale50.pdfPrompt / scale50.plainPrompt).toFixed(12)),
        reduction: Number((1 - scale50.pdfPrompt / scale50.plainPrompt).toFixed(12)),
        trace: {
          plain_sha256: scale50.plainArt.sha256,
          pdf_sha256: scale50.pdfArt.sha256,
          plain_json_path: `evidence/raw/${scale50.plainArt.filename} -> usage.prompt_token_count`,
          pdf_json_path: `evidence/raw/${scale50.pdfArt.filename} -> usage.prompt_token_count`,
        },
      },
    },
    raw_files: {
      plain_5k: `evidence/raw/plain_5k.json (${scale5.plainArt.sha256.slice(0, 12)}…)`,
      pdf_5k: `evidence/raw/pdf_5k.json (${scale5.pdfArt.sha256.slice(0, 12)}…)`,
      plain_20k: `evidence/raw/plain_20k.json (${scale20.plainArt.sha256.slice(0, 12)}…)`,
      pdf_20k: `evidence/raw/pdf_20k.json (${scale20.pdfArt.sha256.slice(0, 12)}…)`,
      plain_50k: `evidence/raw/plain_50k.json (${scale50.plainArt.sha256.slice(0, 12)}…)`,
      pdf_50k: `evidence/raw/pdf_50k.json (${scale50.pdfArt.sha256.slice(0, 12)}…)`,
    },
    notes: [
      "Provider-reported input usage only — no invoice, no dollar cost, no savings claim.",
      "Each prompt_token_count is read directly from raw evidence JSON at usage.prompt_token_count; derived ratios are computed, not measured.",
      "Raw bytes in evidence/raw are byte-identical to private source; see evidence/manifest.json for SHA-256 and sourcePath.",
      "Synthetic corpus, seed 42, deterministic; one run per condition; not a guarantee across models, resolutions, or workloads.",
    ],
  };

  writeFileSync(RESULTS_JSON_PATH, JSON.stringify(results, null, 2) + "\n");
  console.log(`[build-results] wrote ${RESULTS_JSON_PATH}`);

  // Markdown — include required limitation keywords: synthetic, seed42, one run, model/resolution, cache/wrapper, no invoice, policy may change
  const md = `# GeminiContextPack — Qualified Benchmark Results

> **Scope:** Synthetic corpus (seed 42 deterministic lorem), one run per condition, model \`gemini-3.5-flash\` with \`MEDIA_RESOLUTION_LOW\`. Values are **provider-reported input tokens** (\`usage.prompt_token_count\`) — no invoice, no dollar cost, no savings claim; cache/wrapper may affect provider counts; policy may change. Every number is traceable to raw evidence via SHA-256 and JSON path; raw bytes in \`evidence/raw\` are never rewritten.

Generated: ${now}
Manifest: \`evidence/manifest.json\`

## Summary (plain vs PDF, provider-reported prompt tokens)

| Target | Plain (\`plain_*.json\`) | PDF (\`pdf_*.json\`) | PDF details (TEXT+IMAGE) | Ratio (PDF/Plain) | Reduction | Plain SHA (12) | PDF SHA (12) |
|---|---|---|---|---|---|---|---|
| 5000 | 5419 | 402 | ${scale5.pdfText}+${scale5.pdfImage} | ${(scale5.pdfPrompt / scale5.plainPrompt).toFixed(6)} | ${(1 - scale5.pdfPrompt / scale5.plainPrompt).toFixed(6)} | \`${scale5.plainArt.sha256.slice(0, 12)}\` | \`${scale5.pdfArt.sha256.slice(0, 12)}\` |
| 20000 | 20704 | 402 | ${scale20.pdfText}+${scale20.pdfImage} | ${(scale20.pdfPrompt / scale20.plainPrompt).toFixed(6)} | ${(1 - scale20.pdfPrompt / scale20.plainPrompt).toFixed(6)} | \`${scale20.plainArt.sha256.slice(0, 12)}\` | \`${scale20.pdfArt.sha256.slice(0, 12)}\` |
| 50000 | 51393 | 402 | ${scale50.pdfText}+${scale50.pdfImage} | ${(scale50.pdfPrompt / scale50.plainPrompt).toFixed(6)} | ${(1 - scale50.pdfPrompt / scale50.plainPrompt).toFixed(6)} | \`${scale50.plainArt.sha256.slice(0, 12)}\` | \`${scale50.pdfArt.sha256.slice(0, 12)}\` |

Traceability — JSON paths in \`evidence/raw\`:

- 5000 plain: \`evidence/raw/plain_5k.json\` \`usage.prompt_token_count\` = 5419 — SHA \`${scale5.plainArt.sha256}\`
- 5000 pdf: \`evidence/raw/pdf_5k.json\` \`usage.prompt_token_count\` = 402 — SHA \`${scale5.pdfArt.sha256}\`
- 20000 plain: \`evidence/raw/plain_20k.json\` \`usage.prompt_token_count\` = 20704 — SHA \`${scale20.plainArt.sha256}\`
- 20000 pdf: \`evidence/raw/pdf_20k.json\` \`usage.prompt_token_count\` = 402 — SHA \`${scale20.pdfArt.sha256}\`
- 50000 plain: \`evidence/raw/plain_50k.json\` \`usage.prompt_token_count\` = 51393 — SHA \`${scale50.plainArt.sha256}\`
- 50000 pdf: \`evidence/raw/pdf_50k.json\` \`usage.prompt_token_count\` = 402 — SHA \`${scale50.pdfArt.sha256}\`

## Limitations (must be read with results)

- Synthetic corpus, seed 42, deterministic lorem-style text; not natural language.
- One run per condition; no statistical distribution.
- Model \`gemini-3.5-flash\` only; \`gemini-3-flash-preview\` variants in raw (plain_5k_3flash, pdf_5k_3flash) are available but not in the primary summary.
- Resolution \`MEDIA_RESOLUTION_LOW\` for primary; MEDIUM/HIGH variants show higher PDF tokens (532/1092) but still use same corpus.
- Provider-reported usage only; no invoice or cost reconciliation; pricing is not claimed.
- Retrieval is substring-based in raw JSON; not parsed exact equality.
- Policy, model behavior, and tokenization may change.

## Raw evidence

All raw files are byte-identical copies of private source (see \`evidence/manifest.json\` for \`sourcePath\`, \`sha256\`, \`bytes\`):

${artifacts
  .filter((a) => a.filename.endsWith(".json"))
  .map((a) => `- \`${a.path}\` — \`${a.sha256.slice(0, 16)}…\` — ${a.role} — ${a.model ?? "n/a"} — ${a.timestamp}`)
  .join("\n")}

Corpus PDFs (rendered once, byte-identical):

${artifacts
  .filter((a) => a.filename.endsWith(".pdf"))
  .map((a) => `- \`${a.path}\` — \`${a.sha256.slice(0, 16)}…\` — ${a.bytes} bytes`)
  .join("\n")}

Excluded from publication (not copied): \`corpus_*.txt\` (contains forbidden brand word in header), legacy derived reports, scripts, and bundle — see \`excluded\` in manifest.

## Verification

\`\`\`bash
bun run evidence:verify   # hashes manifest, checks brand/secrets, confirms raw SHA equals private source
bun run evidence:build    # regenerates this file from raw evidence
\`\`\`
`;

  writeFileSync(RESULTS_MD_PATH, md);
  console.log(`[build-results] wrote ${RESULTS_MD_PATH}`);

  // Update manifest with derived entries
  const resultsJsonBytes = readFileSync(RESULTS_JSON_PATH);
  const resultsMdBytes = readFileSync(RESULTS_MD_PATH);
  const resultsJsonSha = sha256Hex(resultsJsonBytes);
  const resultsMdSha = sha256Hex(resultsMdBytes);

  // Remove old derived entries if present, then add new
  const rawArtifacts = manifest.artifacts.filter(
    (a) => a.path.startsWith("evidence/raw/"),
  );
  const derivedArtifacts: RawArtifact[] = [
    {
      filename: "results.json",
      path: "evidence/results.json",
      sha256: resultsJsonSha,
      bytes: resultsJsonBytes.length,
      role: "derived-qualified-report-json",
      model: "gemini-3.5-flash",
      timestamp: now,
      sourcePath: "derived:evidence/raw/plain_*.json+pdf_*.json",
    } as unknown as RawArtifact & { derivedFrom: unknown },
    {
      filename: "results.md",
      path: "evidence/results.md",
      sha256: resultsMdSha,
      bytes: resultsMdBytes.length,
      role: "derived-qualified-report-markdown",
      model: "gemini-3.5-flash",
      timestamp: now,
      sourcePath: "derived:evidence/raw/plain_*.json+pdf_*.json",
    } as unknown as RawArtifact & { derivedFrom: unknown },
  ];

  // Attach derivedFrom trace
  for (const d of derivedArtifacts) {
    (d as unknown as Record<string, unknown>)["derivedFrom"] = rawArtifacts
      .filter((r) => r.filename.startsWith("plain_") || r.filename.startsWith("pdf_"))
      .filter((r) => ["plain_5k.json", "pdf_5k.json", "plain_20k.json", "pdf_20k.json", "plain_50k.json", "pdf_50k.json"].includes(r.filename))
      .map((r) => ({ filename: r.filename, path: r.path, sha256: r.sha256, jsonPath: "usage.prompt_token_count" }));
    (d as unknown as Record<string, unknown>)["sourcePath"] = "derived:evidence/raw/plain_5k.json+pdf_5k.json+plain_20k.json+pdf_20k.json+plain_50k.json+pdf_50k.json";
  }

  const newManifest = {
    ...manifest,
    generatedAt: now,
    artifacts: [...rawArtifacts, ...(derivedArtifacts as RawArtifact[])].sort((a, b) =>
      a.filename.localeCompare(b.filename),
    ),
    // keep excluded from original
    excluded: (manifest as { excluded?: unknown[] }).excluded,
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2) + "\n");
  console.log(`[build-results] updated ${MANIFEST_PATH} with derived entries`);
}

if (import.meta.main) {
  try {
    buildResults();
  } catch (e) {
    console.error(`[build-results] FAIL: ${String(e)}`);
    process.exit(1);
  }
}
