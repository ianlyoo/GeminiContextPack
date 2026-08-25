/**
 * Narrow inline-part adapter — only accepts branded VerifiedArtifact.
 * Caller owns media resolution, auth, and generate call; no upload/JWT/OpenRouter.
 */

import { ContextPackError } from "../errors.js";
import { isVerifiedArtifact, type VerifiedArtifact } from "../types.js";
import type { GeminiInlinePart } from "./types.js";

/**
 * Convert a verified PDF artifact into a Gemini inlineData part.
 * Shape: { inlineData: { mimeType: "application/pdf", data: base64 } }
 * Rejects unverified artifacts (runtime brand check, no forgery).
 */
export function toGeminiInlinePart(artifact: VerifiedArtifact): GeminiInlinePart {
  if (!isVerifiedArtifact(artifact)) {
    throw new ContextPackError(
      {
        code: "INVALID_CONTEXT",
        details: { reason: "unverified artifact — must be VerifiedArtifact from compileContext" },
      },
      "Invalid artifact: unverified"
    );
  }
  // Deterministic base64 of pdfBytes — Buffer is available in Node/Bun; fallback to btoa path for browser-neutral.
  const bytes = artifact.pdfBytes;
  let base64: string;
  const maybeBuffer = (
    globalThis as unknown as {
      Buffer?: { from: (u: Uint8Array) => { toString: (e: string) => string } };
    }
  ).Buffer;
  if (maybeBuffer !== undefined) {
    base64 = maybeBuffer.from(bytes).toString("base64");
  } else {
    // Browser fallback — binary string via fromCharCode chunked
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...sub);
    }
    base64 = btoa(binary);
  }
  return {
    inlineData: {
      mimeType: "application/pdf",
      data: base64,
    },
  };
}
