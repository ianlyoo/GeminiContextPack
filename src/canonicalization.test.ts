import { describe, expect, test } from "bun:test";
import {
  CANONICALIZATION_ID,
  canonicalHash,
  canonicalize,
  decode,
  decodeTransport,
  encode,
  encodeTransport,
  hashCanonical,
} from "./canonicalization.js";
import { ContextPackError } from "./errors.js";

describe("canonicalization gemini-context-pack-v1", () => {
  test("id is fixed", () => {
    expect(CANONICALIZATION_ID).toBe("gemini-context-pack-v1");
  });

  test("CRLF -> LF", () => {
    expect(canonicalize("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  test("CR -> LF", () => {
    expect(canonicalize("a\rb\rc")).toBe("a\nb\nc");
  });

  test("mixed CRLF/CR/LF normalized", () => {
    expect(canonicalize("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  test("whitespace preserved: spaces, tabs, multiple newlines", () => {
    const input = "a  b\tc\n\n  d\t\t e";
    expect(canonicalize(input)).toBe(input.normalize("NFC"));
    // distinct whitespace must produce distinct hashes
    const h1 = canonicalHash("a b");
    const h2 = canonicalHash("a  b");
    const h3 = canonicalHash("a\tb");
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });

  test("NFC normalization only", () => {
    const nfd = "e\u0301"; // e + combining acute
    const nfc = "\u00e9"; // é
    expect(canonicalize(nfd)).toBe(nfc);
    expect(canonicalize(nfc)).toBe(nfc);
    // hash equivalence
    expect(canonicalHash(nfd)).toBe(canonicalHash(nfc));
    expect(hashCanonical(canonicalize(nfd))).toBe(hashCanonical(canonicalize(nfc)));
  });

  test("NFC/NFD hash equality but whitespace distinction", () => {
    const nfd = "caf\u0065\u0301"; // cafe + combining
    const nfc = "caf\u00e9";
    expect(canonicalHash(nfd)).toBe(canonicalHash(nfc));
    // distinct whitespace not equal
    expect(canonicalHash("hello world")).not.toBe(canonicalHash("hello  world"));
    expect(canonicalHash("a\nb")).not.toBe(canonicalHash("a b"));
  });

  test("encode/decode round trip preserves id and content", () => {
    const src = "hello\nworld";
    const canon = canonicalize(src);
    const enc = encode(canon);
    const parsed = JSON.parse(enc) as { v: string; content: string };
    expect(parsed.v).toBe(CANONICALIZATION_ID);
    expect(decode(enc)).toBe(canon);
    expect(decodeTransport(enc)).toBe(canon);
  });

  test("deterministic Unicode corpus round trip decode(encode(canonicalize(x)))===canonicalize(x)", () => {
    const corpus = [
      "Hello, world!\nSecond line.",
      "back\\slash \"quote\" 'single' \t tab",
      "control\x01\x02\x1f end",
      "CJK: \u4e2d\u6587\u65e5\u672c\u8a9e\uD55C\uAD6D\uC5B4",
      "emoji: \uD83D\uDE00\uD83D\uDE80\u2764\uFE0F",
      "ZWJ family: \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67",
      "bidi: \u202E RTL override \u202C and \u200F RLM",
      "mixed \r\nCRLF and \rCR and \nLF with  spaces\t\tand \u00e9 vs e\u0301",
      "quotes: \"double\" 'single' `backtick` \\slashes\\",
      "newlines:\n\n\n preserves",
      "emoji variation: \u2708\uFE0F vs \u2708",
    ];
    for (const entry of corpus) {
      const canon = canonicalize(entry);
      const enc = encode(canon);
      const dec = decode(enc);
      expect(dec).toBe(canon);
      // JSON escaping preserved
      expect(enc.includes(CANONICALIZATION_ID)).toBe(true);
      // double encode/decode stable
      expect(decode(encode(dec))).toBe(canon);
    }
  });

  test("transport reversibly handles newlines/backslashes/quotes/control/bidi/ZWJ/CJK/emoji", () => {
    const tricky = 'line1\nline2\\backslash"quote"\u0001\u202E\u200D\u4e2d\uD83D\uDE00';
    const canon = canonicalize(tricky);
    const enc = encodeTransport(canon);
    // Ensure JSON escaping contains escapes
    expect(enc.includes("\\n")).toBe(true);
    expect(enc.includes("\\u")).toBe(true); // control char escaped
    expect(decodeTransport(enc)).toBe(canon);
  });

  test("truncated JSON transport fails with INVALID_TRANSPORT and without partial output", () => {
    const canon = canonicalize("hello world");
    const enc = encode(canon);
    const truncated = enc.slice(0, Math.floor(enc.length / 2));
    let threw = false;
    try {
      decode(truncated);
    } catch (err: unknown) {
      threw = true;
      expect(err instanceof ContextPackError).toBe(true);
      const e = err as ContextPackError;
      expect(e.code).toBe("INVALID_TRANSPORT");
    }
    expect(threw).toBe(true);
  });

  test("invalid JSON throws INVALID_TRANSPORT", () => {
    expect(() => decode("{not json")).toThrow();
    try {
      decode("{not json");
    } catch (err: unknown) {
      expect((err as ContextPackError).code).toBe("INVALID_TRANSPORT");
    }
  });

  test("wrong canonicalization id fails", () => {
    const bad = JSON.stringify({ v: "wrong-id", content: "hello" });
    expect(() => decode(bad)).toThrow();
    try {
      decode(bad);
    } catch (err: unknown) {
      expect((err as ContextPackError).code).toBe("INVALID_TRANSPORT");
    }
  });

  test("canonicalize preserves all other whitespace exactly", () => {
    const cases: Array<[string, string]> = [
      ["a  b", "a  b"],
      ["a\tb", "a\tb"],
      ["a\n\nb", "a\n\nb"],
      ["  leading", "  leading"],
      ["trailing  ", "trailing  "],
      ["mix \t \n  \t", "mix \t \n  \t"],
    ];
    for (const [input, expected] of cases) {
      expect(canonicalize(input)).toBe(expected.normalize("NFC"));
    }
  });
});
