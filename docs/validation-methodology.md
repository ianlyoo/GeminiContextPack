# Validation Methodology — GeminiContextPack

> **Disclaimer:** Not an official Google product. Not affiliated with Google. Measurements are qualified evidence only; re-verify locally.

Owner: ianlyoo — Repository: https://github.com/ianlyoo/GeminiContextPack — Version: 0.1.0

## Raw curation

- Source: private validation directory under `C:/Users/torch/Documents/code/pdftokenizer/` — `plain_*.json`, `pdf_*.json`, `corpus_*.pdf`, `corpus_*.txt`, legacy reports, bundle.
- Scan: whole-word forbidden-brand scan over filename and utf8/latin1 decoded bytes. Hits: `corpus_5k.txt`, `corpus_20k.txt`, `corpus_50k.txt` (header forbidden-brand hit) excluded with reason `forbidden-brand-content` in `evidence/manifest.json` `excluded` array. Remaining 10 JSON + 3 PDFs passed and were copied byte-identical via `copyFileSync`; legacy derived/bundle/scripts excluded with respective reasons.
- Manifest: `evidence/manifest.json` version 1, `generatedAt` ISO, `sourceRoot` absolute, `artifacts` sorted with fields `filename`, `path`, `sha256` 64-hex, `bytes`, `role` (`raw-plaintext-benchmark`/`raw-pdf-benchmark`/`raw-corpus-pdf`/`derived-qualified-report-*`), `model`, `timestamp`, `sourcePath`, `derivedFrom` (`null` for raw, array of `{filename,path,sha256,jsonPath}` for derived). `excluded` array logs every skipped file with reason/pattern.
- Derived: `evidence/results.json` and `evidence/results.md` are the only derived evidence, produced by `scripts/build-results.ts` reading `usage.prompt_token_count` from raw JSON without rewriting raw bytes. Each numeric field traces to `evidence/raw/*.json` SHA + `jsonPath`; `derivedFrom` lists six primary SHAs. See `evidence/results.json` provenance notice.

## What `bun run evidence:verify` checks

`scripts/verify-evidence.ts` is read-only (never writes source) and exits non-zero with exact `path/hash` on any failure:

1. Every manifest artifact exists on disk, `bytes` equality, `sha256` equality (file hash vs manifest), invalid SHA hex (must be 64-hex).
2. Private source equality for raw (`derivedFrom === null`): if `sourcePath` file exists, `manifest SHA == private source hash == evidence file hash` and `bytes` equality. On CI where private source is absent, check is skipped (file presence gated).
3. Forbidden-brand scan: filename and utf8/latin1 content against whole-word brand pattern; legacy bundle filenames flagged.
4. Secret patterns: `ghp_`, `gho_`, `github_pat_`, `sk-`, `AKIA`, `AIza`, `api_key =` long value — conservative; benchmark JSON with no keys passes.
5. Unmanifested file detection: every file under `evidence/raw` must be listed in manifest; extra files fail.
6. Derived derived-from tracing: `evidence/results.json` `sha256/bytes` must match file, brand/secret scanned, dollar/invoice claims flagged (negated `no invoice, no cost` exempt).
7. Legacy absence: old bundle, old scripts, old derived excluded.
8. JSON parseability for raw `.json`.
9. Numeric traceability: builder throws before writing if raw `usage.prompt_token_count` values are not exactly 5419/402/20704/402/51393/402 (prevents silent overwrite with tampered raw); after writing, manifest derived SHA/bytes are recomputed atomically.

Invoke:

```bash
bun run evidence:verify
```

## Offline benchmark

`benchmarks/offline.ts` with `benchmarks/schema.ts`:

