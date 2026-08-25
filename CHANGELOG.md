# Changelog

All notable changes to `gemini-context-pack` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Disclaimer:** Not an official Google product. Not affiliated with Google.

## [0.1.0] — 2026-08-25

### Added

- TypeScript ESM package `gemini-context-pack@0.1.0` (Apache-2.0) with exports `.` (`compileContext`, `verifyContextPdf`, `VerifiedArtifact`), `./node` (`compileContextWithBundledFonts`, `loadBundledFonts`), `./gemini` (`toGeminiInlinePart`, `normalizeGeminiUsage`), `./accounting` (seven provenance-bearing kinds, micro-USD comparison). CLI `gemini-context-pack` with `compile`/`verify`/`inspect` commands.
- Reversible canonicalization `gemini-context-pack-v1` (CRLF/CR→LF + NFC, whitespace preserved) with JSON transport and SHA-256 over canonical source; typed `ContextPackError` codes (INVALID_CONTEXT, UNSUPPORTED_GLYPH, PAGE_BUDGET_EXCEEDED, MALFORMED_PDF, INTEGRITY_MISMATCH, PDF_LIMIT_EXCEEDED, etc.) and private verified brand.
- Pinned offline fonts: Noto Sans CJK KR Regular and Noto Emoji Variable TTF under `assets/fonts/` with `manifest.json` (immutable commit URLs, SHA-256, bytes, OFL), `scripts/vendor-fonts.ts` verifier; no runtime CDN.
- Deterministic Unicode layout: `Intl.Segmenter` grapheme clustering, per-codepoint font coverage, zero-width format handling, word-aware wrapping, adaptive 4-col A4 profiles `2.0/1.8/1.4/1.0/0.8`; `pdf-lib`/`fontkit` rendering with `ActualText` per line, Type3 format font/ToUnicode, fixed dates, `useObjectStreams:false`.
- Writer-independent extraction via `pdfjs-dist` legacy (64MiB/32-page guard, draw-order join, EOL stripped) and strict verification by SHA equality only.
- Fail-closed orchestration `validate → canonicalize → coverage/layout → render → extract/hash → brand` with no partial artifact, no global cache, no verification bypass.
- Narrow Gemini adapter: `toGeminiInlinePart` (verified artifact only) and `normalizeGeminiUsage` (snake/camel, modality details TEXT/IMAGE 266/532/1092 for LOW/MEDIUM/HIGH) with provenance-bearing records.
- Seven-kind accounting: `estimated`, `provider-counted`, `provider-reported-usage`, `provider-reported-cost`, `pricing-snapshot`, `derived-comparison`, `benchmark-observation` with integer micro-USD, same-unit/provenance comparison, and exhaustive switches.
- Curated immutable evidence: `evidence/raw/*.json` + `corpus_*.pdf` byte-identical with `evidence/manifest.json` (SHA, bytes, role, sourcePath, derivedFrom), `scripts/verify-evidence.ts` and `evidence/results.json/md` derived tracing 5419/402, 20704/402, 51393/402 (TEXT 136 + IMAGE 266) to raw SHA.
- Offline benchmark `benchmarks/offline.ts` (seed-42 `_`/`-` corpora, deterministic semantic fields) and opt-in symmetric live smoke `benchmarks/live-gemini.ts` (`--run-live` + `GEMINI_API_KEY`, max 2 calls, `workflow_dispatch` only, redaction).
- Bilingual README (`README.md` ↔ `README.ko.md`), H1 `GeminiContextPack`, exact approved description, native-PDF/Gemini/long-context headings, CI/Apache-2.0/v0.1.0/Pages badges, GitHub Release tarball install, qualified benchmark with adjacent limitations.
- Docs A–J (`docs/architecture.md`), `docs/accounting-and-claims.md`, `docs/validation-methodology.md`, `docs/responsible-use.md` with Google non-official disclaimer and limitations disclosure.
- Community health: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 attribution), `SECURITY.md` via GitHub private vulnerability reporting, `LICENSE` (Apache-2.0), `NOTICE`, `THIRD_PARTY_LICENSES.md`.
- GitHub templates: `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`.
- Metadata: `CITATION.cff` and `codemeta.json` with owner `ianlyoo`, version `0.1.0`, license `Apache-2.0`, exact description/keywords/URLs matching `package.json`.
- Tooling: `scripts/docs-check.ts` (`bun run docs:check`) parsing Markdown/YAML/JSON and asserting A–J order, cross-file equality, templates, no placeholders/brands/unsupported claims, and snippet typecheck; `scripts/vendor-fonts.ts`, `scripts/build-results.ts`, `scripts/verify-evidence.ts`.


[0.1.0]: https://github.com/ianlyoo/GeminiContextPack/releases/tag/v0.1.0
