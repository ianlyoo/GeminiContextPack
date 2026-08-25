/**
 * Gemini usage normalizer — parses official JS SDK camelCase and historical Python snake_case.
 * Produces provider-reported accounting records with provenance + kind, no zero-fill, no invented totals.
 * Caller owns auth/request/generate; no Files/JWT/OpenRouter here.
 */

import type {
  GeminiModalityDetail,
  GeminiUsageParseResult,
  GeminiUsageProvenance,
  GeminiUsageRecord,
} from "./types.js";
import { GeminiUsageParseError } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function validateProvenance(p: GeminiUsageProvenance): void {
  if (typeof p.id !== "string" || p.id.trim().length === 0)
    throw new GeminiUsageParseError("INVALID_USAGE", "provenance id required");
  if (typeof p.observedAt !== "string" || Number.isNaN(Date.parse(p.observedAt)))
    throw new GeminiUsageParseError("INVALID_USAGE", "observedAt must be ISO-8601");
  if (typeof p.sourceLocator !== "string" || p.sourceLocator.trim().length === 0)
    throw new GeminiUsageParseError("INVALID_USAGE", "sourceLocator required");
  if (typeof p.rawSha256 !== "string" || !SHA256_RE.test(p.rawSha256))
    throw new GeminiUsageParseError("INVALID_USAGE", "rawSha256 must be 64 hex");
}

function getRawField(obj: Record<string, unknown>, camel: string, snake: string): unknown {
  if (camel in obj) return obj[camel];
  if (snake in obj) return obj[snake];
  return undefined;
}

function parseOptionalInt(
  obj: Record<string, unknown>,
  camel: string,
  snake: string
): number | undefined {
  const raw = getRawField(obj, camel, snake);
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    !Number.isSafeInteger(raw) ||
    raw < 0
  ) {
    throw new GeminiUsageParseError(
      "INVALID_USAGE",
      `invalid token count for ${camel}/${snake}: ${String(raw)}`
    );
  }
  return raw;
}

function parseOptionalModality(
  obj: Record<string, unknown>,
  camel: string,
  snake: string
): readonly GeminiModalityDetail[] | undefined {
  const raw = getRawField(obj, camel, snake);
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw))
    throw new GeminiUsageParseError("INVALID_USAGE", `modality details must be array for ${camel}`);
  const out: GeminiModalityDetail[] = [];
  for (const entry of raw) {
    if (!isObject(entry))
      throw new GeminiUsageParseError("INVALID_USAGE", "modality entry must be object");
    const modalityRaw = entry.modality;
    if (typeof modalityRaw !== "string" || modalityRaw.length === 0)
      throw new GeminiUsageParseError("INVALID_USAGE", "modality must be non-empty string");
    // token_count vs tokenCount
    let countRaw: unknown = entry.tokenCount;
    if (countRaw === undefined && "token_count" in entry) countRaw = entry.token_count;
    if (
      typeof countRaw !== "number" ||
      !Number.isFinite(countRaw) ||
      !Number.isInteger(countRaw) ||
      !Number.isSafeInteger(countRaw) ||
      countRaw < 0
    ) {
      throw new GeminiUsageParseError(
        "INVALID_USAGE",
        `invalid modality token_count for ${modalityRaw}`
      );
    }
    out.push({ modality: modalityRaw, tokenCount: countRaw });
  }
  return out;
}

// Unwrap usage container: handle {usageMetadata:{...}}, {raw:{...}}, {usage:{...}}, or direct.
function unwrapUsage(input: unknown): Record<string, unknown> | null {
  if (!isObject(input)) return null;
  // Direct has token fields
  if (hasUsageFields(input)) return input;
  // usageMetadata wrapper (official SDK)
  if ("usageMetadata" in input && isObject(input.usageMetadata)) {
    const inner = input.usageMetadata as Record<string, unknown>;
    if (hasUsageFields(inner)) return inner;
  }
  // raw wrapper (historical JSON like {raw:{prompt_token_count:...}})
  if ("raw" in input && isObject(input.raw)) {
    const inner = input.raw as Record<string, unknown>;
    if (hasUsageFields(inner)) return inner;
  }
  // usage wrapper
  if ("usage" in input && isObject(input.usage)) {
    const inner = input.usage as Record<string, unknown>;
    if (hasUsageFields(inner)) return inner;
    if (
      "raw" in inner &&
      isObject(inner.raw) &&
      hasUsageFields(inner.raw as Record<string, unknown>)
    ) {
      return inner.raw as Record<string, unknown>;
    }
  }
  // Also handle plain object that IS the usageMetadata (nested one level passed)
  return null;
}

