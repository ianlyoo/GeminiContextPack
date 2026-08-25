/**
 * Public type contracts — restricted surface.
 * Only FontBundle, VerifiedArtifact, VerificationReport, CompileOptions,
 * VerifyOptions are exposed. Brand is private to prevent forgery.
 */
import type { ContextPackError } from "./errors.js";

export const CANONICALIZATION_ID = "gemini-context-pack-v1" as const;
export type CanonicalizationId = typeof CANONICALIZATION_ID;

// Private brand — not exported. External callers cannot construct VerifiedArtifact.
// Use declare + runtime cast to get unique symbol nominality without export.
declare const verifiedBrand: unique symbol;
const verifiedBrandImpl = Symbol("VerifiedArtifact.brand") as unknown as typeof verifiedBrand;

export interface FontBundle {
  readonly regular: Uint8Array;
  readonly emoji?: Uint8Array;
}

export interface VerifiedArtifact {
  readonly [verifiedBrand]: true;
  readonly pdfBytes: Uint8Array;
  readonly canonicalSource: string;
  readonly canonicalHash: string;
  readonly canonicalizationId: CanonicalizationId;
  readonly pageCount: number;
  readonly createdAt: string;
}

export interface VerificationReport {
  readonly status: "verified" | "mismatch";
  readonly canonicalizationId: CanonicalizationId;
  readonly expectedHash: string;
  readonly extractedHash: string;
  readonly expectedSource: string;
  readonly extractedSource: string | null;
}

export interface CompileOptions {
  readonly fonts: FontBundle;
  readonly pageBudget?: number;
  readonly signal?: AbortSignal;
}

export interface VerifyOptions {
  readonly signal?: AbortSignal;
}

// Internal helper to create artifact with brand (only inside package)
export function createVerifiedArtifact(params: {
  readonly pdfBytes: Uint8Array;
  readonly canonicalSource: string;
  readonly canonicalHash: string;
  readonly pageCount: number;
  readonly createdAt: string;
}): VerifiedArtifact {
  return {
    [verifiedBrandImpl]: true as const,
    pdfBytes: params.pdfBytes,
    canonicalSource: params.canonicalSource,
    canonicalHash: params.canonicalHash,
    canonicalizationId: CANONICALIZATION_ID,
    pageCount: params.pageCount,
    createdAt: params.createdAt,
  } as unknown as VerifiedArtifact;
}

export function isVerifiedArtifact(value: unknown): value is VerifiedArtifact {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as unknown as Record<symbol, unknown>;
  return rec[verifiedBrandImpl as unknown as symbol] === true;
}

// Type-level compile helpers — ensure exhaustive error handling at call sites can switch on code
export type CompileResult =
  | { readonly ok: true; readonly artifact: VerifiedArtifact }
  | { readonly ok: false; readonly error: ContextPackError };

export type VerifyResult =
  | { readonly ok: true; readonly report: VerificationReport }
  | { readonly ok: false; readonly error: ContextPackError };
