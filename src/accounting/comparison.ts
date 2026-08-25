/**
 * Comparison logic — provenance and unit safe.
 * Mixing estimate vs provider requires explicit flag; mixing units (tokens vs cost vs pricing) always fails.
 * Unlabeled totals are never emitted; derived record always carries inputRecordIds + roundingRule.
 */

import { createHash } from "node:crypto";
import { createDerivedComparisonRecord } from "./records.js";
import {
  type AccountingRecord,
  assertNever,
  type DerivedComparisonRecord,
  type PricingSnapshotRecord,
  type RoundingRule,
} from "./types.js";

// ---------------------------------------------------------------------------
// Provenance and unit classification — exhaustive switches
// ---------------------------------------------------------------------------

type ProvenanceGroup = "estimated" | "provider" | "pricing" | "derived" | "benchmark";

function provenanceOf(record: AccountingRecord): ProvenanceGroup {
  switch (record.kind) {
    case "estimated":
      return "estimated";
    case "provider-counted":
      return "provider";
    case "provider-reported-usage":
      return "provider";
    case "provider-reported-cost":
      return "provider";
    case "pricing-snapshot":
      return "pricing";
    case "derived-comparison":
      return "derived";
    case "benchmark-observation":
      return "benchmark";
    default:
      return assertNever(record);
  }
}

type UnitGroup = "tokens" | "cost" | "pricing" | "comparison" | "benchmark";

function unitOf(record: AccountingRecord): UnitGroup {
  switch (record.kind) {
    case "estimated":
      return "tokens";
    case "provider-counted":
      return "tokens";
    case "provider-reported-usage":
      return "tokens";
    case "provider-reported-cost":
      return "cost";
    case "pricing-snapshot":
      return "pricing";
    case "derived-comparison":
      return "comparison";
    case "benchmark-observation":
      return "benchmark";
    default:
      return assertNever(record);
  }
}

