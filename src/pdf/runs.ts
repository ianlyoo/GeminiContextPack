/**
 * Grapheme run grouping by font with typed metrics.
 * Splits ZWJ families, measures widths via pdf-lib font metrics,
 * and groups adjacent tokens sharing the same font.
 */
import { FORMAT_CHARACTER_PATTERN, isEmojiGrapheme } from "./graphemes.js";
import { FORMAT_FONT_SENTINEL } from "./format-font.js";
import { requiredFontForChar } from "./font-coverage.js";

export type FontKey = unknown;

export interface TextToken {
  readonly text: string;
  readonly font: FontKey;
  readonly width: number;
  readonly whitespace: boolean;
  readonly isolate: boolean;
  readonly formatCodePoint?: number;
}

export interface TextRun {
  font: FontKey;
  text: string;
  readonly isolate: boolean;
  readonly formatCodePoint?: number;
}

const WHITESPACE_RE = /^\s+$/u;

/**
 * Create a token builder bound to embedded pdf-lib fonts.
 * primaryFont: embedded Noto KR, emojiFont: embedded Noto Emoji or null
 */
export function createTokenBuilder(
  primaryFont: unknown,
  emojiFont: unknown | null,
  fontSize: number,
): (text: string, isolate?: boolean) => TextToken {
  // Build character sets once (deterministic)
  const primarySet: ReadonlySet<number> = new Set(
    (primaryFont as { getCharacterSet(): number[] }).getCharacterSet(),
  );
  const emojiSet: ReadonlySet<number> | null = emojiFont
    ? new Set((emojiFont as { getCharacterSet(): number[] }).getCharacterSet())
    : null;

  const fontCache = new Map<string, unknown>();
  const widthCache = new Map<string, number>();

  function supports(set: ReadonlySet<number> | null, txt: string): boolean {
    if (!set) return false;
    for (const ch of txt) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) return false;
      if (!set.has(cp)) return false;
    }
    return true;
  }

  return (text: string, isolate = false): TextToken => {
    if (FORMAT_CHARACTER_PATTERN.test(text)) {
      return {
        text,
        font: FORMAT_FONT_SENTINEL,
        width: 0,
        whitespace: false,
        isolate: true,
        formatCodePoint: text.codePointAt(0) ?? 0,
      };
    }
    if (text.codePointAt(0) === 0x200d) {
      return {
        text,
        font: FORMAT_FONT_SENTINEL,
        width: 0,
        whitespace: false,
        isolate: true,
        formatCodePoint: 0x200d,
      };
    }
    // Tag characters E0020-E007F already matched by pattern; fallback explicit
    const cp0 = text.codePointAt(0) ?? 0;
    if (cp0 >= 0xe0020 && cp0 <= 0xe007f) {
      return {
        text,
        font: FORMAT_FONT_SENTINEL,
        width: 0,
        whitespace: false,
        isolate: true,
        formatCodePoint: cp0,
      };
    }

    let fontKey = fontCache.get(text);
    if (fontKey === undefined) {
      // If emoji required but emoji font not available (variable COLR unsupported), fallback to zero-width Type3 with ToUnicode
      const needEmoji = requiredFontForChar(text) === "emoji";
      if (needEmoji && !emojiSet) {
        fontCache.set(text, FORMAT_FONT_SENTINEL as unknown as string);
        return {
          text,
          font: FORMAT_FONT_SENTINEL,
          width: fontSize,
          whitespace: WHITESPACE_RE.test(text),
          isolate: true,
          formatCodePoint: text.codePointAt(0) ?? 0,
        };
      }
      const prefersEmoji = isEmojiGrapheme(text);
      if (prefersEmoji && supports(emojiSet, text)) fontKey = emojiFont;
      else if (supports(primarySet, text)) fontKey = primaryFont;
      else if (supports(emojiSet, text)) fontKey = emojiFont;
      else fontKey = primaryFont; // caller will later assert coverage => no silent fallback allowed beyond this
      fontCache.set(text, fontKey as string);
    }

    const cacheKey = `${fontKey === emojiFont ? "e" : "p"}\u0000${text}`;
    let w = widthCache.get(cacheKey);
    if (w === undefined) {
      // widthOfTextAtSize is deterministic per subset
      const typedFont = fontKey as { widthOfTextAtSize(t: string, s: number): number };
      try {
        w = typedFont.widthOfTextAtSize(text, fontSize);
      } catch {
        // Variable color emoji font may throw layout error (COLR variable not supported by fontkit)
        // Fallback to deterministic estimate (fontSize width for emoji, 0.5 for ascii) to keep layout stable
        w = fontSize;
      }
      widthCache.set(cacheKey, w);
    }

    return {
      text,
      font: fontKey as FontKey,
      width: w,
      whitespace: WHITESPACE_RE.test(text),
      isolate,
    };
  };
}

/**
 * Group adjacent tokens into runs sharing the same font,
 * preserving isolate boundaries for format chars and emoji modifiers.
 */
export function groupIntoRuns(tokens: readonly TextToken[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    const isolated = token.isolate === true;
    const lastIsolated = last?.isolate === true;
    if (!isolated && !lastIsolated && last !== undefined && last.font === token.font) {
      last.text += token.text;
    } else {
      runs.push({
        font: token.font,
        text: token.text,
        isolate: token.isolate,
        ...(token.formatCodePoint !== undefined ? { formatCodePoint: token.formatCodePoint } : {}),
      });
    }
  }
  return runs;
}

export function trimLineEnd(tokens: readonly TextToken[]): readonly TextToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.whitespace) end -= 1;
  return tokens.slice(0, end);
}

export function trimLineStart(tokens: readonly TextToken[]): readonly TextToken[] {
  let start = 0;
  while (start < tokens.length && tokens[start]?.whitespace) start += 1;
  return tokens.slice(start);
}

export function pushLine(lines: TextToken[][], tokens: readonly TextToken[]): void {
  const trimmed = trimLineEnd(tokens);
  if (trimmed.length > 0) lines.push([...trimmed]);
}

/**
 * Word-aware line wrapping matching layout.ts logic (55% earliest break).
 */
export function wrapMeasuredTokens(
  tokens: readonly TextToken[],
  columnWidth: number,
): TextToken[][] {
  const lines: TextToken[][] = [];
  let current: TextToken[] = [];
  let currentWidth = 0;

  for (const token of tokens) {
    if (current.length > 0 && currentWidth + token.width > columnWidth) {
      let breakAt = -1;
      const earliest = Math.floor(current.length * 0.55);
      for (let i = current.length - 1; i > earliest; i -= 1) {
        if (current[i]?.whitespace) {
          breakAt = i;
          break;
        }
      }
      if (breakAt >= 0) {
        pushLine(lines, current.slice(0, breakAt));
        const remainder = trimLineStart(current.slice(breakAt + 1));
        current = [...remainder];
        currentWidth = current.reduce((s, t) => s + t.width, 0);
      } else {
        pushLine(lines, current);
        current = [];
        currentWidth = 0;
      }
    }
    if (current.length === 0 && token.whitespace) continue;
    current.push(token);
    currentWidth += token.width;
  }
  pushLine(lines, current);
  if (lines.length === 0) lines.push([]);
  return lines;
}
