/**
 * Record validation and creation — provenance-safe, integer micro-USD enforced.
 * Every field validated at runtime; non-integers and float dollars are rejected.
 */

import {
  type AccountingRecord,
  assertMicroUsd,
  type BenchmarkObservationRecord,
  type DerivedComparisonRecord,
  dollarsPerMillionToMicroUsd,
  type EstimatedRecord,
  type PerMillionMicroUsd,
  type PricingSnapshotRecord,
  type ProviderCountedRecord,
  type ProviderReportedCostRecord,
  type ProviderReportedUsageRecord,
  type RoundingRule,
} from "./types.js";

// ---------------------------------------------------------------------------
// Low-level validators
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateId(id: unknown): string {
  if (!isNonEmptyString(id)) throw new Error(`id must be non-empty string, got ${String(id)}`);
  return id;
}

function validateIso(iso: unknown, label: string): string {
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) {
    throw new Error(`${label} must be ISO-8601 string, got ${String(iso)}`);
  }
  return iso;
}

function validateLocator(loc: unknown): string {
  if (!isNonEmptyString(loc))
    throw new Error(`sourceLocator must be non-empty string, got ${String(loc)}`);
  return loc;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function validateSha256(sha: unknown): string {
  if (typeof sha !== "string" || !SHA256_RE.test(sha)) {
    throw new Error(`rawSha256 must be 64-char lowercase hex, got ${String(sha)}`);
  }
  return sha;
}

function validateOptionalString(v: unknown, label: string): string | undefined {
  if (v === undefined) return undefined;
  if (!isNonEmptyString(v))
    throw new Error(`${label} must be non-empty string if provided, got ${String(v)}`);
  return v;
}

function validateTokens(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || !Number.isSafeInteger(v) || v < 0) {
    throw new Error(`${label} must be non-negative safe integer tokens, got ${String(v)}`);
  }
  return v;
}

function validatePositiveRepetitions(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new Error(`repetitions must be integer >=1, got ${String(v)}`);
  }
  return v;
}

function validateDurationMs(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error(`durationMs must be finite non-negative number, got ${String(v)}`);
  }
  return v;
}

const ROUNDING_RE: Set<string> = new Set(["floor", "ceil", "nearest", "trunc"]);

function validateRoundingRule(v: unknown): RoundingRule {
  if (typeof v !== "string" || !ROUNDING_RE.has(v)) {
    throw new Error(`roundingRule must be one of floor|ceil|nearest|trunc, got ${String(v)}`);
  }
  return v as RoundingRule;
}

// ---------------------------------------------------------------------------
// Base validation — returns narrowed base fields
// ---------------------------------------------------------------------------

function validateBase(input: Record<string, unknown>): {
  id: string;
  observedAt: string;
  sourceLocator: string;
  rawSha256: string;
  provider: string | undefined;
  model: string | undefined;
} {
  const id = validateId(input.id);
  const observedAt = validateIso(input.observedAt, "observedAt");
  const sourceLocator = validateLocator(input.sourceLocator);
  const rawSha256 = validateSha256(input.rawSha256);
  const provider = validateOptionalString(input.provider, "provider");
  const model = validateOptionalString(input.model, "model");
  return { id, observedAt, sourceLocator, rawSha256, provider, model };
}

function spreadBase(base: ReturnType<typeof validateBase>): {
  id: string;
  observedAt: string;
  sourceLocator: string;
  rawSha256: string;
  provider?: string;
  model?: string;
} {
  return {
    id: base.id,
    observedAt: base.observedAt,
    sourceLocator: base.sourceLocator,
    rawSha256: base.rawSha256,
    ...(base.provider === undefined ? {} : { provider: base.provider }),
    ...(base.model === undefined ? {} : { model: base.model }),
  };
}

// ---------------------------------------------------------------------------
// Per-kind creators — each validates distinct shape and micro-USD invariants
// ---------------------------------------------------------------------------

export function createEstimatedRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tokens: number;
  readonly method: string;
  readonly estimatorVersion?: string;
}): EstimatedRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const tokens = validateTokens(input.tokens, "tokens");
  if (!isNonEmptyString(input.method)) throw new Error(`method must be non-empty string`);
  const estimatorVersion = validateOptionalString(input.estimatorVersion, "estimatorVersion");
  return {
    kind: "estimated",
    ...spreadBase(base),
    tokens,
    method: input.method,
    ...(estimatorVersion === undefined ? {} : { estimatorVersion }),
  };
}

