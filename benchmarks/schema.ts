/**
 * benchmarks/schema — offline benchmark observation record schema.
 *
 * Semantic fields (profile/page/bytes/hashes) are deterministic across runs;
 * latency is non-deterministic and isolated.
 *
 * Each observation is a benchmark-observation accounting record with provenance
 * (id, observedAt, sourceLocator, rawSha256) plus offline-specific fields:
 * profile, page, bytes, hashes, latency.
 *
 * No network, no invoice, no cost claim.
 */

export type OfflineScale = 5000 | 20000 | 50000;

export interface OfflineDensityProfile {
  readonly fontSize: number;
  readonly leading: number;
}

export interface OfflineObservationRecord {
  /** Discriminated kind — matches accounting benchmark-observation. */
  readonly kind: "benchmark-observation";
  /** Stable id per scale, e.g. offline-5k-seed42 */
  readonly id: string;
  /** ISO-8601 observed timestamp (non-deterministic, excluded from equality). */
  readonly observedAt: string;
  /** Locator for traceability — synthetic seed42 corpus tag. */
  readonly sourceLocator: string;
  /** SHA-256 hex of canonical source (64 lowercase). */
  readonly rawSha256: string;
  /** Density profile selected by planner (deterministic). */
  readonly profile: OfflineDensityProfile;
  /** Page count (deterministic, expected 1). */
  readonly page: number;
  /** PDF bytes length (deterministic). */
  readonly bytes: number;
  /** Hashes — source and extracted must be equal (deterministic). */
  readonly hashes: {
    readonly source: string;
    readonly extracted: string;
  };
  /** Latency — non-deterministic isolated field. */
  readonly latency: {
    readonly durationMs: number;
  };
  /** Verification flag — must be true. */
  readonly verified: boolean;
  /** Target token scale. */
  readonly targetTokens: OfflineScale;
  /** Canonical source chars length (deterministic). */
  readonly sourceChars: number;
  /** Canonicalization id fixed. */
  readonly canonicalizationId: "gemini-context-pack-v1";
  /** Repetitions for accounting compatibility. */
  readonly repetitions: number;
}

export interface OfflineBenchmarkReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly methodology: string;
  readonly limitations: string;
  readonly observations: readonly OfflineObservationRecord[];
  /** Provenance notice — all numbers traceable to raw via SHA+JSON path. */
  readonly provenance: {
    readonly notice: string;
    readonly raw_manifest: string;
  };
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export function validateOfflineObservationRecord(
  rec: unknown,
): OfflineObservationRecord {
  if (typeof rec !== "object" || rec === null) throw new Error("observation must be object");
  const r = rec as Record<string, unknown>;
  if (r.kind !== "benchmark-observation") throw new Error(`kind must be benchmark-observation`);
  if (typeof r.id !== "string" || r.id.length === 0) throw new Error("id required");
  if (typeof r.observedAt !== "string" || Number.isNaN(Date.parse(r.observedAt as string))) {
    throw new Error("observedAt must be ISO-8601");
  }
  if (typeof r.sourceLocator !== "string" || r.sourceLocator.length === 0) {
    throw new Error("sourceLocator required");
  }
  if (typeof r.rawSha256 !== "string" || !SHA256_RE.test(r.rawSha256 as string)) {
    throw new Error("rawSha256 must be 64 hex");
  }
  const profile = r.profile as Record<string, unknown> | undefined;
  if (
    typeof profile !== "object" ||
    profile === null ||
    typeof profile.fontSize !== "number" ||
    typeof profile.leading !== "number"
  ) {
    throw new Error("profile must be {fontSize, leading}");
  }
  if (typeof r.page !== "number" || !Number.isInteger(r.page) || r.page < 1) {
    throw new Error("page must be integer >=1");
  }
  if (typeof r.bytes !== "number" || !Number.isInteger(r.bytes) || r.bytes < 1) {
    throw new Error("bytes must be integer >=1");
  }
  const hashes = r.hashes as Record<string, unknown> | undefined;
  if (
    typeof hashes !== "object" ||
    hashes === null ||
    typeof hashes.source !== "string" ||
    typeof hashes.extracted !== "string" ||
    !SHA256_RE.test(hashes.source as string) ||
    !SHA256_RE.test(hashes.extracted as string)
  ) {
    throw new Error("hashes must be {source, extracted} 64hex");
  }
  if (hashes.source !== hashes.extracted) {
    throw new Error(`hashes must be equal: source ${hashes.source} vs extracted ${hashes.extracted}`);
  }
  if (r.rawSha256 !== hashes.source) {
    throw new Error(`rawSha256 must equal hashes.source`);
  }
  const latency = r.latency as Record<string, unknown> | undefined;
  if (
    typeof latency !== "object" ||
    latency === null ||
    typeof latency.durationMs !== "number" ||
    !Number.isFinite(latency.durationMs) ||
    (latency.durationMs as number) < 0
  ) {
    throw new Error("latency.durationMs must be finite >=0");
  }
  if (r.verified !== true) throw new Error("verified must be true");
  if (![5000, 20000, 50000].includes(r.targetTokens as number)) {
    throw new Error("targetTokens must be 5000|20000|50000");
  }
  return rec as OfflineObservationRecord;
}

export function validateOfflineBenchmarkReport(report: unknown): OfflineBenchmarkReport {
  if (typeof report !== "object" || report === null) throw new Error("report must be object");
  const r = report as Record<string, unknown>;
  if (r.version !== 1) throw new Error("version must be 1");
  if (typeof r.generatedAt !== "string" || Number.isNaN(Date.parse(r.generatedAt as string))) {
    throw new Error("generatedAt must be ISO-8601");
  }
  if (!Array.isArray(r.observations) || r.observations.length !== 3) {
    throw new Error("observations must be array length 3");
  }
  for (const o of r.observations as unknown[]) {
    validateOfflineObservationRecord(o);
  }
  return report as OfflineBenchmarkReport;
}

/**
 * Return deterministic projection — strips latency and observedAt for equality.
 */
export function deterministicProjection(
  rec: OfflineObservationRecord,
): Omit<OfflineObservationRecord, "latency" | "observedAt"> & { latency: never; observedAt: never } {
  const { latency: _lat, observedAt: _obs, ...rest } = rec as unknown as Record<string, unknown>;
  void _lat;
  void _obs;
  return rest as unknown as Omit<OfflineObservationRecord, "latency" | "observedAt"> & {
    latency: never;
    observedAt: never;
  };
}

export function observationsDeterministicallyEqual(
  a: OfflineObservationRecord,
  b: OfflineObservationRecord,
): boolean {
  if (a.id !== b.id) return false;
  if (a.sourceLocator !== b.sourceLocator) return false;
  if (a.rawSha256 !== b.rawSha256) return false;
  if (a.profile.fontSize !== b.profile.fontSize) return false;
  if (a.profile.leading !== b.profile.leading) return false;
  if (a.page !== b.page) return false;
  if (a.bytes !== b.bytes) return false;
  if (a.hashes.source !== b.hashes.source) return false;
  if (a.hashes.extracted !== b.hashes.extracted) return false;
  if (a.verified !== b.verified) return false;
  if (a.targetTokens !== b.targetTokens) return false;
  if (a.sourceChars !== b.sourceChars) return false;
  if (a.canonicalizationId !== b.canonicalizationId) return false;
  return true;
}
