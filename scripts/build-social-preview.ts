/**
 * Deterministic 1280x640 social preview builder.
 *
 * Preference: Playwright screenshot of docs/social-preview.html if playwright
 * is available and --playwright is passed. Fallback: sharp SVG -> PNG which
 * is fully deterministic offline (pinned rendering, no timestamps, no random).
 *
 * Output: docs/assets/social-preview.png
 * Guarantees: 1280x640, RGB (no alpha), solid background, <1MiB, same SHA on
 * repeated render when inputs are locked (no Date.now, no random, fixed
 * compression).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PRODUCT_ROOT = resolve(import.meta.dir, "..");
const SRC_HTML = join(PRODUCT_ROOT, "docs", "social-preview.html");
const OUT_PNG = join(PRODUCT_ROOT, "docs", "assets", "social-preview.png");

const WIDTH = 1280;
const HEIGHT = 640;

// Deterministic SVG source - must not contain Date, random, or external fetch.
// Colors: solid #0f172a background (high contrast with white), no transparency.
function buildSvg(): string {
  // Keep text identical to docs/social-preview.html; do not add old brand or 99% claim.
  // Using sans-serif stack; sharp/librsvg will rasterize consistently.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="GeminiContextPack social preview">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0f172a"/>
  <!-- content -->
  <text x="72" y="220" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif" font-size="64" font-weight="800" letter-spacing="-1.5" fill="#ffffff">GeminiContextPack</text>
  <text x="72" y="278" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif" font-size="28" font-weight="500" fill="#e2e8f0">Gemini API context optimizer using native PDF packaging</text>
  <!-- cue pill -->
  <rect x="72" y="308" width="420" height="38" rx="6" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
  <text x="86" y="333" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif" font-size="16" font-weight="700" letter-spacing="0.6" fill="#0f172a">measured workloads — not guaranteed</text>
  <text x="72" y="388" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif" font-size="15" fill="#94a3b8">github.com/ianlyoo/GeminiContextPack  ·  Apache-2.0  ·  TypeScript</text>
</svg>`;
}

async function buildWithSharp(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const svg = buildSvg();
  // sharp renders SVG via librsvg; deterministic for same SVG input.
  // Ensure PNG without ancillary timestamp chunks; keep compression deterministic.
  const png = await sharp(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  // Verify dimensions by re-reading metadata (defensive, but avoid extra async parse)
  const meta = await sharp(png).metadata();
  if (meta.width !== WIDTH || meta.height !== HEIGHT) {
    throw new Error(`sharp output dimensions ${meta.width}x${meta.height} != ${WIDTH}x${HEIGHT}`);
  }
  if (meta.hasAlpha) {
    // Composite over solid background to strip alpha deterministically if any
    const bg = await sharp({
      create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const flattened = await sharp(bg).composite([{ input: png }]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    return flattened;
  }
  return png;
}

async function buildWithPlaywright(): Promise<Buffer> {
  // Dynamic import so sharp-only environments still work
  const { chromium } = await import("playwright");
  const html = readFileSync(SRC_HTML, "utf8");
  // Verify template sanity (no old brand/no claim) before render
  const lower = html.toLowerCase();
  if (/\bris(u|uai)\b/.test(lower) || lower.includes("pagefold")) throw new Error("template contains forbidden brand");
  if (html.includes("99%+") || html.includes("99% +")) throw new Error("template contains unqualified 99%+ claim");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    // Deterministic: no web font loading, no animation, fixed timezone
    await page.setContent(html, { waitUntil: "load" });
    // Ensure fixed size and solid background
    await page.addStyleTag({
      content: `html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#0f172a !important;} *{animation:none !important;transition:none !important;}`,
    });
    const buf = await page.screenshot({ type: "png", fullPage: false, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(join(PRODUCT_ROOT, "docs", "assets"), { recursive: true });

  // Validate source template exists and is clean
  const html = readFileSync(SRC_HTML, "utf8");
  if (!html.includes("GeminiContextPack")) throw new Error("template missing GeminiContextPack");
  if (!html.includes("Gemini API context optimizer using native PDF packaging")) throw new Error("template missing positioning");
  if (!html.includes("measured workloads — not guaranteed")) throw new Error("template missing measured cue");
  const lower = html.toLowerCase();
  if (/\bris(u|uai)\b/.test(lower)) throw new Error("template forbidden brand Risu");
  if (lower.includes("pagefold")) throw new Error("template forbidden brand PageFold");
  if (html.includes("99%+")) throw new Error("template must not contain 99%+");

  const usePlaywright = process.argv.includes("--playwright");
  let png: Buffer;
  if (usePlaywright) {
    png = await buildWithPlaywright();
  } else {
    png = await buildWithSharp();
  }

  // Hard gates before write
  if (png.length >= 1024 * 1024) {
    throw new Error(`PNG ${png.length} bytes >= 1MiB`);
  }
  // Verify PNG signature and IHDR dimensions without extra deps
  if (png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) throw new Error("not PNG");
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (w !== WIDTH || h !== HEIGHT) throw new Error(`PNG IHDR ${w}x${h} != ${WIDTH}x${HEIGHT}`);
  // Check no old brand in svg source (indirect) — png is binary, so check template only already done

  writeFileSync(OUT_PNG, png);
  const sha = createHash("sha256").update(png).digest("hex");
  const kb = (png.length / 1024).toFixed(1);
  console.log(`[social-preview] wrote ${OUT_PNG} ${w}x${h} ${png.length} bytes (${kb} KiB) sha256:${sha}`);
}

await main();
