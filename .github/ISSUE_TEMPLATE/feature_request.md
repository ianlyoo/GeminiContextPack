---
name: Feature request
about: Suggest an enhancement for GeminiContextPack
labels: enhancement
---

> **Disclaimer:** Not an official Google product. Not affiliated with Google.

**Summary**

One-sentence problem statement and proposed outcome.

**Motivation / use case**

- Target workload (long-context corpus, multi-doc, retrieval-augmented):
- Why the current API/CLI/docs are insufficient:

**Proposed change**

- API/CLI surface (e.g., `compileContext` option, `verify` flag, docs section):
- Alternatives you considered:
- Do you need a new provider beyond the narrow Gemini adapter (`toGeminiInlinePart` / `normalizeGeminiUsage`)? If so, why it cannot stay out-of-scope:

**Scope guard**

- [ ] This does not require moving system/developer/current-task instructions automatically, a hosted proxy/service, or a generic provider framework.
- [ ] This does not introduce runtime CDN/font fetch, secrets in evidence, or unqualified percentage-plus or guarantee claims.

**Verification plan**

- Tests you expect (`bun test`, `bun run evidence:verify`, `bun run bench:offline`, `bun run docs:check`):
- Evidence traceability impact (manifest SHA, `evidence/results.json`):

**Additional context**

Links, prior issues, or `docs/architecture.md` A–J section reference.
