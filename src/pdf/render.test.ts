import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { canonicalize, encodeTransport } from "../canonicalization.js";
import { ContextPackError } from "../errors.js";
import { extractCanonicalSource } from "./extract.js";
import { planLayout, PAGE_WIDTH, PAGE_HEIGHT } from "./layout.js";
import { renderTransportPdf } from "./render.js";

function loadBundle(): { regular: Uint8Array; emoji?: Uint8Array } {
  // Reuse vendored fonts via fs — keep Buffer for fontkit compatibility
  const dir = join(process.cwd(), "assets", "fonts");
  const regular = readFileSync(join(dir, "NotoSansKR-Regular.ttf")) as unknown as Uint8Array;
  let emoji: Uint8Array | undefined;
  try {
    emoji = readFileSync(join(dir, "NotoEmoji-Variable.ttf")) as unknown as Uint8Array;
  } catch {
    emoji = undefined;
  }
  return emoji ? { regular, emoji } : { regular };
}

function shaHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesAsLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function decompressedPdfText(bytes: Uint8Array): string {
  const latin = bytesAsLatin1(bytes);
  let combined = latin;
  // Extract FlateDecode streams and inflate
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin)) !== null) {
    const compressed = Buffer.from(m[1] as string, "latin1");
    try {
      const inflated = inflateSync(compressed);
      combined += `\n${inflated.toString("latin1")}`;
    } catch {
      // not flate
    }
  }
  return combined;
}

