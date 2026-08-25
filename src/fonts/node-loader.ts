/**
 * Node-only loader for vendored OFL fonts.
 * Reads committed bytes from assets/fonts via fs — never fetches/CDN at runtime.
 * Exposed via `gemini-context-pack/node`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileContext } from "../index.js";
import type { FontBundle, VerifiedArtifact } from "../types.js";
import type { BundledCompileOptions, BundledFontManifest } from "./types.js";

// Resolve fonts directory relative to this file (works both in src/ and dist/).
function resolveFontsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "assets", "fonts"), // dist/fonts -> root/assets/fonts
    join(here, "..", "assets", "fonts"), // dist -> root/assets/fonts (fallback)
    join(here, "../../assets/fonts"), // src/fonts -> root/assets/fonts
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  // Last resort: src path from dist
  const fallback = join(here, "..", "..", "assets", "fonts");
  return fallback;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let cached: FontBundle | null = null;

/**
 * Load bundled font bytes from committed assets/fonts.
 * Verifies SHA-256 against manifest offline; throws deterministically on mismatch.
 * No network, no CDN.
 */
export function loadBundledFonts(): FontBundle {
  if (cached) return cached;

  const fontsDir = resolveFontsDir();
  const manifestPath = join(fontsDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`fonts manifest missing: ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BundledFontManifest;

  // Validate OFL presence (bytes check)
  const oflPath = join(fontsDir, manifest.licenseFile ?? "OFL.txt");
  if (!existsSync(oflPath)) throw new Error(`OFL missing: ${oflPath}`);
  const oflBytes = readFileSync(oflPath);
  if (!oflBytes.toString("utf8").includes("SIL OPEN FONT LICENSE")) {
    throw new Error("OFL.txt missing license header");
  }
  if (manifest.licenseSha256) {
    const got = sha256Hex(oflBytes);
    if (got !== manifest.licenseSha256)
      throw new Error(`OFL SHA mismatch: expected ${manifest.licenseSha256}, got ${got}`);
  }

  const findEntry = (filename: string) => manifest.fonts.find((f) => f.filename === filename);
  const regularEntry = findEntry("NotoSansKR-Regular.ttf");
  if (!regularEntry) throw new Error("manifest missing NotoSansKR-Regular.ttf entry");
  const emojiEntry = findEntry("NotoEmoji-Variable.ttf");

  const loadOne = (entry: typeof regularEntry): Uint8Array => {
    const p = join(fontsDir, entry.filename);
    if (!existsSync(p)) throw new Error(`font file missing: ${p}`);
    const bytes = readFileSync(p);
    if (bytes.length !== entry.bytes) throw new Error(`${entry.filename} bytes mismatch`);
    const got = sha256Hex(bytes);
    if (got !== entry.sha256) throw new Error(`${entry.filename} SHA mismatch`);
    return bytes as unknown as Uint8Array;
  };

  const regular = loadOne(regularEntry);
  let emoji: Uint8Array | undefined;
  if (emojiEntry) emoji = loadOne(emojiEntry);

  // Optional: if emoji bytes empty, leave undefined — core will handle emoji gap via unsupported glyph
  const bundle: FontBundle = emoji ? { regular, emoji } : { regular };
  cached = bundle;
  return bundle;
}

/** Clear cache (test-only) */
export function __clearFontCache(): void {
  cached = null;
}

/**
 * Compile with vendored fonts (Node helper).
 * Equivalent to `compileContext(source, { fonts: loadBundledFonts(), ...opts })`.
 */
export async function compileContextWithBundledFonts(
  source: string,
  options?: BundledCompileOptions
): Promise<VerifiedArtifact> {
  const fonts = loadBundledFonts();
  return compileContext(source, {
    fonts,
    ...(options?.pageBudget !== undefined ? { pageBudget: options.pageBudget } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}
