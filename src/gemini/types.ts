/**
 * Gemini narrow adapter types — inline part and usage provenance.
 * No auth/request framework imports; caller owns media resolution/control plane/generate call.
 */

import type { AccountingBase } from "../accounting/types.js";

// ---------------------------------------------------------------------------
// Inline part
// ---------------------------------------------------------------------------

export interface GeminiInlinePart {
  readonly inlineData: {
    readonly mimeType: "application/pdf";
    readonly data: string; // base64 of pdfBytes
  };
}

// ---------------------------------------------------------------------------
// Modality details
// ---------------------------------------------------------------------------

export interface GeminiModalityDetail {
  readonly modality: string;
  readonly tokenCount: number;
}

// ---------------------------------------------------------------------------
// Provider-reported usage record with Gemini specifics
// Keeps kind + provenance, optional tokens remain absent (undefined) not zero-filled.
// Thoughts and modality breakdown are provider-reported but not zero-filled.
// ---------------------------------------------------------------------------

export interface GeminiUsageRecord extends AccountingBase {
  readonly kind: "provider-reported-usage";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedTokens?: number;
  readonly thoughtsTokens?: number;
  readonly promptModalities?: readonly GeminiModalityDetail[];
  readonly cachedModalities?: readonly GeminiModalityDetail[];
  readonly candidatesModalities?: readonly GeminiModalityDetail[];
}

// Provenance input for normalizer — caller supplies stable locator/sha.
export interface GeminiUsageProvenance {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
}

// ---------------------------------------------------------------------------
// Typed parse failure — no invented totals
// ---------------------------------------------------------------------------

export type GeminiUsageParseErrorCode = "INVALID_USAGE";

export class GeminiUsageParseError extends Error {
  public readonly code: GeminiUsageParseErrorCode;

  public constructor(code: GeminiUsageParseErrorCode, message: string) {
    super(message);
    this.name = "GeminiUsageParseError";
    this.code = code;
  }
}

export type GeminiUsageParseSuccess = {
  readonly ok: true;
  readonly record: GeminiUsageRecord;
};

export type GeminiUsageParseFailure = {
  readonly ok: false;
  readonly error: GeminiUsageParseError;
};

export type GeminiUsageParseResult = GeminiUsageParseSuccess | GeminiUsageParseFailure;
