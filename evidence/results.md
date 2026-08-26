# GeminiContextPack — Qualified Benchmark Results

> **Scope:** Synthetic corpus (seed 42 deterministic lorem), one run per condition, model `gemini-3.5-flash` with `MEDIA_RESOLUTION_LOW`. Values are **provider-reported input tokens** (`usage.prompt_token_count`) — no invoice, no dollar cost, no savings claim; cache/wrapper may affect provider counts; policy may change. Every number is traceable to raw evidence via SHA-256 and JSON path; raw bytes in `evidence/raw` are never rewritten.

Generated: 2026-08-26T07:51:39.459Z
Manifest: `evidence/manifest.json`

## Summary (plain vs PDF, provider-reported prompt tokens)

| Target | Plain (`plain_*.json`) | PDF (`pdf_*.json`) | PDF details (TEXT+IMAGE) | Ratio (PDF/Plain) | Reduction | Plain SHA (12) | PDF SHA (12) |
|---|---|---|---|---|---|---|---|
| 5000 | 5419 | 402 | 136+266 | 0.074183 | 0.925817 | `21f959a24c2d` | `14e4c9c71752` |
| 20000 | 20704 | 402 | 136+266 | 0.019417 | 0.980583 | `4fd9f7bd9b7b` | `1679ec1a758b` |
| 50000 | 51393 | 402 | 136+266 | 0.007822 | 0.992178 | `6083aa4386a2` | `1831dc9512a4` |

Traceability — JSON paths in `evidence/raw`:

- 5000 plain: `evidence/raw/plain_5k.json` `usage.prompt_token_count` = 5419 — SHA `21f959a24c2d926824d05ffef38dc09a36dc40496beaa62b912ec2a94cb3907c`
- 5000 pdf: `evidence/raw/pdf_5k.json` `usage.prompt_token_count` = 402 — SHA `14e4c9c717523452a684d179ad78c9fb82c7f37a9e4504ed5efef2959b9750d7`
- 20000 plain: `evidence/raw/plain_20k.json` `usage.prompt_token_count` = 20704 — SHA `4fd9f7bd9b7bf4fea5e7a8659c5011546081b00fa1f645824164a4f6b6238435`
- 20000 pdf: `evidence/raw/pdf_20k.json` `usage.prompt_token_count` = 402 — SHA `1679ec1a758ba2a557f6afddc7ca71ade9c48c5ed5b3bb52d68b87ef914fc9fc`
- 50000 plain: `evidence/raw/plain_50k.json` `usage.prompt_token_count` = 51393 — SHA `6083aa4386a269380deb7da52d22bdf650e96fd3052c02e2d514d4d3e0eae04f`
- 50000 pdf: `evidence/raw/pdf_50k.json` `usage.prompt_token_count` = 402 — SHA `1831dc9512a4ca346f19204114b56ddbabc688d6bf733018c5c8d1a74da9c450`

## Limitations (must be read with results)

- Synthetic corpus, seed 42, deterministic lorem-style text; not natural language.
- One run per condition; no statistical distribution.
- Model `gemini-3.5-flash` only; `gemini-3-flash-preview` variants in raw (plain_5k_3flash, pdf_5k_3flash) are available but not in the primary summary.
- Resolution `MEDIA_RESOLUTION_LOW` for primary; MEDIUM/HIGH variants show higher PDF tokens (532/1092) but still use same corpus.
- Provider-reported usage only; no invoice or cost reconciliation; pricing is not claimed.
- Retrieval is substring-based in raw JSON; not parsed exact equality.
- Policy, model behavior, and tokenization may change.

## Raw evidence

All raw files are byte-identical copies of private source (see `evidence/manifest.json` for `sourcePath`, `sha256`, `bytes`):

- `evidence/raw/pdf_20k.json` — `1679ec1a758ba2a5…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:42:14.466707
- `evidence/raw/pdf_50k.json` — `1831dc9512a4ca34…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:42:37.412925
- `evidence/raw/pdf_5k_3flash.json` — `e72d852208440db1…` — raw-pdf-benchmark — gemini-3-flash-preview — 2026-08-25T08:43:04.009320
- `evidence/raw/pdf_5k_high.json` — `114c0d6c8b0f9ee2…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:43:22.693548
- `evidence/raw/pdf_5k_medium.json` — `2542c3352eae35df…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:43:28.908793
- `evidence/raw/pdf_5k.json` — `14e4c9c717523452…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:41:52.328368
- `evidence/raw/plain_20k.json` — `4fd9f7bd9b7bf4fe…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:42:04.511988
- `evidence/raw/plain_50k.json` — `6083aa4386a26938…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:42:25.348031
- `evidence/raw/plain_5k_3flash.json` — `1b5309143c250b83…` — raw-plaintext-benchmark — gemini-3-flash-preview — 2026-08-25T08:43:11.279832
- `evidence/raw/plain_5k.json` — `21f959a24c2d9268…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:41:46.036652
- `evidence/results.json` — `e725a4f430405f7d…` — derived-qualified-report-json — gemini-3.5-flash — 2026-08-25T17:39:13.500Z

Corpus PDFs (rendered once, byte-identical):

- `evidence/raw/corpus_20k.pdf` — `2984e7712617b81d…` — 32988 bytes
- `evidence/raw/corpus_50k.pdf` — `726c45e9863482a7…` — 76241 bytes
- `evidence/raw/corpus_5k.pdf` — `5e44d91f7fc40aea…` — 10053 bytes

Excluded from publication (not copied): `corpus_*.txt` (contains forbidden brand word in header), legacy derived reports, scripts, and bundle — see `excluded` in manifest.

## Verification

```bash
bun run evidence:verify   # hashes manifest, checks brand/secrets, confirms raw SHA equals private source
bun run evidence:build    # regenerates this file from raw evidence
```
