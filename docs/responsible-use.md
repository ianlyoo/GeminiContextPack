# Responsible Use — GeminiContextPack

> **Disclaimer:** Not an official Google product. Not affiliated with Google. Gemini API behavior, pricing, and tokenization may change. Reported input tokens are not invoices.

Owner: ianlyoo — Repository: https://github.com/ianlyoo/GeminiContextPack — License: Apache-2.0 — Version: 0.1.0

## What this tool does and does not do

- **Does:** Compile explicitly designated passive context strings into a verified PDF artifact (`gemini-context-pack-v1`) and attach it as `inlineData: application/pdf` for Gemini `generateContent`/`countTokens` with provenance-bearing usage parsing.
- **Does not:** Intercept arbitrary SDK requests, move system/developer/current-task instructions automatically, act as a hosted proxy/service, or provide invoice/cost guarantees. It is not a system prompt injector.

## Measure your own workload

Evidence is limited to: synthetic seed-42 deterministic lorem with payload (not natural language); one run per condition; model `gemini-2.5-flash` primary with `MEDIA_RESOLUTION_LOW` (MEDIUM/HIGH variants preserved as 532/1092 image tokens); provider-reported input tokens only (`usage.prompt_token_count`); cache/wrapper/retrieval differ between plain and PDF; no invoice data.

Do not extrapolate the `up to 99%` qualified reduction beyond that setup. Always include the adjacent limitations when sharing numbers:

> Synthetic corpus seed 42, one run per condition, model `gemini-2.5-flash` with `MEDIA_RESOLUTION_LOW`, wrapper/cache may affect provider counts, retrieval is substring match, no invoice or dollar cost, policy may change.

Example local measurement:

```ts
import { compileContextWithBundledFonts } from "gemini-context-pack/node";
import { toGeminiInlinePart, normalizeGeminiUsage } from "gemini-context-pack/gemini";
import { GoogleGenAI } from "@google/genai";

const source = "your corpus to pack";
const artifact = await compileContextWithBundledFonts(source);
const part = toGeminiInlinePart(artifact);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const res = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [part, { text: "Use the attached context to answer: ..." }] }],
  config: { temperature: 0, maxOutputTokens: 8192, mediaResolution: "MEDIA_RESOLUTION_LOW" as const },
});
// Parse with provenance — snake and camel both accepted
const parsed = normalizeGeminiUsage((res as unknown as { usageMetadata: unknown }).usageMetadata, {
  id: "live-pdf-001",
  observedAt: new Date().toISOString(),
  sourceLocator: "live:gemini-2.5-flash:pdf",
  rawSha256: "0000000000000000000000000000000000000000000000000000000000000000",
  provider: "google-gemini",
  model: "gemini-2.5-flash",
});
```

Compare the same wrapper prompt with plain `contents: [{text: wrapper + source}]` vs PDF `inlineData` while keeping `model`/`config` identical.

## Keep control-plane text separate

Preserve system/developer/current-task text as control-plane input; package only the passive context you explicitly designate. Do not flatten conversation roles into the artifact. If your application uses system instructions or tool definitions, send them outside the PDF part.

## Content policy

Do not use this tool to package disallowed content or to attempt to evade model safety filters. You remain responsible for compliance with Gemini API terms, content policies, and applicable law. Verify extraction (`verifyContextPdf`) before sending; on `INTEGRITY_MISMATCH`, do not send the artifact.

## Limitations to disclose

When sharing results, include:

- Corpus nature: synthetic deterministic lorem (not natural language), mulberry32 seed 42.
- Statistical: one run per condition, no distribution.
- Model/config: `gemini-2.5-flash`, `MEDIA_RESOLUTION_LOW` (state if you used MEDIUM/HIGH).
- Counts: provider-reported input tokens only (`usage.prompt_token_count`), modality details if available.
- Wrapper: note that plain vs PDF wrappers/caching differ and may affect counts.
- Cost: no invoice, no dollar cost, no savings claim; pricing snapshots are local snapshots, not invoices.
- Future: policy, model behavior, pricing, tokenization may change; re-measure.

## Security and integrity

- `compileContext` requires caller-provided `fonts` (use `compileContextWithBundledFonts` for the pinned Noto bundle); unsupported glyphs (`UNSUPPORTED_GLYPH`), malformed PDFs (`MALFORMED_PDF`), page-budget overflow (`PAGE_BUDGET_EXCEEDED`), and extraction mismatch (`INTEGRITY_MISMATCH`) fail closed with typed `ContextPackError` and never return a partial artifact.
- Verify locally: `bun run evidence:verify` and `bun run bench:offline -- --out /tmp/offline.json` work offline without API keys.
- Do not commit secrets (`GEMINI_API_KEY`, `ghp_`, `AIza`, `sk-`, etc.) to source, logs, or evidence; live smoke redacts keys via `[REDACTED]`.
- Vulnerability reports: use GitHub private vulnerability reporting (see `SECURITY.md`); do not use email.

## Discoverability note

Topics and description are for search accuracy, not ranking guarantees. No artificial stars, keyword stuffing, or featured-topic spam. See `docs/architecture.md` Section I.

*If you publish benchmark numbers from this tool, include the limitations paragraph above and link to `evidence/manifest.json` and `evidence/results.json` for traceability.*
