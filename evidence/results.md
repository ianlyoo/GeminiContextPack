# GeminiContextPack — Qualified Benchmark Results

> **Scope:** Synthetic corpus (seed 42), one run per condition, model `gemini-3.5-flash` with `MEDIA_RESOLUTION_LOW`. Values are **provider-reported input tokens** (`usage.prompt_token_count`) — no invoice, no dollar cost, no savings claim. Every number is traceable to raw evidence via SHA-256 and JSON path; raw bytes in `evidence/raw` are never rewritten.

Generated: 2026-08-25T15:42:59.357Z
Manifest: `evidence/manifest.json`

## Summary (plain vs PDF, provider-reported prompt tokens)

| Target | Plain (`plain_*.json`) | PDF (`pdf_*.json`) | PDF details (TEXT+IMAGE) | Ratio (PDF/Plain) | Reduction | Plain SHA (12) | PDF SHA (12) |
|---|---|---|---|---|---|---|---|
| 5000 | 5419 | 402 | 136+266 | 0.074183 | 0.925817 | `940c31d2c6f4` | `20513793f07e` |
| 20000 | 20704 | 402 | 136+266 | 0.019417 | 0.980583 | `bf24aadd77e5` | `0ac77f528c6d` |
| 50000 | 51393 | 402 | 136+266 | 0.007822 | 0.992178 | `0bc18322c261` | `db2b25ea3e59` |

Traceability — JSON paths in `evidence/raw`:

- 5000 plain: `evidence/raw/plain_5k.json` `usage.prompt_token_count` = 5419 — SHA `940c31d2c6f4bf1f5af3e780c9196b2782bb0593fbe96c4469cdf31c3d873111`
- 5000 pdf: `evidence/raw/pdf_5k.json` `usage.prompt_token_count` = 402 — SHA `20513793f07e81a0e9a6cb2fa1ae5442f5636518293c4bdb465bfcb54aa3da54`
- 20000 plain: `evidence/raw/plain_20k.json` `usage.prompt_token_count` = 20704 — SHA `bf24aadd77e5618514abebf3338c2360ee252a635c94bceb6f92b2821eea5be3`
- 20000 pdf: `evidence/raw/pdf_20k.json` `usage.prompt_token_count` = 402 — SHA `0ac77f528c6dbb4e6220b6b3c27f9a98c0677ab882221fabe6a4b132481abca4`
- 50000 plain: `evidence/raw/plain_50k.json` `usage.prompt_token_count` = 51393 — SHA `0bc18322c2618a85f17e476dcf544e62a76240ebc2c03941d423d6e87365686c`
- 50000 pdf: `evidence/raw/pdf_50k.json` `usage.prompt_token_count` = 402 — SHA `db2b25ea3e5935c93d6946c400d086eae7a143e5eea9bb5262d871760866ef98`

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

- `evidence/raw/pdf_20k.json` — `0ac77f528c6dbb4e…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:42:14.466707
- `evidence/raw/pdf_50k.json` — `db2b25ea3e5935c9…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:42:37.412925
- `evidence/raw/pdf_5k_3flash.json` — `0f3f9d95dd807db9…` — raw-pdf-benchmark — gemini-3-flash-preview — 2026-08-25T08:43:04.009320
- `evidence/raw/pdf_5k_high.json` — `f726b048fac95454…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:43:22.693548
- `evidence/raw/pdf_5k_medium.json` — `9854cd9b21d74430…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:43:28.908793
- `evidence/raw/pdf_5k.json` — `20513793f07e81a0…` — raw-pdf-benchmark — gemini-3.5-flash — 2026-08-25T08:41:52.328368
- `evidence/raw/plain_20k.json` — `bf24aadd77e56185…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:42:04.511988
- `evidence/raw/plain_50k.json` — `0bc18322c2618a85…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:42:25.348031
- `evidence/raw/plain_5k_3flash.json` — `f23b5d6f813a10bb…` — raw-plaintext-benchmark — gemini-3-flash-preview — 2026-08-25T08:43:11.279832
- `evidence/raw/plain_5k.json` — `940c31d2c6f4bf1f…` — raw-plaintext-benchmark — gemini-3.5-flash — 2026-08-25T08:41:46.036652
- `evidence/results.json` — `8881537266c24d3e…` — derived-qualified-report-json — gemini-3.5-flash — 2026-08-25T15:39:12.640Z

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
