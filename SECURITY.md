# Security Policy

> **Disclaimer:** Not an official Google product. Not affiliated with Google.

Owner: ianlyoo — Repository: https://github.com/ianlyoo/GeminiContextPack — License: Apache-2.0

## Supported versions

| Version | Supported |
|---|---|
| 0.1.0 | Yes |

Only the latest `0.1.0` release is supported. Older tags are not maintained.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.** Do not use email.

Use **GitHub private vulnerability reporting** for this repository:

1. Go to https://github.com/ianlyoo/GeminiContextPack/security/advisories/new
   (or `Security → Report a vulnerability` on the repository page).
2. Fill in the advisory form: summary, impact, affected versions, reproduction steps, and any proof-of-concept. Attach `evidence/manifest.json` commit SHA or `package.json` version if relevant.
3. Submit. Maintainers receive a private advisory and will respond via the same channel.

What to expect:

- Acknowledgment within 3 business days via the private advisory thread.
- Triage and impact assessment promptly; a fix timeline shared in the advisory.
- Coordinated disclosure: a fix and `SECURITY.md`/`CHANGELOG.md` advisory published together; you will be credited if desired.

If GitHub private reporting is unavailable to you, open a draft security advisory via the same URL — GitHub will still route it privately. Do not publish details elsewhere until a fix is released.

## Scope

This policy covers the `gemini-context-pack` package, CLI, bundled fonts, and evidence tooling. Out of scope: third-party services (Gemini API, GitHub itself) — report those to their vendors.

## Handling

- Do not include secrets (`GEMINI_API_KEY`, `ghp_`, `AIza`, `sk-`, etc.) in reports, logs, or public comments. Live smoke redaction (`[REDACTED]`) is the project convention.
- Maintain typed-failure contracts: integrity (`INTEGRITY_MISMATCH`), malformed PDF (`MALFORMED_PDF`), and related guards are part of normal operation and are tested in `bun test`.
- See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` for general contribution guidelines.

*Private vulnerability reporting must be enabled via the GitHub REST endpoint for this repository; maintainers enable it as part of publication (`gh api` check in `scripts/docs-check.ts`).*
