/**
 * Grapheme clustering via Intl.Segmenter — clean-room typed helpers.
 * Handles emoji ZWJ, variation selectors, format characters, CJK, English.
 */

const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D/u;
export const FORMAT_CHARACTER_PATTERN = /^[\u200D\uFE0E\uFE0F\u{E0020}-\u{E007F}]$/u;
export const CJK_PATTERN =
  /\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;
export const WHITESPACE_PATTERN = /^\s+$/u;

export function isFormatGrapheme(grapheme: string): boolean {
  return FORMAT_CHARACTER_PATTERN.test(grapheme);
}

export function isEmojiGrapheme(grapheme: string): boolean {
  return EMOJI_PATTERN.test(grapheme);
}

export function isWhitespaceGrapheme(grapheme: string): boolean {
  return WHITESPACE_PATTERN.test(grapheme);
}

export function isCjkGrapheme(grapheme: string): boolean {
  return CJK_PATTERN.test(grapheme);
}

export function segmentGraphemes(source: string): readonly string[] {
  const text = String(source);
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (e) => e.segment);
  }
  return Array.from(text);
}

export function segmentWithOffsets(source: string): readonly {
  readonly segment: string;
  readonly offset: number;
}[] {
  const text = String(source);
  if (graphemeSegmenter) {
    const out: { segment: string; offset: number }[] = [];
    for (const entry of graphemeSegmenter.segment(text)) {
      const seg = entry.segment as string;
      // Segmenter entry has index in newer TS; fallback to search
      const idx = (entry as unknown as { index?: number }).index;
      const offset = typeof idx === "number" ? idx : text.indexOf(seg);
      out.push({ segment: seg, offset });
    }
    return out;
  }
  // Fallback: code-point iteration with offset
  const out: { segment: string; offset: number }[] = [];
  let offset = 0;
  for (const ch of Array.from(text)) {
    out.push({ segment: ch, offset });
    offset += ch.length;
  }
  return out;
}

export function countGraphemes(source: string): number {
  return segmentGraphemes(source).length;
}

export function hasGraphemeSupport(): boolean {
  return graphemeSegmenter !== null;
}
