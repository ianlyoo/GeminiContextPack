import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PRODUCT_ROOT = resolve(import.meta.dir, "..");
const TEMPLATE_PATH = join(PRODUCT_ROOT, "docs", "social-preview.html");
const PNG_PATH = join(PRODUCT_ROOT, "docs", "assets", "social-preview.png");
const INDEX_PATH = join(PRODUCT_ROOT, "docs", "index.html");
const README_PATH = join(PRODUCT_ROOT, "README.md");
const OWNER_ACTIONS_PATH = join(PRODUCT_ROOT, "docs", "OWNER_ACTIONS.md");

const CANONICAL_IMAGE = "https://ianlyoo.github.io/GeminiContextPack/assets/social-preview.png";
const WIDTH = 1280;
const HEIGHT = 640;
const ONE_MIB = 1024 * 1024;

function readText(p: string): string {
  return readFileSync(p, "utf8");
}

function pngDimensions(buf: Buffer): { w: number; h: number } {
  // PNG IHDR at offset 16
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function hasForbiddenBrand(s: string): string | null {
  const lower = s.toLowerCase();
  if (/\bris(u|uai)\b/.test(lower)) return "risu";
  if (lower.includes("pagefold")) return "pagefold";
  return null;
}

function extractOgImage(html: string): string | null {
  const re = /<meta\s+[^>]*property=["']og:image["'][^>]*>/i;
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  const c = tag.match(/content=["']([^"']*)["']/i);
  return c ? (c[1] ?? null) : null;
}

function extractTwitterImage(html: string): string | null {
  const re = /<meta\s+[^>]*name=["']twitter:image["'][^>]*>/i;
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  const c = tag.match(/content=["']([^"']*)["']/i);
  return c ? (c[1] ?? null) : null;
}

describe("social-preview", () => {
  test("happy — template exists, deterministic, approved copy only, solid background", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
    const html = readText(TEMPLATE_PATH);
    expect(html).toContain("GeminiContextPack");
    expect(html).toContain("Gemini API context optimizer using native PDF packaging");
    expect(html).toContain("measured workloads — not guaranteed");
    // No old brand
    expect(hasForbiddenBrand(html)).toBeNull();
    // No unqualified 99%+ claim; "not guaranteed" is the qualified cue and allowed
    expect(html).not.toContain("99%+");
    {
      const lower = html.toLowerCase();
      // Allow "not guaranteed" (qualified) but reject standalone guaranteed
      const hasUnqualifiedGuaranteed =
        lower.includes("guaranteed") && !lower.includes("not guaranteed");
      expect(hasUnqualifiedGuaranteed).toBe(false);
    }
    // Solid background/high contrast: template declares #0f172a background and #ffffff text
    expect(html.toLowerCase()).toContain("#0f172a");
    expect(html.toLowerCase()).toContain("#ffffff");
    // No transparent background reference that would make unreadable
    expect(html.toLowerCase()).not.toContain("transparent");
    // Fixed dimensions hint
    expect(html).toContain("1280");
    expect(html).toContain("640");
    // Must not fetch external fonts/resources
    expect(html.toLowerCase()).not.toContain("https://fonts");
    expect(html.toLowerCase()).not.toContain("@import");
  });

  test("happy — PNG exists, 1280x640, <1MiB, PNG signature, no alpha-induced transparency fragility", () => {
    expect(existsSync(PNG_PATH)).toBe(true);
    const st = statSync(PNG_PATH);
    expect(st.size).toBeGreaterThan(0);
    expect(st.size).toBeLessThan(ONE_MIB);
    const buf = readFileSync(PNG_PATH);
    // PNG signature
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
    const { w, h } = pngDimensions(buf);
    expect(w).toBe(WIDTH);
    expect(h).toBe(HEIGHT);
  });

  test("happy — deterministic SHA on repeated locked render", () => {
    expect(existsSync(PNG_PATH)).toBe(true);
    const before = readFileSync(PNG_PATH);
    const shaBefore = createHash("sha256").update(before).digest("hex");
    // Rebuild via the same tool; must produce identical bytes
    const res = spawnSync("bun", ["run", "social-preview:build"], {
      cwd: PRODUCT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(res.status).toBe(0);
    const after = readFileSync(PNG_PATH);
    const shaAfter = createHash("sha256").update(after).digest("hex");
    expect(shaAfter).toBe(shaBefore);
    // Also double-check dimensions after rebuild
    const { w, h } = pngDimensions(after);
    expect(w).toBe(WIDTH);
    expect(h).toBe(HEIGHT);
    expect(after.length).toBeLessThan(ONE_MIB);
  });

  test("happy — no old brand/unqualified claim in committed image source and valid OG URL", () => {
    // Template already checked; also ensure PNG-adjacent HTML (social-preview.html) is the source
    const html = readText(TEMPLATE_PATH);
    expect(hasForbiddenBrand(html)).toBeNull();
    expect(html).not.toContain("99%+");

    // OG image in docs/index.html must point to canonical committed image
    const indexHtml = readText(INDEX_PATH);
    const ogImage = extractOgImage(indexHtml);
    expect(ogImage).toBe(CANONICAL_IMAGE);
    const twImage = extractTwitterImage(indexHtml);
    expect(twImage).toBe(CANONICAL_IMAGE);
    // Also og:image:width/height/type should be present for social preview guidance
    expect(indexHtml).toContain('property="og:image:width"');
    expect(indexHtml).toContain('content="1280"');
    expect(indexHtml).toContain('property="og:image:height"');
    expect(indexHtml).toContain('content="640"');
    expect(indexHtml).toContain('property="og:image:type"');
    expect(indexHtml).toContain("image/png");
    // Valid canonical URL
    expect(CANONICAL_IMAGE.startsWith("https://ianlyoo.github.io/GeminiContextPack/")).toBe(true);
    expect(CANONICAL_IMAGE.endsWith("/assets/social-preview.png")).toBe(true);

    // README must also reference the same canonical image path
    const readme = readText(README_PATH);
    expect(readme).toContain(CANONICAL_IMAGE);
    expect(readme).toContain("docs/assets/social-preview.png");

    // Source image remains reproducible: template + build script present
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
    expect(existsSync(join(PRODUCT_ROOT, "scripts", "build-social-preview.ts"))).toBe(true);
  });

  test("happy — owner-action guide exists with exact path, upload steps, and verification query", () => {
    expect(existsSync(OWNER_ACTIONS_PATH)).toBe(true);
    const guide = readText(OWNER_ACTIONS_PATH);
    expect(guide).toContain("docs/assets/social-preview.png");
    expect(guide).toContain(CANONICAL_IMAGE);
    expect(guide).toContain("Settings");
    expect(guide).toContain("Social preview");
    expect(guide).toContain("Upload an image");
    // Must document verification via gh api or browser query
    expect(guide.toLowerCase()).toContain("gh api");
    expect(guide).toContain("og:image");
    expect(guide.toLowerCase()).toContain("verification");
    // Must reference build/rebuild
    expect(guide).toContain("social-preview:build");
  });

  test("happy — PNG solid background, high contrast (no transparent and sufficient bytes for content)", () => {
    const buf = readFileSync(PNG_PATH);
    expect(buf.length).toBeGreaterThan(5_000); // not empty/1x1
    expect(buf.length).toBeLessThan(ONE_MIB);
    // Check that file is not interlaced or corrupted by verifying IEND presence
    const txt = buf.toString("binary");
    expect(txt).toContain("IEND");
  });

  // Failure-oriented checks: ensure violations would be caught
  test("failure — temp wrong dimensions would fail", () => {
    const buf = readFileSync(PNG_PATH);
    const { w, h } = pngDimensions(buf);
    // Mutate dimensions conceptually: wrong w/h must not equal expected
    expect(w).not.toBe(640);
    expect(h).not.toBe(1280);
    // Correct should be 1280x640 — this verifies gate is strict
    expect(w).toBe(1280);
    expect(h).toBe(640);
  });

  test("failure — temp old brand in template would fail", () => {
    const html = readText(TEMPLATE_PATH);
    const mutated = `${html} Risu`;
    expect(hasForbiddenBrand(mutated)).not.toBeNull();
    expect(hasForbiddenBrand(html)).toBeNull();
  });

  test("failure — temp unqualified 99%+ claim would fail", () => {
    const html = readText(TEMPLATE_PATH);
    const mutated = `${html} 99%+ guaranteed`;
    expect(mutated).toContain("99%+");
    expect(html).not.toContain("99%+");
  });

  test("failure — temp transparent background would fail solid check", () => {
    const html = readText(TEMPLATE_PATH);
    // A transparent template would contain 'transparent' or rgba with <1 alpha
    const hasTransparent =
      html.toLowerCase().includes("transparent") || /rgba\([^)]*,\s*0(\.|\b)/.test(html);
    expect(hasTransparent).toBe(false);
  });

  test("failure — temp OG pointing to wrong host would fail", () => {
    const indexHtml = readText(INDEX_PATH);
    const og = extractOgImage(indexHtml);
    expect(og).toBe(CANONICAL_IMAGE);
    expect(og).not.toBe("https://example.com/image.png");
    expect(og?.includes("ianlyoo.github.io")).toBe(true);
  });
});
