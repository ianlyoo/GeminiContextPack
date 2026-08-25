import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize, decode, encode } from "../src/canonicalization.js";
import { ContextPackError } from "../src/errors.js";
import { compileContext, isVerifiedArtifact, verifyContextPdf } from "../src/index.js";
import type { FontBundle, VerifiedArtifact } from "../src/types.js";

function dummyFonts(): FontBundle {
  // Use real vendored font for deterministic rendering (contract layer previously accepted any bytes)
  try {
    const regular = readFileSync(
      join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf")
    ) as unknown as Uint8Array;
    const emoji = readFileSync(
      join(process.cwd(), "assets", "fonts", "NotoEmoji-Variable.ttf")
    ) as unknown as Uint8Array;
    return { regular, emoji };
  } catch {
    return { regular: new Uint8Array([1, 2, 3]) };
  }
}

describe("public api contracts", () => {
  test("happy — decode(encode(canonicalize(x)))===canonicalize(x) for deterministic corpus", () => {
    const corpus = [
      "hello world",
      "CJK \u4e2d\u6587 \uD55C\uAD6D\uC5B4 emoji \uD83D\uDE00 ZWJ \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67 bidi \u202E",
      "new\nlines\r\nand\rcarriage",
      "quotes \" ' \\ and control \u0001\u001f",
      "NFC: e\u0301 vs \u00e9 and spaces  double  vs single",
    ];
    for (const x of corpus) {
      const canon = canonicalize(x);
      expect(decode(encode(canon))).toBe(canon);
    }
  });

  test("compile happy returns branded VerifiedArtifact", async () => {
    const artifact = await compileContext("hello world", { fonts: dummyFonts() });
    expect(artifact.canonicalSource).toBe("hello world");
    expect(artifact.canonicalizationId).toBe("gemini-context-pack-v1");
    expect(artifact.pdfBytes instanceof Uint8Array).toBe(true);
    expect(isVerifiedArtifact(artifact)).toBe(true);
    // hash consistency
    const expectedHash = (await import("../src/canonicalization.js")).canonicalHash("hello world");
    expect(artifact.canonicalHash).toBe(expectedHash);
  });

  test("verify happy — extracted equals expected", async () => {
    const source = "hello\nCJK \u4e2d\u6587 \u4e2d\u6587";
    const artifact = await compileContext(source, { fonts: dummyFonts() });
    const report = await verifyContextPdf(artifact.pdfBytes, source);
    expect(report.status).toBe("verified");
    expect(report.expectedHash).toBe(report.extractedHash);
    expect(report.expectedSource).toBe(report.extractedSource as string);
    expect(report.canonicalizationId).toBe("gemini-context-pack-v1");
  });

  test("failure — empty input throws INVALID_CONTEXT_EMPTY without partial output", async () => {
    let threw = false;
    let artifact: VerifiedArtifact | null = null;
    try {
      artifact = await compileContext("", { fonts: dummyFonts() });
    } catch (err: unknown) {
      threw = true;
      expect(err instanceof ContextPackError).toBe(true);
      expect((err as ContextPackError).code).toBe("INVALID_CONTEXT_EMPTY");
    }
    expect(threw).toBe(true);
    expect(artifact).toBeNull();

    // whitespace-only that canonicalizes to empty? actually spaces preserved so not empty; but empty string is the case
    let threw2 = false;
    try {
      await compileContext("   \r\n".trim().length === 0 ? "" : "   \r\n", {
        fonts: { regular: new Uint8Array([1]) },
      });
      // the above may not be empty due to spaces; just test explicit empty
    } catch (_err: unknown) {
      // not needed
    }
    // also CRLF-only canonicalizes to "\n" which length 1 -> not empty, so empty remains only "".
    // Ensure dedicated empty-after-canonical test
    try {
      await compileContext("", { fonts: dummyFonts() });
    } catch (err: unknown) {
      expect((err as ContextPackError).code).toBe("INVALID_CONTEXT_EMPTY");
      threw2 = true;
    }
    expect(threw2).toBe(true);
  });

  test("failure — pageBudget 0 throws PAGE_BUDGET_EXCEEDED", async () => {
    let threw = false;
    try {
      await compileContext("hello", { fonts: dummyFonts(), pageBudget: 0 });
    } catch (err: unknown) {
      threw = true;
      expect(err instanceof ContextPackError).toBe(true);
      expect((err as ContextPackError).code).toBe("PAGE_BUDGET_EXCEEDED");
    }
    expect(threw).toBe(true);
  });

  test("failure — truncated JSON transport via verify throws MALFORMED_PDF", async () => {
    const artifact = await compileContext("hello world", { fonts: dummyFonts() });
    const truncated = artifact.pdfBytes.slice(0, Math.floor(artifact.pdfBytes.length / 2));
    let threw = false;
    try {
      await verifyContextPdf(truncated, "hello world");
    } catch (err: unknown) {
      threw = true;
      expect(err instanceof ContextPackError).toBe(true);
      const code = (err as ContextPackError).code;
      expect(code === "MALFORMED_PDF" || code === "INVALID_TRANSPORT").toBe(true);
    }
    expect(threw).toBe(true);
  });

  test("failure — unknown option throws INVALID_CONTEXT without partial output", async () => {
    let threw = false;
    let artifact: VerifiedArtifact | null = null;
    try {
      artifact = await compileContext("hello", {
        fonts: dummyFonts(),
        // @ts-expect-error role must not be allowed
        role: "system",
      });
    } catch (err: unknown) {
      threw = true;
      expect(err instanceof ContextPackError).toBe(true);
      expect((err as ContextPackError).code).toBe("INVALID_CONTEXT");
    }
    expect(threw).toBe(true);
    expect(artifact).toBeNull();

    // verify unknown option
    const good = await compileContext("hello", { fonts: dummyFonts() });
    let threw2 = false;
    try {
      await verifyContextPdf(good.pdfBytes, "hello", {
        // @ts-expect-error unknown verify option
        unknownOption: true,
      });
    } catch (err: unknown) {
      threw2 = true;
      expect((err as ContextPackError).code).toBe("INVALID_CONTEXT");
    }
    expect(threw2).toBe(true);
  });

  test("typed error codes are exhaustive union", () => {
    const codes = [
      "INVALID_CONTEXT",
      "INVALID_CONTEXT_EMPTY",
      "UNSUPPORTED_GLYPH",
      "PAGE_BUDGET_EXCEEDED",
      "MALFORMED_PDF",
      "INTEGRITY_MISMATCH",
      "PDF_LIMIT_EXCEEDED",
      "INVALID_TRANSPORT",
      "ABORTED",
    ] as const;
    for (const code of codes) {
      const err = new ContextPackError(
        // need to satisfy details map; use minimal valid for each
        (() => {
          switch (code) {
            case "INVALID_CONTEXT":
              return { code, details: { reason: "test" } } as const;
            case "INVALID_CONTEXT_EMPTY":
              return { code, details: { reason: "empty" } } as const;
            case "UNSUPPORTED_GLYPH":
              return { code, details: { codePoint: 0x378, offset: 0 } } as const;
            case "PAGE_BUDGET_EXCEEDED":
              return { code, details: { pageBudget: 0, requiredPages: 1 } } as const;
            case "MALFORMED_PDF":
              return { code, details: { reason: "bad" } } as const;
            case "INTEGRITY_MISMATCH":
              return { code, details: { expectedHash: "a", actualHash: "b" } } as const;
            case "PDF_LIMIT_EXCEEDED":
              return { code, details: { limit: "64MiB", actual: 999 } } as const;
            case "INVALID_TRANSPORT":
              return { code, details: { reason: "bad" } } as const;
            case "ABORTED":
              return { code, details: { reason: "aborted" } } as const;
            default: {
              const _exhaustive: never = code;
              throw new Error(String(_exhaustive));
            }
          }
        })()
      );
      expect(err.code).toBe(code);
      // exhaustive switch at call site
      const msg: string = (() => {
        switch (err.code) {
          case "INVALID_CONTEXT":
            return "invalid";
          case "INVALID_CONTEXT_EMPTY":
            return "empty";
          case "UNSUPPORTED_GLYPH":
            return "glyph";
          case "PAGE_BUDGET_EXCEEDED":
            return "budget";
          case "MALFORMED_PDF":
            return "malformed";
          case "INTEGRITY_MISMATCH":
            return "integrity";
          case "PDF_LIMIT_EXCEEDED":
            return "limits";
          case "INVALID_TRANSPORT":
            return "transport";
          case "ABORTED":
            return "aborted";
          default: {
            const _never: never = err.code;
            return _never;
          }
        }
      })();
      expect(typeof msg).toBe("string");
    }
  });

  test("private brand cannot be forged via plain object", async () => {
    const artifact = await compileContext("hello", { fonts: dummyFonts() });
    // Plain object with fake brand string key should not pass isVerifiedArtifact
    const fake = {
      pdfBytes: artifact.pdfBytes,
      canonicalSource: artifact.canonicalSource,
      canonicalHash: artifact.canonicalHash,
      canonicalizationId: artifact.canonicalizationId,
      pageCount: 1,
      createdAt: artifact.createdAt,
      // Attempt to forge brand via string key
      verifiedBrand: true,
    };
    expect(isVerifiedArtifact(fake)).toBe(false);
    // Also fake with symbol of same description but different identity
    const otherSymbol = Symbol("VerifiedArtifact.brand");
    const fake2 = {
      [otherSymbol]: true,
      pdfBytes: artifact.pdfBytes,
      canonicalSource: artifact.canonicalSource,
      canonicalHash: artifact.canonicalHash,
      canonicalizationId: artifact.canonicalizationId,
      pageCount: 1,
      createdAt: artifact.createdAt,
    };
    expect(isVerifiedArtifact(fake2)).toBe(false);
    expect(isVerifiedArtifact(artifact)).toBe(true);
  });

  test("NFC/NFD hash equality while whitespace distinction holds via canonicalHash", async () => {
    const { canonicalHash } = await import("../src/canonicalization.js");
    const nfd = "e\u0301";
    const nfc = "\u00e9";
    expect(canonicalHash(nfd)).toBe(canonicalHash(nfc));
    expect(canonicalHash("a b")).not.toBe(canonicalHash("a  b"));
  });
});
