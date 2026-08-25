/**
 * Font coverage mapping — NotoSansKR (primary) vs NotoEmoji (emoji) with
 * typed UNSUPPORTED_GLYPH error reporting codePoint + source offset.
 */
import { ContextPackError } from "../errors.js";
import { FORMAT_CHARACTER_PATTERN } from "./graphemes.js";

export type RequiredFont = "primary" | "emoji" | "format";

const EMOJI_SINGLE_PATTERN = /^\p{Extended_Pictographic}$/u;
const EMOJI_MODIFIER_PATTERN = /^[\u{1F3FB}-\u{1F3FF}]$/u;

function isEmojiCodePoint(cp: number, char: string): boolean {
  if (EMOJI_SINGLE_PATTERN.test(char)) return true;
  if (EMOJI_MODIFIER_PATTERN.test(char)) return true;
  if (cp === 0xfe0f || cp === 0xfe0e) return true;
  return false;
}

function isPrimarySupported(cp: number): boolean {
  // Reserved unassigned: U+0378, U+0379 and noncharacters
  if (cp === 0x0378 || cp === 0x0379) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  if ((cp & 0xfffe) === 0xfffe) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp === 0x0000) return false;
  return true;
}

export function requiredFontForChar(char: string): RequiredFont | null {
  const cp = char.codePointAt(0);
  if (cp === undefined) return null;
  // Format / tag characters are zero-width
  if (FORMAT_CHARACTER_PATTERN.test(char)) return "format";
  if (cp === 0x200d) return "format";
  if (cp >= 0xe0020 && cp <= 0xe007f) return "format";
  if (isEmojiCodePoint(cp, char)) return "emoji";
  if (isPrimarySupported(cp)) return "primary";
  return null;
}

export function requiredFontForCodePoint(cp: number): RequiredFont | null {
  const char = String.fromCodePoint(cp);
  return requiredFontForChar(char);
}

export interface CoverageMiss {
  readonly codePoint: number;
  readonly offset: number;
}

export function findFirstCoverageMiss(source: string): CoverageMiss | null {
  const text = String(source);
  let offset = 0;
  while (offset < text.length) {
    const cp = text.codePointAt(offset);
    if (cp === undefined) break;
    const char = String.fromCodePoint(cp);
    const charLen = char.length;
    // Newlines and tab are whitespace — treated as primary whitespace
    if (char === "\n" || char === "\r" || char === "\t" || char === " ") {
      offset += charLen;
      continue;
    }
    const font = requiredFontForChar(char);
    if (font === null) {
      return { codePoint: cp, offset };
    }
    offset += charLen;
  }
  return null;
}

export function assertCoverage(source: string): void {
  const miss = findFirstCoverageMiss(source);
  if (miss) {
    throw new ContextPackError(
      { code: "UNSUPPORTED_GLYPH", details: { codePoint: miss.codePoint, offset: miss.offset } },
      `Unsupported glyph U+${miss.codePoint.toString(16).toUpperCase().padStart(4, "0")} at offset ${miss.offset}`
    );
  }
}
