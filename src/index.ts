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
export { compileContext, verifyContextPdf } from "./compiler.js";
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
