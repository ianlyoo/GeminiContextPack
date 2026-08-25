> **Disclaimer:** Not an official Google product. Not affiliated with Google.

## Summary

<!-- One-sentence description of the change and why it is needed. Link to issue: Fixes #<id> -->

## Changes

- 
- 

## Verification

- [ ] `bun run lint && bun run typecheck && bun test && bun run build`
- [ ] `bun run evidence:verify`
- [ ] `bun run bench:offline -- --out /tmp/offline.json` (two runs deterministically equal ignoring latency)
- [ ] `bun run docs:check` (A–J order, metadata cross-file equality, no placeholders/brands/unsupported claims, snippets typecheck)
- [ ] No secrets or placeholder markers introduced
- [ ] `THIRD_PARTY_LICENSES.md` and `assets/fonts/manifest.json` updated if dependencies/fonts changed

## Evidence and claims

- [ ] Any numeric claim about reported input tokens is adjacent to limitations: synthetic seed 42, one run per condition, model `gemini-2.5-flash` with `MEDIA_RESOLUTION_LOW`, provider-reported input tokens only, no invoice/cost, wrapper/cache may affect counts.

## Docs

- [ ] Updated `docs/` and, if needed, `README.md` / `README.ko.md`.

## Additional notes

<!-- Screenshots, risk, follow-ups -->