export function createProviderCountedRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tokens: number;
  readonly counterId: string;
}): ProviderCountedRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const tokens = validateTokens(input.tokens, "tokens");
  if (!isNonEmptyString(input.counterId)) throw new Error(`counterId must be non-empty string`);
  return { kind: "provider-counted", ...spreadBase(base), tokens, counterId: input.counterId };
}

export function createProviderReportedUsageRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens?: number;
  readonly totalTokens: number;
  readonly cachedTokens?: number;
}): ProviderReportedUsageRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const inputTokens = validateTokens(input.inputTokens, "inputTokens");
  const totalTokens = validateTokens(input.totalTokens, "totalTokens");
  let outputTokens: number | undefined;
  if (input.outputTokens !== undefined)
    outputTokens = validateTokens(input.outputTokens, "outputTokens");
  let cachedTokens: number | undefined;
  if (input.cachedTokens !== undefined)
    cachedTokens = validateTokens(input.cachedTokens, "cachedTokens");
  return {
    kind: "provider-reported-usage",
    ...spreadBase(base),
    inputTokens,
    totalTokens,
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
  };
}

export function createProviderReportedCostRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly amountMicroUsd: number;
  readonly currency: "USD";
}): ProviderReportedCostRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const amountMicroUsd = assertMicroUsd(input.amountMicroUsd, "amountMicroUsd");
  if (input.currency !== "USD")
    throw new Error(`currency must be "USD", got ${String(input.currency)}`);
  return { kind: "provider-reported-cost", ...spreadBase(base), amountMicroUsd, currency: "USD" };
}

/**
 * Create pricing snapshot. Accepts either raw perMillionMicroUsd integers or
 * dollars-per-million floats via dollars field — but rejects float micro-USD.
 * Prefer direct integer fields; dollars helper shown for $0.75 => 750000 proof.
 */
export function createPricingSnapshotRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputPerMillionMicroUsd: number;
  readonly outputPerMillionMicroUsd: number;
  readonly effectiveAt: string;
}): PricingSnapshotRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const inputPerMillionMicroUsd = assertMicroUsd(
    input.inputPerMillionMicroUsd,
    "inputPerMillionMicroUsd"
  ) as PerMillionMicroUsd;
  const outputPerMillionMicroUsd = assertMicroUsd(
    input.outputPerMillionMicroUsd,
    "outputPerMillionMicroUsd"
  ) as PerMillionMicroUsd;
  const effectiveAt = validateIso(input.effectiveAt, "effectiveAt");
  return {
    kind: "pricing-snapshot",
    ...spreadBase(base),
    inputPerMillionMicroUsd,
    outputPerMillionMicroUsd,
    effectiveAt,
  };
}

/**
 * Helper to create pricing snapshot from float dollars-per-million — validates conversion.
 * Example: $0.75/1M -> 750_000
 */
export function createPricingSnapshotFromDollars(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputDollarsPerMillion: number;
  readonly outputDollarsPerMillion: number;
  readonly effectiveAt: string;
}): PricingSnapshotRecord {
  const inputPerMillionMicroUsd = dollarsPerMillionToMicroUsd(input.inputDollarsPerMillion);
  const outputPerMillionMicroUsd = dollarsPerMillionToMicroUsd(input.outputDollarsPerMillion);
  const baseInput: {
    id: string;
    observedAt: string;
    sourceLocator: string;
    rawSha256: string;
    provider?: string;
    model?: string;
    inputPerMillionMicroUsd: number;
    outputPerMillionMicroUsd: number;
    effectiveAt: string;
  } = {
    id: input.id,
    observedAt: input.observedAt,
    sourceLocator: input.sourceLocator,
    rawSha256: input.rawSha256,
    inputPerMillionMicroUsd,
    outputPerMillionMicroUsd,
    effectiveAt: input.effectiveAt,
  };
  if (input.provider !== undefined)
    (baseInput as Record<string, unknown>).provider = input.provider;
  if (input.model !== undefined) (baseInput as Record<string, unknown>).model = input.model;
  return createPricingSnapshotRecord(baseInput);
}

