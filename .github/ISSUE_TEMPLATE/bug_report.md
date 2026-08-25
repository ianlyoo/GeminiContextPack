---
name: Bug report
about: Report a reproducible bug in GeminiContextPack
labels: bug
---

> **Disclaimer:** Not an official Google product. Not affiliated with Google.

**Describe the bug**

A clear description of what happened vs what you expected.

**Reproduction**

```ts
// Minimal snippet or CLI invocation — must run offline if possible
import { compileContextWithBundledFonts } from "gemini-context-pack/node";
const artifact = await compileContextWithBundledFonts("hello world — deterministic example");
```

Or CLI:

```bash
echo "hello world — deterministic example" > input.txt
node ./dist/cli.js compile --input input.txt --output out.pdf
node ./dist/cli.js verify --pdf out.pdf --source input.txt
```

Steps, input, expected `canonicalizationId: "gemini-context-pack-v1"` / `canonicalHash` / `pageCount`.

**Environment**

- `gemini-context-pack` version: `0.1.0` (or commit SHA)
- `node --version` / `bun --version` / OS:
- Command: `compile` / `verify` / `inspect` / API:

**Evidence**

- `bun run evidence:verify` output (if relevant):
- `evidence/manifest.json` commit SHA (if touching evidence):
- Logs: paste failure JSON (stderr) with `code`/`message` — redact secrets (`GEMINI_API_KEY`, `ghp_`, `AIza`, `sk-`).

**Limitations check**

- [ ] I checked `docs/validation-methodology.md` and `evidence/results.json` traceability; this is not a synthetic/limitation misunderstanding (seed 42, one run, `gemini-2.5-flash`/`MEDIA_RESOLUTION_LOW`, provider-reported tokens only, no invoice).

**Additional context**

Links, screenshots, or `verifyContextPdf` report.
