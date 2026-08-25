/**
 * Gemini narrow adapter — verified PDF inline part + usage provenance.
 * Caller owns media resolution / control plane / generate call / auth.
 * No Files upload, JWT, OpenRouter, or system message composition here.
 */

export { toGeminiInlinePart } from "./inline-part.js";
export type { GeminiInlinePart } from "./types.js";
export {
  type GeminiModalityDetail,
  GeminiUsageParseError,
  type GeminiUsageParseFailure,
  type GeminiUsageParseResult,
  type GeminiUsageParseSuccess,
  type GeminiUsageProvenance,
  type GeminiUsageRecord,
} from "./types.js";
export { normalizeGeminiUsage, parseGeminiUsage, requireGeminiUsage } from "./usage.js";
