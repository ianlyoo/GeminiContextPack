/**
 * Canonicalization contract gemini-context-pack-v1.
 * - CRLF (\r\n) and CR (\r) are normalized to LF (\n) only
 * - NFC normalization applied
 * - All whitespace otherwise preserved byte-for-byte
 * - JSON transport reversibly encodes newlines/backslashes/quotes/control/bidi/ZWJ/CJK/emoji
 */
import { createHash } from "node:crypto";
import { ContextPackError } from "./errors.js";
import { CANONICALIZATION_ID, type CanonicalizationId } from "./types.js";

export const CANONICALIZATION_ID_EXPORT = CANONICALIZATION_ID;
export const CANONICALIZATION_VERSION = CANONICALIZATION_ID;
export { CANONICALIZATION_ID };

export interface TransportPayload {
  readonly v: CanonicalizationId;
  readonly content: string;
}

/**
 * Canonicalize source: CRLF/CR -> LF, then NFC. Whitespace preserved.
 */
export function canonicalize(source: string): string {
  // Replace CRLF first, then lone CR, then NFC normalize
  const lfNormalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return lfNormalized.normalize("NFC");
}

/**
 * Deterministic SHA-256 hex of canonical source (UTF-8).
 * NFC/NFD equivalence yields equal hashes; distinct whitespace yields distinct hashes.
 */
export function canonicalHash(source: string): string {
  const canonical = canonicalize(source);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashCanonical(canonical: string): string {
  // Assume already canonicalized; still normalize defensively
  const c = canonical.normalize("NFC");
  return createHash("sha256").update(c, "utf8").digest("hex");
}

/**
 * JSON transport: reversibly encodes all Unicode via JSON string.
 * Payload includes canonicalization id.
 */
export function encodeTransport(canonical: string): string {
  const payload: TransportPayload = {
    v: CANONICALIZATION_ID,
    content: canonical,
  };
  return JSON.stringify(payload);
}

/**
 * Alias for encodeTransport — encodes canonical source into JSON transport string.
 */
export function encode(canonical: string): string {
  return encodeTransport(canonical);
}

/**
 * Decode JSON transport, validate canonicalization id, return content.
 * Reversible: decode(encode(canonicalize(x))) === canonicalize(x)
 */
export function decodeTransport(payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ContextPackError(
      { code: "INVALID_TRANSPORT", details: { reason: "invalid JSON" } },
      "Invalid transport: not valid JSON"
    );
  }
  if (typeof parsed !== "object" || parsed === null || !("v" in parsed) || !("content" in parsed)) {
    throw new ContextPackError(
      { code: "INVALID_TRANSPORT", details: { reason: "missing v/content" } },
      "Invalid transport: missing v or content"
    );
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.v !== CANONICALIZATION_ID) {
    throw new ContextPackError(
      {
        code: "INVALID_TRANSPORT",
        details: { reason: `unexpected canonicalization id: ${String(rec.v)}` },
      },
      `Invalid transport: unexpected canonicalization id`
    );
  }
  if (typeof rec.content !== "string") {
    throw new ContextPackError(
      { code: "INVALID_TRANSPORT", details: { reason: "content not string" } },
      "Invalid transport: content not string"
    );
  }
  return rec.content;
}

export function decode(payload: string): string {
  return decodeTransport(payload);
}