export function createDerivedComparisonRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly baselineId: string;
  readonly candidateId: string;
  readonly inputRecordIds: readonly string[];
  readonly roundingRule: RoundingRule;
  readonly deltaTokens?: number;
  readonly deltaMicroUsd?: number;
  readonly pricingSnapshotId?: string;
}): DerivedComparisonRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  if (!isNonEmptyString(input.baselineId)) throw new Error(`baselineId must be non-empty string`);
  if (!isNonEmptyString(input.candidateId)) throw new Error(`candidateId must be non-empty string`);
  if (!Array.isArray(input.inputRecordIds) || input.inputRecordIds.length < 2) {
    throw new Error(`inputRecordIds must be array with at least 2 ids`);
  }
  for (const rid of input.inputRecordIds) {
    if (!isNonEmptyString(rid)) throw new Error(`inputRecordIds entries must be non-empty strings`);
  }
  if (!input.inputRecordIds.includes(input.baselineId)) {
    throw new Error(`inputRecordIds must include baselineId`);
  }
  if (!input.inputRecordIds.includes(input.candidateId)) {
    throw new Error(`inputRecordIds must include candidateId`);
  }
  const roundingRule = validateRoundingRule(input.roundingRule);
  let deltaTokens: number | undefined;
  if (input.deltaTokens !== undefined) {
    if (typeof input.deltaTokens !== "number" || !Number.isInteger(input.deltaTokens)) {
      throw new Error(`deltaTokens must be integer if provided`);
    }
    deltaTokens = input.deltaTokens;
  }
  let deltaMicroUsd: number | undefined;
  if (input.deltaMicroUsd !== undefined) {
    if (
      typeof input.deltaMicroUsd !== "number" ||
      !Number.isInteger(input.deltaMicroUsd) ||
      !Number.isSafeInteger(input.deltaMicroUsd)
    ) {
      throw new Error(
        `deltaMicroUsd must be integer micro-USD, got ${String(input.deltaMicroUsd)}`
      );
    }
    deltaMicroUsd = input.deltaMicroUsd;
  }
  const pricingSnapshotId = validateOptionalString(input.pricingSnapshotId, "pricingSnapshotId");
  return {
    kind: "derived-comparison",
    ...spreadBase(base),
    baselineId: input.baselineId,
    candidateId: input.candidateId,
    inputRecordIds: [...input.inputRecordIds],
    roundingRule,
    ...(deltaTokens === undefined ? {} : { deltaTokens }),
    ...(deltaMicroUsd === undefined ? {} : { deltaMicroUsd }),
    ...(pricingSnapshotId === undefined ? {} : { pricingSnapshotId }),
  };
}

export function createBenchmarkObservationRecord(input: {
  readonly id: string;
  readonly observedAt: string;
  readonly sourceLocator: string;
  readonly rawSha256: string;
  readonly provider?: string;
  readonly model?: string;
  readonly durationMs: number;
  readonly repetitions: number;
  readonly inputTokens: number;
  readonly profile?: string;
}): BenchmarkObservationRecord {
  const base = validateBase(input as unknown as Record<string, unknown>);
  const durationMs = validateDurationMs(input.durationMs);
  const repetitions = validatePositiveRepetitions(input.repetitions);
  const inputTokens = validateTokens(input.inputTokens, "inputTokens");
  const profile = validateOptionalString(input.profile, "profile");
  return {
    kind: "benchmark-observation",
    ...spreadBase(base),
    durationMs,
    repetitions,
    inputTokens,
    ...(profile === undefined ? {} : { profile }),
  };
}

// ---------------------------------------------------------------------------
// Generic validator — exhaustive over all 7 kinds
// ---------------------------------------------------------------------------

export function validateAccountingRecord(record: unknown): AccountingRecord {
  if (typeof record !== "object" || record === null) throw new Error(`record must be object`);
  const rec = record as Record<string, unknown>;
  const kind = rec.kind as string;
  switch (kind) {
    case "estimated":
      return createEstimatedRecord(rec as unknown as Parameters<typeof createEstimatedRecord>[0]);
    case "provider-counted":
      return createProviderCountedRecord(
        rec as unknown as Parameters<typeof createProviderCountedRecord>[0]
      );
    case "provider-reported-usage":
      return createProviderReportedUsageRecord(
        rec as unknown as Parameters<typeof createProviderReportedUsageRecord>[0]
      );
    case "provider-reported-cost":
      return createProviderReportedCostRecord(
        rec as unknown as Parameters<typeof createProviderReportedCostRecord>[0]
      );
    case "pricing-snapshot":
      return createPricingSnapshotRecord(
        rec as unknown as Parameters<typeof createPricingSnapshotRecord>[0]
      );
    case "derived-comparison":
      return createDerivedComparisonRecord(
        rec as unknown as Parameters<typeof createDerivedComparisonRecord>[0]
      );
    case "benchmark-observation":
      return createBenchmarkObservationRecord(
        rec as unknown as Parameters<typeof createBenchmarkObservationRecord>[0]
      );
    default:
      throw new Error(`unknown accounting kind: ${String(kind)}`);
  }
}
