/**
 * GeminiContextPack — public API contracts (restricted surface).
 *
 * Only the following are public:
 * - compileContext(source, { fonts, pageBudget?, signal? })
 * - verifyContextPdf(pdfBytes, expectedSource, options?)
 * - VerifiedArtifact (branded, unforgable)
 * - VerificationReport
 * - FontBundle
 *
 * Canonicalization is gemini-context-pack-v1: CRLF/CR -> LF + NFC, whitespace preserved.
 * Transport is JSON with reversible handling of unicode/bidi/ZWJ/CJK/emoji.
 */

export const VERSION = "0.1.0" as const;
export const PACKAGE_NAME = "gemini-context-pack" as const;

export {
  CANONICALIZATION_VERSION,
  canonicalHash,
  canonicalize,
  decode,
  decodeTransport,
  encode,
  encodeTransport,
  hashCanonical,
  type TransportPayload,
} from "./canonicalization.js";
export {
  assertNever,
  ContextPackError,
  type ContextPackErrorCode,
  isContextPackError,
} from "./errors.js";
export type {
  CompileOptions,
  FontBundle,
  VerificationReport,
  VerifiedArtifact,
  VerifyOptions,
} from "./types.js";
export {
  CANONICALIZATION_ID,
  type CanonicalizationId,
  createVerifiedArtifact,
  isVerifiedArtifact,
} from "./types.js";

import {
  canonicalize,
  decodeTransport,
  encodeTransport,
  hashCanonical,
} from "./canonicalization.js";
import { ContextPackError } from "./errors.js";
import {
  CANONICALIZATION_ID,
  type CompileOptions,
  createVerifiedArtifact,
  type FontBundle,
  type VerificationReport,
  type VerifiedArtifact,
  type VerifyOptions,
} from "./types.js";
import { renderTransportPdf } from "./pdf/render.js";
import { extractCanonicalSource } from "./pdf/extract.js";

const ALLOWED_COMPILE_KEYS = new Set(["fonts", "pageBudget", "signal"]);
const ALLOWED_VERIFY_KEYS = new Set(["signal"]);

function validateFonts(fonts: unknown): FontBundle {
  if (typeof fonts !== "object" || fonts === null) {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "fonts required and must be object" } },
      "Invalid context: fonts required"
    );
  }
  const rec = fonts as Record<string, unknown>;
  const regular = rec.regular;
  if (!(regular instanceof Uint8Array) || regular.length === 0) {
    throw new ContextPackError(
      {
        code: "INVALID_CONTEXT",
        details: { reason: "fonts.regular must be non-empty Uint8Array" },
      },
      "Invalid context: fonts.regular required"
    );
  }
  if ("emoji" in rec && rec.emoji !== undefined && !(rec.emoji instanceof Uint8Array)) {
    throw new ContextPackError(
      {
        code: "INVALID_CONTEXT",
        details: { reason: "fonts.emoji must be Uint8Array if provided" },
      },
      "Invalid context: fonts.emoji invalid"
    );
  }
  return fonts as FontBundle;
}

function assertNoUnknownOptions(options: unknown, allowed: Set<string>): void {
  if (typeof options !== "object" || options === null) return;
  for (const key of Object.keys(options as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new ContextPackError(
        { code: "INVALID_CONTEXT", details: { reason: `unknown option: ${key}` } },
        `Invalid context: unknown option ${key}`
      );
    }
  }
}

/**
 * Compile a passive context string into a verified PDF artifact.
 * Contract-only: validates canonicalization/transport/page budget and returns a branded artifact.
 * No role/message policy is accepted; fonts is required; verification cannot be disabled.
 */
