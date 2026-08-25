/**
 * Provenance-safe accounting types — seven distinct kinds.
 * Money is integer micro-USD; pricing is per-million micro-USD.
 * Each record requires stable id, observedAt, source locator/raw SHA,
 * and optional provider/model. Derived comparison records input ids + rounding.
 */

export type AccountingKind =
  | "estimated"
  | "provider-counted"
  | "provider-reported-usage"
  | "provider-reported-cost"
  | "pricing-snapshot"
  | "derived-comparison"
  | "benchmark-observation";

export type RoundingRule = "floor" | "ceil" | "nearest" | "trunc";

/**
 * Integer micro-USD — 1 USD = 1_000_000 micro-USD.
 * Example: $0.75 / 1M tokens = 750_000 micro-USD per million.
 * Must be integer, finite, safe integer, >=0.
 */
export type MicroUsd = number;

/**
 * Per-million micro-USD pricing. Same invariant as MicroUsd but
 * semantically priced per 1M tokens. $0.75/1M === 750_000.
 */
export type PerMillionMicroUsd = number;

export interface AccountingBase {
  readonly id: string;
  readonly observedAt: string; // ISO-8601
  readonly sourceLocator: string;
  readonly rawSha256: string; // 64 hex lowercase
  readonly provider?: string;
  readonly model?: string;
}

// ---------------------------------------------------------------------------
// Seven distinct shapes — each has a unique required field set beyond `kind`
// ---------------------------------------------------------------------------

export interface EstimatedRecord extends AccountingBase {
  readonly kind: "estimated";
  /** Estimated token count (heuristic, not provider). */
  readonly tokens: number;
  readonly method: string;
  readonly estimatorVersion?: string;
}

export interface ProviderCountedRecord extends AccountingBase {
  readonly kind: "provider-counted";
  /** Tokens as counted by provider countTokens API. */
  readonly tokens: number;
  readonly counterId: string;
}

export interface ProviderReportedUsageRecord extends AccountingBase {
  readonly kind: "provider-reported-usage";
  readonly inputTokens: number;
  readonly outputTokens?: number;
  readonly totalTokens: number;
  readonly cachedTokens?: number;
}

export interface ProviderReportedCostRecord extends AccountingBase {
  readonly kind: "provider-reported-cost";
  /** Billed amount in integer micro-USD. */
  readonly amountMicroUsd: MicroUsd;
  readonly currency: "USD";
}

export interface PricingSnapshotRecord extends AccountingBase {
  readonly kind: "pricing-snapshot";
  /** Price per 1M input tokens in micro-USD. e.g. $0.75/1M => 750_000 */
  readonly inputPerMillionMicroUsd: PerMillionMicroUsd;
  readonly outputPerMillionMicroUsd: PerMillionMicroUsd;
  readonly effectiveAt: string; // ISO-8601
}

export interface DerivedComparisonRecord extends AccountingBase {
  readonly kind: "derived-comparison";
  readonly baselineId: string;
  readonly candidateId: string;
  /** All input record ids that contributed — must include baseline + candidate, plus pricing if used. */
  readonly inputRecordIds: readonly string[];
  readonly roundingRule: RoundingRule;
  readonly deltaTokens?: number;
  readonly deltaMicroUsd?: MicroUsd;
  readonly pricingSnapshotId?: string;
}

export interface BenchmarkObservationRecord extends AccountingBase {
  readonly kind: "benchmark-observation";
  readonly durationMs: number;
  readonly repetitions: number;
  readonly inputTokens: number;
  readonly profile?: string;
}

export type AccountingRecord =
  | EstimatedRecord
  | ProviderCountedRecord
  | ProviderReportedUsageRecord
  | ProviderReportedCostRecord
  | PricingSnapshotRecord
  | DerivedComparisonRecord
  | BenchmarkObservationRecord;

// ---------------------------------------------------------------------------
// Exhaustive helpers — must use `never` to prove all 7 kinds handled
// ---------------------------------------------------------------------------

export function assertNever(value: never): never {
  throw new Error(`Unhandled accounting kind: ${String(value)}`);
}

export function describeRecordKind(record: AccountingRecord): string {
  switch (record.kind) {
    case "estimated":
      return `estimated:${record.method}:${record.tokens}`;
    case "provider-counted":
      return `provider-counted:${record.counterId}:${record.tokens}`;
    case "provider-reported-usage":
      return `provider-reported-usage:${record.inputTokens}/${record.totalTokens}`;
    case "provider-reported-cost":
      return `provider-reported-cost:${record.amountMicroUsd} ${record.currency}`;
    case "pricing-snapshot":
      return `pricing-snapshot:${record.inputPerMillionMicroUsd}/${record.outputPerMillionMicroUsd}`;
    case "derived-comparison":
      return `derived-comparison:${record.baselineId}->${record.candidateId}:${record.roundingRule}`;
    case "benchmark-observation":
      return `benchmark-observation:${record.durationMs}ms x${record.repetitions}`;
    default:
      return assertNever(record);
  }
}

export function getAccountingKindLabel(kind: AccountingKind): string {
  switch (kind) {
    case "estimated":
      return "estimated";
    case "provider-counted":
      return "provider-counted";
    case "provider-reported-usage":
      return "provider-reported-usage";
    case "provider-reported-cost":
      return "provider-reported-cost";
    case "pricing-snapshot":
      return "pricing-snapshot";
    case "derived-comparison":
      return "derived-comparison";
    case "benchmark-observation":
      return "benchmark-observation";
    default:
      return assertNever(kind);
  }
}

/**
 * Convert dollars per million tokens to integer per-million micro-USD.
 * Rejects non-finite / non-integer micro result. $0.75 => 750_000.
 */
export function dollarsPerMillionToMicroUsd(dollarsPerMillion: number): PerMillionMicroUsd {
  if (!Number.isFinite(dollarsPerMillion)) {
    throw new Error(`dollarsPerMillion must be finite: ${String(dollarsPerMillion)}`);
  }
  const micro = dollarsPerMillion * 1_000_000;
  if (!Number.isInteger(micro)) {
    throw new Error(
      `dollarsPerMillion yields non-integer micro-USD: ${dollarsPerMillion} -> ${micro}`
    );
  }
  if (!Number.isSafeInteger(micro) || micro < 0) {
    throw new Error(`per-million micro-USD must be safe non-negative integer: ${micro}`);
  }
  return micro;
}

/**
 * Validate that a micro-USD value is integer, safe, non-negative.
 * Rejects float-dollar misuse (e.g., 0.75).
 */
export function assertMicroUsd(value: number, label: string): MicroUsd {
  if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be integer micro-USD, got ${String(value)}`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative micro-USD, got ${value}`);
  }
  return value;
}
