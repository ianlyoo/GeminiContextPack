/**
 * Zero-width Type3 format font with ToUnicode for reversible transport.
 * Clean-room implementation — maps each distinct format codePoint to a
 * single-byte code (1..N) with zero Widths and a CMap that restores Unicode.
 */
import { PDFHexString, PDFName } from "pdf-lib";
import { ContextPackError } from "../errors.js";

export const FORMAT_FONT_SENTINEL = Symbol("FormatFont");

export interface FormatFontResult {
  readonly ref: unknown;
  readonly formatCodes: ReadonlyMap<number, number>;
}

/**
 * Convert Unicode code point to hex string for ToUnicode CMap.
 * BMP => 4 hex digits, astral => surrogate pair 8 hex digits.
 */
function toUnicodeHex(codePoint: number): string {
  if (codePoint <= 0xffff) {
    return codePoint.toString(16).padStart(4, "0").toUpperCase();
  }
  const v = codePoint - 0x10000;
  const high = 0xd800 + (v >> 10);
  const low = 0xdc00 + (v & 0x3ff);
  return `${high.toString(16).padStart(4, "0")}${low.toString(16).padStart(4, "0")}`.toUpperCase();
}

/**
 * Create a deterministic zero-width Type3 font for the given format codePoints.
 * Returns null if empty, throws if >255 distinct code points.
 */
export function createZeroWidthFormatFont(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  codePoints: readonly number[],
): FormatFontResult | null {
  const unique = [...new Set(codePoints)];
  if (unique.length === 0) return null;
  if (unique.length > 255) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "format codes <= 255", actual: unique.length } },
      "PDF limit exceeded: too many format code points",
    );
  }

  const formatCodes = new Map<number, number>(unique.map((cp, idx) => [cp, idx + 1]));

  // Blank glyph stream reused for all code points (zero advance)
  const blankGlyph = pdf.context.register(pdf.context.flateStream(""));

  const charProcs: Record<string, unknown> = {};
  const differences: unknown[] = [1];
  for (let i = 0; i < unique.length; i += 1) {
    const glyphName = `fz${i + 1}`;
    charProcs[glyphName] = blankGlyph;
    differences.push(PDFName.of(glyphName));
  }

  const mappings = unique
    .map((cp, idx) => `<${(idx + 1).toString(16).padStart(2, "0")}> <${toUnicodeHex(cp)}>`)
    .join("\n");

  const cmapText = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /GeminiContextPackFormat def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    `${unique.length} beginbfchar`,
    mappings,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");

  const toUnicodeStream = pdf.context.register(pdf.context.flateStream(cmapText));

  const fontDict = pdf.context.obj({
    Type: PDFName.of("Font"),
    Subtype: PDFName.of("Type3"),
    FontBBox: [0, 0, 0, 0],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: pdf.context.obj(charProcs),
    Encoding: pdf.context.obj({ Type: PDFName.of("Encoding"), Differences: differences }),
    FirstChar: 1,
    LastChar: unique.length,
    Widths: Array(unique.length).fill(0),
    Resources: pdf.context.obj({}),
    ToUnicode: toUnicodeStream,
  });

  const ref = pdf.context.register(fontDict);
  return { ref, formatCodes };
}

/**
 * Encode a format code point as a single-byte PDF hex string for Tj.
 */
export function encodeFormatCode(formatCodes: ReadonlyMap<number, number>, codePoint: number): unknown {
  const code = formatCodes.get(codePoint);
  if (code === undefined) {
    throw new ContextPackError(
      { code: "UNSUPPORTED_GLYPH", details: { codePoint, offset: 0 } },
      `Missing format code for U+${codePoint.toString(16).toUpperCase()}`,
    );
  }
  return PDFHexString.of(code.toString(16).padStart(2, "0"));
}
