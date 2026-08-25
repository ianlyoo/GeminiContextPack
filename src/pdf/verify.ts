/**
 * Strict verification: writer-independent extraction + SHA equality.
 * Only SHA-equal canonical sources yield status 'verified'.
 * Uses pdfjs-dist extraction, ignores EOL, enforces guards.
 */
import { canonicalize, hashCanonical } from "../canonicalization.js";
import { ContextPackError } from "../errors.js";
import { CANONICALIZATION_ID, type VerificationReport } from "../types.js";
import { extractCanonicalSource, MAX_PAGES, MAX_PDF_BYTES } from "./extract.js";

export { MAX_PAGES, MAX_PDF_BYTES };

export interface VerifyPdfOptions {
  readonly signal?: AbortSignal;
}

/**
 * Core verification — returns VerificationReport.
 * Throws MALFORMED_PDF, PDF_LIMIT_EXCEEDED, INVALID_TRANSPORT, ABORTED
 * on extraction failures. On source mismatch, returns report with status 'mismatch'
 * (not thrown). Use verifyPdfStrict for throwing INTEGRITY_MISMATCH.
 */
export async function verifyPdf(
  pdfBytes: Uint8Array,
  expectedSource: string,
  options?: VerifyPdfOptions
): Promise<VerificationReport> {
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "pdfBytes must be Uint8Array" } },
      "Malformed PDF: pdfBytes not Uint8Array"
    );
  }
  if (typeof expectedSource !== "string") {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "expectedSource must be string" } },
      "Invalid context: expectedSource"
    );
  }
  if (options?.signal?.aborted) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }
  if (options !== undefined && (options === null || typeof options !== "object")) {
    throw new ContextPackError(
      { code: "INVALID_CONTEXT", details: { reason: "options must be object" } },
      "Invalid context: options"
    );
  }

  // Extracted source via writer-independent pdfjs path (guards inside)
  const extractedSource = await extractCanonicalSource(pdfBytes, options);

  const expectedCanonical = canonicalize(expectedSource);
  const expectedHash = hashCanonical(expectedCanonical);
  // extractedSource is already canonical (from decodeTransport), but hash via hashCanonical for NFC safety
  const extractedHash = hashCanonical(canonicalize(extractedSource));

  const status: VerificationReport["status"] =
    expectedHash === extractedHash ? "verified" : "mismatch";

  return {
    status,
    canonicalizationId: CANONICALIZATION_ID,
    expectedHash,
    extractedHash,
    expectedSource: expectedCanonical,
    extractedSource,
  };
}

/**
 * Strict variant that throws INTEGRITY_MISMATCH on hash inequality.
 * Useful for fail-closed orchestration and to satisfy typed-failure mapping.
 */
export async function verifyPdfStrict(
  pdfBytes: Uint8Array,
  expectedSource: string,
  options?: VerifyPdfOptions
): Promise<VerificationReport> {
  const report = await verifyPdf(pdfBytes, expectedSource, options);
  if (report.status !== "verified") {
    throw new ContextPackError(
      {
        code: "INTEGRITY_MISMATCH",
        details: { expectedHash: report.expectedHash, actualHash: report.extractedHash },
      },
      "Integrity mismatch: extracted source differs from expected"
    );
  }
  return report;
}

// Aliases for compatibility with existing public API surface
export const verifyContextPdf = verifyPdf;
export const verify = verifyPdf;
export const verifyArtifact = verifyPdf;
