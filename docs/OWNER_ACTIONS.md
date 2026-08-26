# Owner Actions — Social Preview and Profile

This document records manual owner actions that cannot be automated via the GitHub API (browser upload).

## 1. Repository social preview (Settings → General → Social preview)

> Reference: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview

- **Committed image:** `docs/assets/social-preview.png` — 1280×640 PNG, <1MiB, solid `#0f172a` background, high contrast, deterministic SHA (rebuild via `bun run social-preview:build`).
- **Pages canonical URL:** `https://ianlyoo.github.io/GeminiContextPack/assets/social-preview.png`
- **Remaining owner step (browser):** Repository → **Settings → General → Social preview → Edit → Upload an image** → upload the committed `docs/assets/social-preview.png`. The Settings UI crops to 1280×640; the committed file already matches exactly.

### Verification

After upload, verify via API and browser:

```bash
# API: check opengraphImageUrl is set (may take minutes to populate after upload)
gh api repos/ianlyoo/GeminiContextPack --jq .description
# Pages OG should serve the committed image directly
curl -fsSL https://ianlyoo.github.io/GeminiContextPack/ | grep -o 'og:image[^>]*content="[^"]*"'
# Expect: https://ianlyoo.github.io/GeminiContextPack/assets/social-preview.png

# Raw or Pages fetch should return 1280x640 PNG <1MiB
curl -fsSL https://ianlyoo.github.io/GeminiContextPack/assets/social-preview.png -o /tmp/social.png
# Inspect
python -c "import struct; b=open('/tmp/social.png','rb').read(); print(struct.unpack('>II', b[16:24]))"
# Expect (1280, 640)
ls -l /tmp/social.png  # < 1_048_576 bytes
```

Browser verification: open `https://github.com/ianlyoo/GeminiContextPack` — social preview should show the uploaded image on hover / when sharing link on social networks. GitHub caches the preview; allow up to ~30 minutes for propagation.

## 2. Optional: Profile pin (personal profile)

- Pin the repository to your GitHub profile: Profile → **Customize your pins** → select `ianlyoo/GeminiContextPack`.

### Verification

```bash
gh api users/ianlyoo --jq .login
# Manual browser check: https://github.com/ianlyoo — pinned section shows GeminiContextPack
```

## Source reproducibility

- Template: `docs/social-preview.html` (deterministic, 1280×640, approved copy only: name + positioning + measured-not-guaranteed cue).
- Build: `bun run social-preview:build` (sharp SVG→PNG by default; optional `--playwright` flag for Playwright screenshot of the same HTML).
- Test: `bun test test/social-preview.test.ts` asserts dimensions, size, deterministic SHA, valid OG URL, no old brand, no unqualified claim.