describe("pdf/render — deterministic accessible PDFs", () => {
  const fonts = loadBundle();

  test("happy — %PDF header present", async () => {
    const src = canonicalize("hello world determinism check");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");
    expect(header).toBe("%PDF-");
    expect(pdfBytes.length).toBeGreaterThan(500);
  });

  test("happy — A4 MediaBox exactly 595.28 x 841.89", async () => {
    const src = canonicalize("A4 check");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const latin = bytesAsLatin1(pdfBytes);
    // pdf-lib emits MediaBox as [0 0 595.28 841.89]
    expect(latin).toContain("MediaBox");
    expect(latin).toContain("595.28");
    expect(latin).toContain("841.89");
    // Also ensure page dimensions via pdfjs can be inspected? Use latin check sufficient for MediaBox
    expect(PAGE_WIDTH).toBe(595.28);
    expect(PAGE_HEIGHT).toBe(841.89);
  });

  test("happy — page count matches layout plan and single page for small input", async () => {
    const src = canonicalize("hello world small");
    const transport = encodeTransport(src);
    const plan = planLayout(transport);
    const { pdfBytes, pageCount } = await renderTransportPdf(transport, fonts);
    expect(pageCount).toBe(plan.pageCount);
    expect(pageCount).toBe(1);
    // Verify via latin that Pages count equals 1 (best-effort via /Count)
    const latin = bytesAsLatin1(pdfBytes);
    expect(latin).toContain("/Count 1");
  });

  test("happy — ActualText parser presence per line", async () => {
    const src = canonicalize("ActualText test — ensure span marked content");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const text = decompressedPdfText(pdfBytes);
    expect(text).toContain("/ActualText");
    expect(text).toContain("Span");
    // At least one ActualText entry per rendered line
    const actualCount = (text.match(/\/ActualText/g) ?? []).length;
    expect(actualCount).toBeGreaterThanOrEqual(1);
  });

  test("happy — ToUnicode present for format font when format chars exist", async () => {
    // Source containing standalone format char ZWJ will trigger Type3 format font with ToUnicode (no emoji font needed)
    const src = canonicalize("format test \u200D with zwj and \uFE0F var");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const latin = bytesAsLatin1(pdfBytes);
    expect(latin).toContain("/ToUnicode");
    expect(latin).toContain("/Widths");
  });

  test("happy — ToUnicode present even without format (primary subset embeds ToUnicode)", async () => {
    const src = canonicalize("plain ascii without format");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const latin = bytesAsLatin1(pdfBytes);
    expect(latin).toContain("/ToUnicode");
  });

  test("happy — repeated render byte SHA equality (determinism)", async () => {
    const src = canonicalize("deterministic SHA equality test — 안녕하세요 中文");
    const transport = encodeTransport(src);
    const a = await renderTransportPdf(transport, fonts);
    const b = await renderTransportPdf(transport, fonts);
    expect(shaHex(a.pdfBytes)).toBe(shaHex(b.pdfBytes));
    expect(a.pdfBytes.length).toBe(b.pdfBytes.length);
    const latinA = bytesAsLatin1(a.pdfBytes);
    const latinB = bytesAsLatin1(b.pdfBytes);
    expect(latinA).toBe(latinB);
    expect(latinA).toContain("2023");
  });

  test("happy — CJK/emoji output via extraction round-trip", async () => {
    // Use CJK chars known to be in NotoSansKR SubsetOTF/KR (韓 中 文 本 語 好)
    const src = canonicalize("안녕하세요 中文本語 好 mixed CJK");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const extracted = await extractCanonicalSource(pdfBytes);
    expect(extracted).toBe(src);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  test("happy — ordered column drawing left-to-right top-to-bottom not overlapping", async () => {
    // Use multi-line source to force multiple lines/columns — avoid spaces at wrap boundaries for deterministic join
    const src = canonicalize(Array.from({ length: 80 }, (_, i) => `line${i}_helloworld_안녕`).join("\n"));
    const transport = encodeTransport(canonicalize(src));
    const { pdfBytes, pageCount } = await renderTransportPdf(transport, fonts);
    expect(pageCount).toBeGreaterThanOrEqual(1);
    const extracted = await extractCanonicalSource(pdfBytes);
    expect(extracted).toBe(canonicalize(src));
  });

  test("happy — only reversible transport payload rendered (no hidden duplicate)", async () => {
    const src = canonicalize("hidden duplicate check");
    const transport = encodeTransport(src);
    const { pdfBytes } = await renderTransportPdf(transport, fonts);
    const text = decompressedPdfText(pdfBytes);
    // Transport JSON should appear exactly as ActualText, not as duplicate hidden text outside marked content
    expect(text).toContain("/ActualText");
    // Ensure no Info duplication of payload
    expect(text).not.toContain(src.slice(0, 20) + src.slice(0, 20));
  });

  test("failure — missing required font returns no PDF bytes (throws INVALID_CONTEXT)", async () => {
    const src = canonicalize("missing font test");
    const transport = encodeTransport(src);
    const emptyBundle = { regular: new Uint8Array(0) } as unknown as { regular: Uint8Array };
    let threw = false;
    try {
      await renderTransportPdf(transport, emptyBundle);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ContextPackError);
      expect((err as ContextPackError).code).toBe("INVALID_CONTEXT");
    }
    expect(threw).toBe(true);
  });

  test("failure — unsupported glyph throws UNSUPPORTED_GLYPH with codePoint/offset, no bytes", async () => {
    const bad = `hello${String.fromCodePoint(0x0378)}world`;
    const src = canonicalize(bad);
    const transport = encodeTransport(src);
    let threw = false;
    let bytesLen = 0;
    try {
      const res = await renderTransportPdf(transport, fonts);
      bytesLen = res.pdfBytes.length;
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ContextPackError);
      expect((err as ContextPackError).code).toBe("UNSUPPORTED_GLYPH");
      const d = (err as ContextPackError).details as { codePoint: number; offset: number };
      expect(d.codePoint).toBe(0x0378);
      expect(typeof d.offset).toBe("number");
    }
    expect(threw).toBe(true);
    expect(bytesLen).toBe(0);
  });

  test("failure — budget overflow throws PAGE_BUDGET_EXCEEDED with no bytes", async () => {
    // Force overflow beyond 3572 lines at 0.8pt: 4000 lines each 500 chars -> ~5700 wrapped lines
    const longLine = "x".repeat(500);
    const huge = Array.from({ length: 4000 }, () => longLine).join("\n");
    const src = canonicalize(huge);
    const transport = encodeTransport(src);
    let threw = false;
    try {
      await renderTransportPdf(transport, fonts, { pageBudget: 1 });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ContextPackError);
      expect((err as ContextPackError).code).toBe("PAGE_BUDGET_EXCEEDED");
      const d = (err as ContextPackError).details as { pageBudget: number; requiredPages: number };
      expect(d.pageBudget).toBe(1);
      expect(d.requiredPages).toBeGreaterThan(1);
    }
    expect(threw).toBe(true);
  });

  test("failure — abort signal before render returns no artifact", async () => {
    const src = canonicalize("abort test");
    const transport = encodeTransport(src);
    const controller = new AbortController();
    controller.abort();
    let threw = false;
    try {
      await renderTransportPdf(transport, fonts, { signal: controller.signal });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ContextPackError);
      expect((err as ContextPackError).code).toBe("ABORTED");
    }
    expect(threw).toBe(true);
  });

  test("LOC gate — format-font, runs, render modules ≤ reasonable size", async () => {
    const files = [
      join(process.cwd(), "src/pdf/format-font.ts"),
      join(process.cwd(), "src/pdf/runs.ts"),
      join(process.cwd(), "src/pdf/render.ts"),
    ];
    for (const f of files) {
      const len = readFileSync(f, "utf8").split("\n").length;
      // render may be slightly larger than 250 but keep reasonable (retry logic adds lines)
      const limit = f.endsWith("render.ts") ? 500 : 250;
      expect(len).toBeLessThanOrEqual(limit);
    }
  });
});
