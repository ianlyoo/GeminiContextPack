# Accounting and Claims — GeminiContextPack

> **Disclaimer:** Not an official Google product. Not affiliated with Google. Gemini API behavior, pricing, and tokenization may change. No cost or invoice claim is made.

Owner: ianlyoo — Repository: https://github.com/ianlyoo/GeminiContextPack — License: Apache-2.0 — Version: 0.1.0 — Description: `Gemini API context optimizer using native PDF packaging — reduce reported input tokens by up to 99% in measured long-context workloads.`

## Seven kinds

All accounting records are provenance-bearing discriminated unions validated by `src/accounting/`:

| Kind | Required distinct fields | Unit |
|---|---|---|
| `estimated` | `method`, `tokens` | tokens (estimate) |
| `provider-counted` | `counterId`, `tokens` | tokens (local counter) |
| `provider-reported-usage` | `inputTokens`, `totalTokens` | tokens (provider) |
| `provider-reported-cost` | `amountMicroUsd`, `currency` | micro-USD cost |
| `pricing-snapshot` | `inputPerMillionMicroUsd`, `outputPerMillionMicroUsd`, `effectiveAt` | per-million micro-USD |
| `derived-comparison` | `baselineId`, `candidateId`, `inputRecordIds`, `roundingRule` | derived delta |
| `benchmark-observation` | `durationMs`, `repetitions`, `inputTokens` | observation |

Common required fields on every record: `id`, `observedAt` (ISO), `sourceLocator`, `rawSha256` (64-hex), plus optional `provider`/`model`. Provenance and unit are exhaustive via `never` switches.

Money is integer micro-USD: `1 USD = 1_000_000 micro-USD`. Pricing per-million micro-USD follows the same invariant (e.g., `$0.75 per 1M = 750_000 micro-USD`). Float dollars like `0.75` or `750000.5` are rejected at record creation by `assertMicroUsd`. Helper `dollarsPerMillionToMicroUsd(0.75) === 750_000`.

Derived comparisons must record `inputRecordIds` (must include `baselineId`+`candidateId`, plus `pricingSnapshotId` if priced) and `roundingRule` (`floor|ceil|nearest|trunc`); `deltaTokens` and `deltaMicroUsd` are computed but never invent missing inputs. Comparison enforces same-unit (`tokens` vs `cost` vs `pricing` etc.) and same-provenance (exact kind equality) before emitting savings; mixing `estimated` vs provider without `allowMixedProvenance` throws `MIXED_PROVENANCE`, mixing units throws `MIXED_UNIT`, comparing derived or pricing-vs-pricing throws `UNLABELED_TOTAL`.

## What each number means

- **Provider-reported usage** is `usage.prompt_token_count` (and `total_token_count`) returned by Gemini `generateContent`/`countTokens`, parsed by `normalizeGeminiUsage` from either snake (`usage.prompt_token_count`) or camel (`usageMetadata.promptTokenCount`) with modality details (`prompt_tokens_details`/`promptTokensDetails`). Example: plain 5419 vs PDF 402 (TEXT 136 + IMAGE 266 = 402). See `evidence/results.json` trace to `evidence/raw/*.json` SHA and `jsonPath`.
- **No invoice, no dollar cost, no savings claim** is made on any derived report. Raw evidence contains usage metadata but no invoice reconciliation. Derived ratios (`effective_input_ratio`, `reduction`) are computed, not measured dollars.
- Optional pricing snapshots let callers compute `deltaMicroUsd` locally from `deltaTokens * pricePerMillion / 1e6` with explicit rounding, but GeminiContextPack never asserts an invoice.

## Claim language

Qualified form (required wherever numbers appear):

> Reduce reported input tokens by up to 99% in measured long-context workloads — synthetic seed-42 lorem, one run per condition, model `gemini-2.5-flash` with `MEDIA_RESOLUTION_LOW` (MEDIUM/HIGH variants exist as 532/1092 image tokens), provider-reported input tokens only, cache/wrapper/retrieval differ between plain and PDF, no invoice, policy may change.

Unqualified forms that FAIL release audit: percentage-plus, always-percentage, guaranteed, unqualified up-to-99 without adjacent limitations within ~500 chars, invoice or dollar savings without no-invoice disclaimer, cross-provider claims, or ranking guarantees. The same claim checker used for README (`test/readme-metadata.test.ts`) is applied in `scripts/docs-check.ts`.

## Provenance example

```ts
import { normalizeGeminiUsage } from "gemini-context-pack/gemini";
// Works offline on captured payloads — no network
const raw = { usage: { prompt_token_count: 402, prompt_tokens_details: [{ modality: "TEXT", token_count: 136 }, { modality: "IMAGE", token_count: 266 }] } };
const parsed = normalizeGeminiUsage(raw, {
  id: "pdf-5k-001",
  observedAt: new Date().toISOString(),
  sourceLocator: "evidence/raw/pdf_5k.json",
  rawSha256: "20513793f07e81a0e9a6cb2fa1ae5442f5636518293c4bdb465bfcb54aa3da54",
  provider: "google-gemini",
  model: "gemini-2.5-flash",
});
if (parsed.ok) {
  console.log(parsed.record.kind); // "provider-reported-usage"
  console.log(parsed.record.inputTokens); // 402
}
```

Every `GeminiUsageRecord` carries `kind`, `id`, `observedAt`, `sourceLocator`, `rawSha256`, `provider`, `model`. Modality details preserve IMAGE token counts 266/532/1092 for LOW/MEDIUM/HIGH.

## Verification

- `bun run evidence:verify` checks SHA/bytes, brand, secrets, unmanifested files, derived number traceability.
- `bun test src/accounting` covers one fixture per kind, exhaustive switches, `$0.75/1M=750000`, happy comparison (20704 vs 402 with pricing nearest → delta 20302, deltaMicro 15227) and failure (estimate vs provider without flag, float dollar).
- `bun run typecheck` enforces exhaustive `never` on all seven kinds.

See `docs/validation-methodology.md` for raw-to-derived traceability and `docs/responsible-use.md` for usage guidance.
