# Third-Party Licenses — GeminiContextPack

This file lists the licenses of third-party components that are shipped
or bundled with `gemini-context-pack`, including runtime dependencies and
embedded font assets. The project itself is licensed under Apache-2.0
(see `LICENSE`); this file does not change that license.

| Component | Version / Source | License | Notes |
|---|---|---|---|
| Noto Sans CJK KR (Noto Sans KR) | googlefonts/noto-cjk pinned commit (assets/fonts/) | SIL Open Font License 1.1 (OFL-1.1) | Bundled TTF + OFL text in `assets/fonts/` |
| Noto Emoji | googlefonts/noto-emoji pinned commit (assets/fonts/) | SIL Open Font License 1.1 (OFL-1.1) | Bundled variable TTF + OFL text |
| pdf-lib | npm: pdf-lib | MIT | PDF generation / subsetting |
| @pdf-lib/fontkit (fontkit) | npm: @pdf-lib/fontkit / fontkit | MIT | Font parsing and subsetting |
| pdfjs-dist | npm: pdfjs-dist | Apache-2.0 | Writer-independent PDF extraction / verification |
| TypeScript | npm: typescript | Apache-2.0 | Build / type-checking (dev) |
| @biomejs/biome | npm: @biomejs/biome | MIT | Lint / format (dev) |
| bun-types | npm: bun-types | MIT | Bun type definitions (dev) |
| Bun runtime | oven-sh/bun | MIT | Runtime and test runner (not bundled in npm tarball) |

## SIL Open Font License 1.1 — Summary

Noto fonts are licensed under the SIL Open Font License 1.1.
The full OFL text is shipped alongside each font as `OFL.txt` in
`assets/fonts/`. Key terms: fonts may be used, studied, modified and
redistributed freely as long as they are not sold by themselves and the
reserved name requirements are respected.

## MIT License — Applicable to pdf-lib, fontkit, Biome, bun-types, Bun

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0 — Applicable to pdfjs-dist, TypeScript

See `LICENSE` for the canonical Apache License 2.0 text. The same license
applies to pdfjs-dist and TypeScript as distributed via npm.

---

If a new runtime or font dependency is added, this file MUST be updated
before release. CI and release audit verify that every file listed in the
`files` field of `package.json` and every committed `assets/fonts/` byte
has a corresponding entry above.
