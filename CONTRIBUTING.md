# Contributing to GeminiContextPack

> **Disclaimer:** Not an official Google product. Not affiliated with Google.

Owner: ianlyoo — Repository: https://github.com/ianlyoo/GeminiContextPack — License: Apache-2.0 — Version: 0.1.0

Thank you for considering a contribution. This document describes how to contribute effectively and what the project expects.

## Code of Conduct

This project adheres to the Contributor Covenant Code of Conduct. See `CODE_OF_CONDUCT.md` for the full text, enforcement, and attribution.

## Getting started

- **Issues:** https://github.com/ianlyoo/GeminiContextPack/issues
- **Discussions:** https://github.com/ianlyoo/GeminiContextPack/discussions (if enabled)
- **License:** Apache-2.0 — see `LICENSE` and `THIRD_PARTY_LICENSES.md`.

### Prerequisites

- `node >=18`, `bun >=1`
- No API key or network required for offline checks.

### Local setup

```bash
git clone https://github.com/ianlyoo/GeminiContextPack.git
cd GeminiContextPack
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun test
bun run evidence:verify
bun run bench:offline -- --out /tmp/offline.json
bun run docs:check
```

All of the above must exit 0 before a pull request.

## How to contribute

1. **Find or file an issue.** For bugs, use the bug report template; for features, use the feature request template (`.github/ISSUE_TEMPLATE/`). Include reproduction steps and expected behavior.
2. **Discuss before large changes.** For new features, API changes, or dependency additions, open a feature request first to avoid wasted work.
3. **Branch and commit.** Use a descriptive branch name (`fix/verify-trim`, `feat/layout-profile`). Write commits with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).
4. **Keep scope narrow.** One concern per pull request. Do not mix formatting, refactoring, and feature work.
5. **Include tests.** TDD is expected: add a failing test that reproduces the bug or specifies the new behavior, then make it pass.
6. **Update docs.** If your change affects behavior, update the relevant doc under `docs/` and, if needed, `README.md`/`README.ko.md`.

## Pull request checklist

Before marking ready for review, verify:

- [ ] `bun run lint && bun run typecheck && bun test && bun run build` pass
- [ ] `bun run evidence:verify` passes (no manifest/brand drift)
- [ ] `bun run bench:offline -- --out /tmp/offline.json` passes (two runs deterministically equal ignoring latency)
- [ ] `bun run docs:check` passes (A–J order, metadata cross-file equality, no placeholders/brands/unsupported claims, snippets typecheck)
- [ ] No secrets, credentials, or placeholder markers introduced
- [ ] No forbidden-brand whole-word introduction
- [ ] New dependencies added to `THIRD_PARTY_LICENSES.md` with license, and `assets/fonts/manifest.json` updated if fonts change
- [ ] Describe testing performed and link to related issue

Template: `.github/PULL_REQUEST_TEMPLATE.md`.

## Coding guidelines

- **TypeScript strict:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`. No `any`, `as unknown` only where justified, no `@ts-ignore`.
- **Exhaustive switches:** Every discriminated union must handle all variants with `assertNever` in the default.
- **Typed errors:** Use `ContextPackError` with `ContextPackErrorCode`; do not return partial artifacts on failure.
- **Fail-closed:** Unsupported glyphs, malformed PDFs, page-budget overflow, extraction mismatch must throw or report typed failure, never silent success.
- **Determinism:** Dates/metadata fixed (`2023-01-01T00:00:00.000Z`), `useObjectStreams:false`; no `Math.random` in core paths unless seeded and documented.
- **Module LOC:** Hand-written pure modules must stay small (see `src/pdf/layout.test.ts` LOC gate); extract helpers rather than growing files.
- **No runtime CDN:** Fonts are vendored pinned bytes under `assets/fonts/`; do not fetch fonts at runtime.

## Evidence and claims

- Do not edit `evidence/raw/` bytes or `evidence/manifest.json` by hand except via `scripts/build-results.ts` / `scripts/vendor-fonts.ts`.
- Any numeric claim about reported input tokens must be adjacent to limitations: synthetic seed 42, one run per condition, model `gemini-2.5-flash` with `MEDIA_RESOLUTION_LOW`, provider-reported input tokens only, no invoice/cost, wrapper/cache may affect counts.
- Unqualified percentage-plus, always, guaranteed, invoice, or ranking claims are rejected by `docs:check` and release audit.

## Reporting security issues

Do not use issues for vulnerabilities. Use GitHub private vulnerability reporting (see `SECURITY.md`).

## License agreement

By contributing, you agree that your contributions are licensed under the Apache License 2.0 (see `LICENSE`). You certify that you have the right to submit the contribution under that license.

## Release process (maintainers)

Only maintainers publish:

- `npm pack` artifact with `files` allowlist; no `npm publish` to the registry.
- Annotated `v0.1.0` tag and GitHub Release via `gh release create` with checksums.
- Pages and metadata via `gh repo edit` and `gh api` (topics, description, Pages).
- Owner-only: social-preview Settings upload.

See `docs/architecture.md` sections H–J for clean-room and release gates.