- Corpus: `generateSeed42Corpus(target)` mulberry32 seed 42, VOCAB from private generator but spaces replaced by `_`/`-` to avoid wrap space-loss (renderer trims spaces at wrap boundaries). Sizes: 5k → 20524 chars, 20k → 80504, 50k → 200582, deterministic.
- Run: each scale via `compileContextWithBundledFonts` (bundled Noto KR + Emoji subset, manifest-verified) then `verifyContextPdf` via `pdfjs-dist` independent extraction; records `OfflineObservationRecord` (`profile`, `pageCount`, `bytes`, `canonicalHash`, `extractedHash`, `latencyMs`) plus provenance (`kind: benchmark-observation`, `id`, `observedAt`, `sourceLocator`, `rawSha256`). Semantic fields deterministic, latency isolated as non-deterministic via `deterministicProjection` stripping `latencyMs/observedAt`.
- Reproducibility: two runs match all non-latency fields (bytes 33316/95608/222410, hashes `25a99de...`/`875f827...`/`b1aab89...`, profiles `2.0/2.30` x2 and `1.4/1.61`). No network, no invoice.
- Invoke:

```bash
bun run bench:offline -- --out /tmp/offline.json
```

Second run must match first on `bytes`, `hashes`, `profiles` via `observationsDeterministicallyEqual`.

## Live smoke (opt-in)

`benchmarks/live-gemini.ts` symmetric, credential-safe:

- Defaults: `model gemini-2.5-flash`, `mediaResolution LOW`, `target 5000`, `seed 42`, `each 1 run`, `max calls 2` via capped client (`LiveSmokeCallCapError` CALL_CAP_EXCEEDED before network on 3rd).
- Symmetry: `buildGenerateContentRequest`/`buildCountTokensRequest`/`buildSymmetricContents` share identical `model`, wrapper prompt, `GenerateContentConfig {temperature 0, maxOutputTokens 8192, mediaResolution LOW}`; only `contents` differ (`plain [{text: wrapper+corpus}]` vs `pdf [inlineData pdf base64, {text: wrapper}]`).
- Gate: `shouldRunLive` requires `argv --run-live` AND `GEMINI_API_KEY.trim()` non-empty; otherwise prints exact `[live-gemini] SKIP: live smoke requires --run-live flag and GEMINI_API_KEY env — no network call` and exits 0 without constructing `GoogleGenAI` (`@google/genai@2.18.0`).
- Output: SDK version from package.json, model/config/timing `startedAt/durationMs`, `rawSha256` 64-hex of `usageMetadata` JSON, accounting via `normalizeGeminiUsage` provenance. Redaction via split `[REDACTED]` on all paths.
- Workflow `.github/workflows/live-smoke.yml` is `workflow_dispatch` only (no push/PR), env from `secrets.GEMINI_API_KEY`, conditional skip if empty.

Invoke:

```bash
# without key/flag — SKIP
bun run test:live
# with key — network
GEMINI_API_KEY=... bun run benchmarks/live-gemini.ts -- --run-live
```

Tests: `benchmarks/live-gemini.test.ts` (18 cases) proves symmetric configs, two-call cap, redaction, usage parsing; `bun test` covers fake client distinct plain/PDF records with provenance, malformed payload stops before network.

## Derived number trace

Every qualified number in README, `docs/architecture.md`, and `evidence/results.json/md` resolves to raw SHA+JSON path:

- 5419 at `evidence/raw/plain_5k.json` (`940c31d2c6f4bf1f5af3e780c9196b2782bb0593fbe96c4469cdf31c3d873111`) → `usage.prompt_token_count`
- 402 at `evidence/raw/pdf_5k.json` (`20513793f07e81a0e9a6cb2fa1ae5442f5636518293c4bdb465bfcb54aa3da54`) → `usage.prompt_token_count` (details TEXT 136 + IMAGE 266)
- 20704 / 402, 51393 / 402 analogously; ratios 0.074/0.019/0.008 and reductions 0.926/0.981/0.992 are derived arithmetic, not measured dollars.

Mutation of any raw value or file byte fails `evidence:verify` or builder `verifyRawIntegrity` before report output; derived SHA drift fails manifest check.

See `docs/accounting-and-claims.md` for kind taxonomy and `docs/responsible-use.md` for extrapolation limits.