function hasUsageFields(obj: Record<string, unknown>): boolean {
  const keys = [
    "promptTokenCount",
    "prompt_token_count",
    "candidatesTokenCount",
    "candidates_token_count",
    "totalTokenCount",
    "total_token_count",
    "thoughtsTokenCount",
    "thoughts_token_count",
    "cachedContentTokenCount",
    "cached_content_token_count",
    "promptTokensDetails",
    "prompt_tokens_details",
    "cacheTokensDetails",
    "cache_tokens_details",
  ];
  return keys.some((k) => k in obj);
}

// ---------------------------------------------------------------------------
// Core normalizer
// ---------------------------------------------------------------------------

export function normalizeGeminiUsage(
  raw: unknown,
  provenance: GeminiUsageProvenance
): GeminiUsageParseResult {
  try {
    validateProvenance(provenance);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: new GeminiUsageParseError("INVALID_USAGE", msg) };
  }

  // Resolve data object
  let data: Record<string, unknown> | null = null;
  if (isObject(raw) && hasUsageFields(raw)) {
    data = raw;
  } else {
    data = unwrapUsage(raw);
    // Also allow raw being directly the metadata values container without wrapper detection
    if (data === null && isObject(raw)) {
      // Try raw itself if it has at least one modality or token field via alternative names
      // For historical fallback, treat raw object as data if it at least has one of the modality detail keys
      data = null;
    }
  }
  if (data === null) {
    return {
      ok: false,
      error: new GeminiUsageParseError("INVALID_USAGE", "unrecognized Gemini usage shape"),
    };
  }

  try {
    const inputTokens = parseOptionalInt(data, "promptTokenCount", "prompt_token_count");
    const outputTokens = parseOptionalInt(data, "candidatesTokenCount", "candidates_token_count");
    const totalTokens = parseOptionalInt(data, "totalTokenCount", "total_token_count");
    const cachedTokens = parseOptionalInt(
      data,
      "cachedContentTokenCount",
      "cached_content_token_count"
    );
    const thoughtsTokens = parseOptionalInt(data, "thoughtsTokenCount", "thoughts_token_count");
    const promptModalities = parseOptionalModality(
      data,
      "promptTokensDetails",
      "prompt_tokens_details"
    );
    const cachedModalities = parseOptionalModality(
      data,
      "cacheTokensDetails",
      "cache_tokens_details"
    );
    const candidatesModalities = parseOptionalModality(
      data,
      "candidatesTokensDetails",
      "candidates_tokens_details"
    );

    // Require at least one token or modality present; otherwise malformed without invented totals
    const hasAny =
      inputTokens !== undefined ||
      outputTokens !== undefined ||
      totalTokens !== undefined ||
      cachedTokens !== undefined ||
      thoughtsTokens !== undefined ||
      promptModalities !== undefined ||
      cachedModalities !== undefined ||
      candidatesModalities !== undefined;
    if (!hasAny) {
      return {
        ok: false,
        error: new GeminiUsageParseError("INVALID_USAGE", "no usage fields present"),
      };
    }

    // Build provenance-spread record — missing remain undefined, not zero-filled
    const record: GeminiUsageRecord = {
      kind: "provider-reported-usage",
      id: provenance.id,
      observedAt: provenance.observedAt,
      sourceLocator: provenance.sourceLocator,
      rawSha256: provenance.rawSha256,
      ...(provenance.provider === undefined ? {} : { provider: provenance.provider }),
      ...(provenance.model === undefined ? {} : { model: provenance.model }),
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(cachedTokens === undefined ? {} : { cachedTokens }),
      ...(thoughtsTokens === undefined ? {} : { thoughtsTokens }),
      ...(promptModalities === undefined ? {} : { promptModalities }),
      ...(cachedModalities === undefined ? {} : { cachedModalities }),
      ...(candidatesModalities === undefined ? {} : { candidatesModalities }),
    } as GeminiUsageRecord;

    return { ok: true, record };
  } catch (e) {
    if (e instanceof GeminiUsageParseError) return { ok: false, error: e };
    return { ok: false, error: new GeminiUsageParseError("INVALID_USAGE", String(e)) };
  }
}

/** Alias for normalizer — identical behavior */
export const parseGeminiUsage = normalizeGeminiUsage;

/** Helper to produce record or throw typed error (for callers preferring throw). */
export function requireGeminiUsage(
  raw: unknown,
  provenance: GeminiUsageProvenance
): GeminiUsageRecord {
  const res = normalizeGeminiUsage(raw, provenance);
  if (!res.ok) throw res.error;
  return res.record;
}
