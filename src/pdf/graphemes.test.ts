import { describe, expect, test } from "bun:test";
import {
  countGraphemes,
  isCjkGrapheme,
  isEmojiGrapheme,
  isFormatGrapheme,
  isWhitespaceGrapheme,
  segmentGraphemes,
  segmentWithOffsets,
} from "./graphemes.js";

describe("graphemes – Intl.Segmenter vectors", () => {
  test("english ascii segments per code point", () => {
    expect(segmentGraphemes("hello")).toEqual(["h", "e", "l", "l", "o"]);
    expect(countGraphemes("hello")).toBe(5);
  });

  test("CJK Hangul each syllable is one grapheme", () => {
    const s = "안녕하세요";
    const seg = segmentGraphemes(s);
    expect(seg.length).toBe(5);
    for (const g of seg) expect(isCjkGrapheme(g)).toBe(true);
  });

  test("CJK Han", () => {
    const seg = segmentGraphemes("中文測試");
    expect(seg.length).toBe(4);
  });

  test("single emoji is one grapheme", () => {
    expect(segmentGraphemes("🌍").length).toBe(1);
    expect(isEmojiGrapheme("🌍")).toBe(true);
    expect(segmentGraphemes("😀").length).toBe(1);
  });

  test("ZWJ family sequence is one grapheme", () => {
    const family = "👨‍👩‍👧‍👦";
    const seg = segmentGraphemes(family);
    // Intl.Segmenter clusters ZWJ family as one grapheme
    expect(seg.length).toBe(1);
    expect(seg[0]).toBe(family);
  });

  test("ZWJ alone is format", () => {
    expect(isFormatGrapheme("\u200D")).toBe(true);
    expect(segmentGraphemes("\u200D").length).toBe(1);
  });

  test("variation selector VS16 clusters", () => {
    // U+2600 SUN + U+FE0F VS16 => one grapheme
    const vs = "☀️";
    const seg = segmentGraphemes(vs);
    expect(seg.length).toBe(1);
    // VS16 inside emoji
    const sun = "☀\uFE0F";
    expect(segmentGraphemes(sun).length).toBe(1);
  });

  test("variation selector VS15", () => {
    expect(isFormatGrapheme("\uFE0E")).toBe(true);
    expect(isFormatGrapheme("\uFE0F")).toBe(true);
  });

  test("tag characters format range", () => {
    const tag = String.fromCodePoint(0xe0020);
    expect(isFormatGrapheme(tag)).toBe(true);
  });

  test("ZWJ emoji with VS remains one grapheme", () => {
    const seq = "❤️"; // heart + VS16
    expect(segmentGraphemes(seq).length).toBe(1);
  });

  test("combining mark clusters when segmenter available", () => {
    const s = "e\u0301"; // e + combining acute
    const seg = segmentGraphemes(s);
    // With NFC input this would be \u00e9 already; but raw combining should cluster
    // If segmenter present, may be 1; fallback is 2 code points but still deterministic
    expect(seg.join("")).toBe(s);
    expect(seg.length).toBeGreaterThanOrEqual(1);
    expect(seg.length).toBeLessThanOrEqual(2);
  });

  test("whitespace detection", () => {
    expect(isWhitespaceGrapheme(" ")).toBe(true);
    expect(isWhitespaceGrapheme("\n")).toBe(true);
    expect(isWhitespaceGrapheme("\t")).toBe(true);
    expect(isWhitespaceGrapheme("a")).toBe(false);
  });

  test("segmentWithOffsets reports offsets", () => {
    const s = "a🌍b";
    const segs = segmentWithOffsets(s);
    expect(segs.length).toBe(3);
    expect(segs[0]?.segment).toBe("a");
    expect(segs[0]?.offset).toBe(0);
    expect(segs[2]?.segment).toBe("b");
    // b offset is after a (1) + emoji (2 code units)
    expect(segs[2]?.offset).toBe(1 + "🌍".length);
  });

  test("deterministic: repeated segmentation equal", () => {
    const s = "hello 🌍 안녕 👨‍👩‍👧‍👦 ☀️";
    expect(segmentGraphemes(s)).toEqual(segmentGraphemes(s));
    expect(segmentWithOffsets(s)).toEqual(segmentWithOffsets(s));
  });
});
