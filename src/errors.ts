/**
 * Typed error contracts for gemini-context-pack.
 * Exhaustive union covers invalid context, unsupported glyph, page budget,
 * malformed PDF, integrity, and PDF limits as discriminated unions.
 */

export type ContextPackErrorCode =
  | "INVALID_CONTEXT"
  | "INVALID_CONTEXT_EMPTY"
  | "UNSUPPORTED_GLYPH"
  | "PAGE_BUDGET_EXCEEDED"
  | "MALFORMED_PDF"
  | "INTEGRITY_MISMATCH"
  | "PDF_LIMIT_EXCEEDED"
  | "INVALID_TRANSPORT"
  | "ABORTED";

export interface ContextPackErrorDetailsMap {
  INVALID_CONTEXT: { readonly reason: string };
  INVALID_CONTEXT_EMPTY: { readonly reason: "empty" };
  UNSUPPORTED_GLYPH: { readonly codePoint: number; readonly offset: number };
  PAGE_BUDGET_EXCEEDED: { readonly pageBudget: number; readonly requiredPages: number };
  MALFORMED_PDF: { readonly reason: string };
  INTEGRITY_MISMATCH: {
    readonly expectedHash: string;
    readonly actualHash: string;
  };
  PDF_LIMIT_EXCEEDED: { readonly limit: string; readonly actual: number };
  INVALID_TRANSPORT: { readonly reason: string };
  ABORTED: { readonly reason: string };
}

export type ContextPackErrorEntry = {
  [K in ContextPackErrorCode]: {
    readonly code: K;
    readonly details: ContextPackErrorDetailsMap[K];
  };
}[ContextPackErrorCode];

export class ContextPackError extends Error {
  public readonly code: ContextPackErrorCode;
  public readonly details: ContextPackErrorDetailsMap[ContextPackErrorCode];

  public constructor(entry: ContextPackErrorEntry, message?: string) {
    super(message ?? `${entry.code}: ${JSON.stringify(entry.details)}`);
    this.name = "ContextPackError";
    this.code = entry.code;
    // Use type assertion via unknown to preserve exhaustive typing without any
    this.details = entry.details as ContextPackErrorDetailsMap[ContextPackErrorCode];
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}

export function isContextPackError(err: unknown): err is ContextPackError {
  return err instanceof ContextPackError;
}