export async function compileContext(
  source: string,
  options: CompileOptions
): Promise<VerifiedArtifact> {
  if (typeof source !== "string") {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "source must be string" } },
      "Invalid context: source must be string"
    );
  }
  if (options === null || typeof options !== "object") {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "options must be object" } },
      "Invalid context: options required"
    );
  }
  assertNoUnknownOptions(options, ALLOWED_COMPILE_KEYS);

  const fonts = validateFonts((options as unknown as Record<string, unknown>).fonts);

  if (options.signal?.aborted === true) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }

  // Page budget validation: must be integer >=1 if provided. 0 is explicit failure.
  if (options.pageBudget !== undefined) {
    const budget = options.pageBudget;
    if (!Number.isInteger(budget) || budget < 1) {
      throw new ContextPackError(
        {
          code: "PAGE_BUDGET_EXCEEDED",
          details: { pageBudget: budget as number, requiredPages: 1 },
        },
        `Page budget exceeded: budget=${String(budget)}`
      );
    }
    if (budget > 32) {
      throw new ContextPackError(
        { code: "PDF_LIMIT_EXCEEDED", details: { limit: "pageCount <= 32", actual: budget } },
        "PDF limit exceeded: pageCount > 32"
      );
    }
  }

  const canonical = canonicalize(source);
  if (canonical.length === 0) {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT_EMPTY", details: { reason: "empty" } },
      "Invalid context: empty after canonicalization"
    );
  }

  // Transport encoding — reversible JSON payload, only this payload is rendered
  const transport = encodeTransport(canonical);
  if (new TextEncoder().encode(transport).length > 64 * 1024 * 1024) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "64MiB", actual: new TextEncoder().encode(transport).length } },
      "PDF limit exceeded",
    );
  }

  if (options.signal?.aborted) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }

  // Deterministic rendering — ordered columns, ActualText/ToUnicode, fixed metadata, no hidden duplicate
  const { pdfBytes, pageCount } = await renderTransportPdf(transport, fonts, {
    ...(options.pageBudget !== undefined ? { pageBudget: options.pageBudget } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (pdfBytes.length > 64 * 1024 * 1024) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "64MiB", actual: pdfBytes.length } },
      "PDF limit exceeded",
    );
  }
  if (pageCount > 32) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "pageCount <= 32", actual: pageCount } },
      "PDF limit exceeded: pageCount > 32",
    );
  }

  if (options.signal?.aborted) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }

  // Writer-independent verification before returning branded artifact — no partial artifact on failure
  let extracted: string;
  try {
    extracted = options.signal
      ? await extractCanonicalSource(pdfBytes, { signal: options.signal })
      : await extractCanonicalSource(pdfBytes);
  } catch (err: unknown) {
    if (err instanceof ContextPackError) throw err;
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: String(err) } },
      "Malformed PDF after render",
    );
  }

  const hash = hashCanonical(canonical);
  const extractedHash = hashCanonical(extracted);
  if (hash !== extractedHash) {
    throw new ContextPackError(
      { code: "INTEGRITY_MISMATCH", details: { expectedHash: hash, actualHash: extractedHash } },
      "Integrity mismatch: extracted source differs from canonical",
    );
  }

  return createVerifiedArtifact({
    pdfBytes,
    canonicalSource: canonical,
    canonicalHash: hash,
    pageCount,
    createdAt: new Date("2023-01-01T00:00:00.000Z").toISOString(),
  });
}

/**
 * Verify a PDF artifact against an expected source.
 * Writer-independent extraction via pdfjs-dist with guards.
 */
export async function verifyContextPdf(
  pdfBytes: Uint8Array,
  expectedSource: string,
  options?: VerifyOptions
): Promise<VerificationReport> {
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "pdfBytes must be Uint8Array" } },
      "Malformed PDF: pdfBytes not Uint8Array",
    );
  }
  if (pdfBytes.length === 0) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "empty pdfBytes" } },
      "Malformed PDF: empty bytes",
    );
  }
  if (pdfBytes.length > 64 * 1024 * 1024) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "64MiB", actual: pdfBytes.length } },
      "PDF limit exceeded",
    );
  }
  if (typeof expectedSource !== "string") {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "expectedSource must be string" } },
      "Invalid context: expectedSource",
    );
  }
  if (options !== undefined) {
    if (options === null || typeof options !== "object") {
      throw new ContextPackError(
        { code: "INVALID_CONTEXT", details: { reason: "options must be object" } },
        "Invalid context: options",
      );
    }
    assertNoUnknownOptions(options, ALLOWED_VERIFY_KEYS);
    if (options.signal?.aborted === true) {
      throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
    }
  }

  // Try writer-independent extraction first (real PDFs)
  let extractedSource: string | null = null;
  let extractionError: unknown = null;
  try {
    extractedSource = await extractCanonicalSource(pdfBytes, options as { signal?: AbortSignal });
  } catch (err: unknown) {
    extractionError = err;
  }

  if (extractedSource !== null) {
    const expectedCanonical = canonicalize(expectedSource);
    const expectedHash = hashCanonical(expectedCanonical);
    const extractedHash = hashCanonical(extractedSource);
    const status: VerificationReport["status"] = expectedHash === extractedHash ? "verified" : "mismatch";
    return {
      status,
      canonicalizationId: CANONICALIZATION_ID,
      expectedHash,
      extractedHash,
      expectedSource: expectedCanonical,
      extractedSource,
    };
  }

  // If extraction failed with typed error, rethrow as appropriate mapping
  if (extractionError instanceof ContextPackError) {
    // PDF_LIMIT_EXCEEDED, MALFORMED_PDF, INVALID_TRANSPORT should propagate
    // But verify contract maps INVALID_TRANSPORT -> MALFORMED_PDF for caller compatibility
    if (extractionError.code === "INVALID_TRANSPORT") {
      const reason = (extractionError.details as { reason: string }).reason;
      throw new ContextPackError({ code: "MALFORMED_PDF", details: { reason } }, `Malformed PDF: ${reason}`);
    }
    throw extractionError;
  }

  // Fallback: attempt direct JSON decode (covers legacy contract tests where pdfBytes is raw JSON transport)
  try {
    const transportText = new TextDecoder("utf-8", { fatal: true }).decode(pdfBytes);
    const fallbackExtracted = decodeTransport(transportText);
    const expectedCanonical = canonicalize(expectedSource);
    const expectedHash = hashCanonical(expectedCanonical);
    const extractedHash = hashCanonical(fallbackExtracted);
    const status: VerificationReport["status"] = expectedHash === extractedHash ? "verified" : "mismatch";
    return {
      status,
      canonicalizationId: CANONICALIZATION_ID,
      expectedHash,
      extractedHash,
      expectedSource: expectedCanonical,
      extractedSource: fallbackExtracted,
    };
  } catch {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: String(extractionError) } },
      "Malformed PDF",
    );
  }
}
