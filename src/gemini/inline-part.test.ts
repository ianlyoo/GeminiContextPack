import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { ContextPackError } from "../errors.js";
import { createVerifiedArtifact } from "../types.js";
import { toGeminiInlinePart } from "./inline-part.js";

function makeArtifact(bytes: Uint8Array) {
  return createVerifiedArtifact({
    pdfBytes: bytes,
    canonicalSource: "hello",
    canonicalHash: "a".repeat(64),
    pageCount: 1,
    createdAt: new Date("2023-01-01T00:00:00.000Z").toISOString(),
  });
}

describe("toGeminiInlinePart — exact inline part", () => {
  test("converts branded artifact to {inlineData:{mimeType:application/pdf, data:base64}}", () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // %PDF-1.7
    const artifact = makeArtifact(pdfBytes);
    const part = toGeminiInlinePart(artifact);
    expect(part.inlineData.mimeType).toBe("application/pdf");
    expect(part.inlineData.data).toBe(Buffer.from(pdfBytes).toString("base64"));
    // Must decode back to original bytes
    const decoded = Buffer.from(part.inlineData.data, "base64");
    expect(new Uint8Array(decoded)).toEqual(pdfBytes);
  });

  test("exact shape has only inlineData with mimeType and data", () => {
    const artifact = makeArtifact(new Uint8Array([1, 2, 3]));
    const part = toGeminiInlinePart(artifact);
    expect(Object.keys(part)).toEqual(["inlineData"]);
    expect(Object.keys(part.inlineData).sort()).toEqual(["data", "mimeType"]);
  });

  test("rejects unverified artifact (plain object without brand)", () => {
    const fake = {
      pdfBytes: new Uint8Array([1, 2, 3]),
      canonicalSource: "hello",
      canonicalHash: "a".repeat(64),
      canonicalizationId: "gemini-context-pack-v1" as const,
      pageCount: 1,
      createdAt: new Date().toISOString(),
    };
    expect(() =>
      toGeminiInlinePart(fake as unknown as Parameters<typeof toGeminiInlinePart>[0])
    ).toThrow(ContextPackError);
  });

  test("rejects object with forged string brand key", () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const forged = {
      pdfBytes,
      canonicalSource: "hello",
      canonicalHash: "b".repeat(64),
      canonicalizationId: "gemini-context-pack-v1" as const,
      pageCount: 1,
      createdAt: new Date().toISOString(),
      // Attempt string-key forgery should not pass private symbol check
      "VerifiedArtifact.brand": true,
    };
    expect(() =>
      toGeminiInlinePart(forged as unknown as Parameters<typeof toGeminiInlinePart>[0])
    ).toThrow();
  });

  test("rejects null/undefined", () => {
    expect(() =>
      toGeminiInlinePart(null as unknown as Parameters<typeof toGeminiInlinePart>[0])
    ).toThrow();
    expect(() =>
      toGeminiInlinePart(undefined as unknown as Parameters<typeof toGeminiInlinePart>[0])
    ).toThrow();
  });

  test("does not import auth/request framework", async () => {
    const fs = await import("node:fs");
    const pathMod = await import("node:path");
    const filePath = pathMod.join(import.meta.dir, "inline-part.ts");
    const content = fs.readFileSync(filePath, "utf8");
    // No provider request framework imports — check import statements, not comments
    expect(content).not.toMatch(/from\s+["'].*@google\/genai/);
    expect(content).not.toMatch(/from\s+["'].*openrouter/i);
    expect(content).not.toMatch(/import\s+.*\bJWT\b/);
    expect(content).not.toMatch(/import\s+.*\bgenerateContent\b/);
    // Ensure file only imports from allowed local modules
    const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    for (const src of imports) {
      expect(src.startsWith("./") || src.startsWith("../")).toBe(true);
    }
  });
});