function tokensOf(record: AccountingRecord): number | null {
  switch (record.kind) {
    case "estimated":
      return record.tokens;
    case "provider-counted":
      return record.tokens;
    case "provider-reported-usage":
      return record.inputTokens;
    case "provider-reported-cost":
      return null;
    case "pricing-snapshot":
      return null;
    case "derived-comparison":
      return record.deltaTokens ?? null;
    case "benchmark-observation":
      return record.inputTokens;
    default:
      return assertNever(record);
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type ComparisonErrorCode =
  | "MIXED_PROVENANCE"
  | "MIXED_UNIT"
  | "UNLABELED_TOTAL"
  | "INVALID_INPUT";

export class ComparisonError extends Error {
  public readonly code: ComparisonErrorCode;
  public constructor(code: ComparisonErrorCode, message: string) {
    super(message);
    this.name = "ComparisonError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Options and helpers
// ---------------------------------------------------------------------------

export interface ComparisonOptions {
  readonly allowMixedProvenance?: boolean | undefined;
  readonly pricingSnapshot?: PricingSnapshotRecord | undefined;
  readonly roundingRule?: RoundingRule | undefined;
  readonly derivedId?: string | undefined;
  readonly derivedObservedAt?: string | undefined;
  readonly derivedSourceLocator?: string | undefined;
  readonly derivedRawSha256?: string | undefined;
}

function applyRounding(value: number, rule: RoundingRule): number {
  switch (rule) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "nearest":
      return Math.round(value);
    case "trunc":
      return Math.trunc(value);
    default:
      return assertNever(rule);
  }
}

function hashIds(ids: readonly string[]): string {
  const h = createHash("sha256");
  for (const id of ids) {
    h.update(id);
    h.update("\0");
  }
  return h.digest("hex");
}

function defaultDerivedBase(
  baseline: AccountingRecord,
  candidate: AccountingRecord,
  pricingSnapshot: PricingSnapshotRecord | undefined,
  roundingRule: RoundingRule
): { id: string; observedAt: string; sourceLocator: string; rawSha256: string } {
  const ids = pricingSnapshot
    ? [baseline.id, candidate.id, pricingSnapshot.id]
    : [baseline.id, candidate.id];
  return {
    id: `derived-${baseline.id}-${candidate.id}`,
    observedAt: new Date().toISOString(),
    sourceLocator: `derived:${ids.join("+")}:${roundingRule}`,
    rawSha256: hashIds(ids),
  };
}

// ---------------------------------------------------------------------------
// Core comparison — provenance/unit safe, records input ids + rounding
// ---------------------------------------------------------------------------

export function compareAccountingRecords(
  baseline: AccountingRecord,
  candidate: AccountingRecord,
  options: ComparisonOptions = {}
): DerivedComparisonRecord {
  const allowMixedProvenance = options.allowMixedProvenance ?? false;
  const roundingRule: RoundingRule = options.roundingRule ?? "nearest";
  // Validate roundingRule exhaustive
  switch (roundingRule) {
    case "floor":
    case "ceil":
    case "nearest":
    case "trunc":
      break;
    default:
      return assertNever(roundingRule);
  }

  // ---- Prevent unlabeled total mixing (must run before unit check to surface correct code) ----
  if (baseline.kind === "derived-comparison" || candidate.kind === "derived-comparison") {
    throw new ComparisonError(
      "UNLABELED_TOTAL",
      `cannot compare derived-comparison records as raw totals without provenance trace`
    );
  }
  if (baseline.kind === "pricing-snapshot" && candidate.kind === "pricing-snapshot") {
    throw new ComparisonError(
      "UNLABELED_TOTAL",
      `cannot derive savings from two pricing snapshots alone`
    );
  }

  // ---- Same-unit check ----
  const baselineUnit = unitOf(baseline);
  const candidateUnit = unitOf(candidate);
  if (baselineUnit !== candidateUnit) {
    throw new ComparisonError(
      "MIXED_UNIT",
      `cannot compare ${baseline.kind} (${baselineUnit}) vs ${candidate.kind} (${candidateUnit}): mixed units without labeled conversion`
    );
  }

  // ---- Same-provenance check (groups) ----
  const baselineProv = provenanceOf(baseline);
  const candidateProv = provenanceOf(candidate);
  const sameKind = baseline.kind === candidate.kind;
  const sameProvGroup = baselineProv === candidateProv;
  if (!sameProvGroup || !sameKind) {
    if (!allowMixedProvenance) {
      throw new ComparisonError(
        "MIXED_PROVENANCE",
        `mixing ${baseline.kind} (${baselineProv}) vs ${candidate.kind} (${candidateProv}) requires allowMixedProvenance=true`
      );
    }
  }

  // ---- Compute deltas ----
  const baselineTokens = tokensOf(baseline);
  const candidateTokens = tokensOf(candidate);
  let deltaTokens: number | undefined;
  let deltaMicroUsd: number | undefined;
  let pricingSnapshotId: string | undefined;

  if (baselineTokens !== null && candidateTokens !== null) {
    deltaTokens = baselineTokens - candidateTokens;
  }

  // If both are cost records, compute cost delta directly
  if (baseline.kind === "provider-reported-cost" && candidate.kind === "provider-reported-cost") {
    deltaMicroUsd = baseline.amountMicroUsd - candidate.amountMicroUsd;
    // deltaTokens stays undefined for cost unit
    deltaTokens = undefined;
  } else if (options.pricingSnapshot !== undefined) {
    const ps = options.pricingSnapshot;
    pricingSnapshotId = ps.id;
    if (deltaTokens !== undefined) {
      const raw = (deltaTokens * ps.inputPerMillionMicroUsd) / 1_000_000;
      deltaMicroUsd = applyRounding(raw, roundingRule);
    }
  }

  // Build derived base provenance
  const base =
    options.derivedId !== undefined ||
    options.derivedObservedAt !== undefined ||
    options.derivedSourceLocator !== undefined ||
    options.derivedRawSha256 !== undefined
      ? {
          id: options.derivedId ?? `derived-${baseline.id}-${candidate.id}`,
          observedAt: options.derivedObservedAt ?? new Date().toISOString(),
          sourceLocator: options.derivedSourceLocator ?? `derived:${baseline.id}+${candidate.id}`,
          rawSha256: options.derivedRawSha256 ?? hashIds([baseline.id, candidate.id]),
        }
      : defaultDerivedBase(baseline, candidate, options.pricingSnapshot, roundingRule);

  const inputRecordIds: readonly string[] = pricingSnapshotId
    ? [baseline.id, candidate.id, pricingSnapshotId]
    : [baseline.id, candidate.id];

  // Validate base provenance via createDerivedComparisonRecord
  return createDerivedComparisonRecord({
    id: base.id,
    observedAt: base.observedAt,
    sourceLocator: base.sourceLocator,
    rawSha256: base.rawSha256,
    baselineId: baseline.id,
    candidateId: candidate.id,
    inputRecordIds,
    roundingRule,
    ...(deltaTokens === undefined ? {} : { deltaTokens }),
    ...(deltaMicroUsd === undefined ? {} : { deltaMicroUsd }),
    ...(pricingSnapshotId === undefined ? {} : { pricingSnapshotId }),
  });
}

/**
 * Convenience: compare two provider-reported-usage records (plain vs PDF)
 * with optional pricing snapshot. Enforces same-unit/provenance without mixing.
 */
export function compareUsage(
  plain: AccountingRecord,
  pdf: AccountingRecord,
  pricingSnapshot?: PricingSnapshotRecord | undefined,
  roundingRule: RoundingRule = "nearest"
): DerivedComparisonRecord {
  const opts: ComparisonOptions = { roundingRule };
  if (pricingSnapshot !== undefined)
    (opts as Record<string, unknown>).pricingSnapshot = pricingSnapshot;
  return compareAccountingRecords(plain, pdf, opts);
}
