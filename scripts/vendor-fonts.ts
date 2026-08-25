/**
 * vendor-fonts — reproducible download + offline verification for assets/fonts.
 *
 * - Offline verify (default for CI): checks committed bytes SHA-256 == manifest, validates
 *   immutable commit URL, OFL text, attribution, bytes field.
 * - Download: `bun run scripts/vendor-fonts.ts --fetch` fetches each pinned raw URL and
 *   overwrites assets/fonts/<filename> after SHA verification (requires network).
 *
 * No runtime CDN/fetch is used by the library itself — this script is build-time only.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "assets", "fonts", "manifest.json");
const FONTS_DIR = join(ROOT, "assets", "fonts");

interface ManifestEntry {
  name: string;
  filename: string;
  url: string;
  sha256: string;
  bytes: number;
  license: string;
  attribution: string;
}

interface Manifest {
  version: number;
  fonts: ManifestEntry[];
  licenseFile: string;
  licenseSha256?: string;
}

function sha256(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isImmutableUrl(url: string): boolean {
  // Must contain /<40 hex>/ and must NOT contain mutable branch markers
  const hasCommit = /\/[0-9a-f]{40}(?:\/|$)/.test(url);
  const hasMutable = url.includes("/main/") || url.includes("/master/") || url.includes("/latest/");
  return hasCommit && !hasMutable;
}

function fail(msg: string): never {
  console.error(`[fonts] FAIL: ${msg}`);
  process.exit(1);
}

function verifyOffline(): void {
  if (!existsSync(MANIFEST_PATH)) fail(`manifest missing: ${MANIFEST_PATH}`);
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch {
    fail("manifest is not valid JSON");
  }

  if (!Array.isArray(manifest.fonts) || manifest.fonts.length === 0) fail("manifest.fonts empty");

  const licensePath = join(FONTS_DIR, manifest.licenseFile ?? "OFL.txt");
  if (!existsSync(licensePath)) fail(`OFL missing: ${licensePath}`);
  const oflBytes = readFileSync(licensePath);
  const oflText = oflBytes.toString("utf8");
  if (!oflText.includes("SIL OPEN FONT LICENSE")) fail("OFL.txt missing license header");
  if (!oflText.includes("Version 1.1")) fail("OFL.txt missing Version 1.1");
  if (!oflText.toLowerCase().includes("google")) fail("OFL.txt missing attribution (Google)");
  if (manifest.licenseSha256) {
    const got = sha256(oflBytes);
    if (got !== manifest.licenseSha256) fail(`OFL SHA mismatch: expected ${manifest.licenseSha256}, got ${got}`);
  }
  console.log(`[fonts] OFL OK — ${licensePath} (${oflBytes.length} bytes)`);

  for (const entry of manifest.fonts) {
    if (!entry.name || !entry.filename || !entry.url || !entry.sha256 || !entry.bytes) {
      fail(`manifest entry incomplete: ${JSON.stringify(entry)}`);
    }
    if (!isImmutableUrl(entry.url)) {
      fail(`mutable or non-pinned URL (must contain /<40hex>/ and no /main/): ${entry.url}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) fail(`invalid sha256 hex: ${entry.sha256}`);
    if (!entry.filename.endsWith(".ttf") && !entry.filename.endsWith(".otf")) {
      fail(`filename must be .ttf/.otf: ${entry.filename}`);
    }
    if (entry.license !== "OFL-1.1") fail(`license must be OFL-1.1: ${entry.license}`);
    const fontPath = join(FONTS_DIR, entry.filename);
    if (!existsSync(fontPath)) fail(`font file missing: ${fontPath} (expected ${entry.filename})`);
    const bytes = readFileSync(fontPath);
    if (bytes.length !== entry.bytes) fail(`${entry.filename} bytes mismatch: manifest ${entry.bytes} vs file ${bytes.length}`);
    if (bytes.length === 0) fail(`${entry.filename} empty`);
    const got = sha256(bytes);
    if (got !== entry.sha256) fail(`${entry.filename} SHA mismatch: expected ${entry.sha256}, got ${got}`);
    console.log(`[fonts] OK ${entry.name} — ${entry.filename} ${bytes.length} bytes sha256 ${got.slice(0, 16)}… url ${entry.url}`);
  }

  // Provenance sanity: ensure emoji-required check can fail deterministically
  const hasRegular = manifest.fonts.some((f) => f.filename === "NotoSansKR-Regular.ttf");
  const hasEmoji = manifest.fonts.some((f) => f.filename === "NotoEmoji-Variable.ttf");
  if (!hasRegular) fail("manifest must include NotoSansKR-Regular.ttf");
  if (!hasEmoji) fail("manifest must include NotoEmoji-Variable.ttf");

  console.log("[fonts] verify: all checks passed (offline, no network)");
}

async function fetchAndVendor(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  for (const entry of manifest.fonts) {
    if (!isImmutableUrl(entry.url)) fail(`refusing to fetch mutable URL: ${entry.url}`);
    console.log(`[fonts] fetching ${entry.name} from ${entry.url}`);
    const res = await fetch(entry.url);
    if (!res.ok) fail(`fetch failed ${entry.url}: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== entry.bytes) {
      console.warn(`[fonts] WARN bytes mismatch for ${entry.filename}: manifest ${entry.bytes} vs fetched ${buf.length} — using fetched but manifest must be updated`);
    }
    const got = sha256(buf);
    if (got !== entry.sha256) fail(`fetched SHA mismatch for ${entry.filename}: expected ${entry.sha256}, got ${got}`);
    const out = join(FONTS_DIR, entry.filename);
    writeFileSync(out, buf);
    console.log(`[fonts] wrote ${out} ${buf.length} bytes sha256 ${got}`);
  }
  console.log("[fonts] vendor: done");
  verifyOffline();
}

const args = process.argv.slice(2);
if (args.includes("--fetch") || args.includes("--vendor")) {
  await fetchAndVendor();
} else {
  verifyOffline();
}
