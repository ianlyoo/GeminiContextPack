import { describe, expect, test } from "bun:test";
import { ComparisonError, compareAccountingRecords, compareUsage } from "./comparison.js";
import {
  createBenchmarkObservationRecord,
  createDerivedComparisonRecord,
  createEstimatedRecord,
  createPricingSnapshotFromDollars,
  createPricingSnapshotRecord,
  createProviderCountedRecord,
  createProviderReportedCostRecord,
  createProviderReportedUsageRecord,
  validateAccountingRecord,
} from "./records.js";
import {
  assertMicroUsd,
  describeRecordKind,
  dollarsPerMillionToMicroUsd,
  getAccountingKindLabel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers — stable base provenance
// ---------------------------------------------------------------------------

const BASE = {
  observedAt: "2026-08-26T12:00:00.000Z",
  sourceLocator: "evidence/raw/plain_5k.json",
  rawSha256: "a".repeat(64),
  provider: "google",
  model: "gemini-2.0-flash",
} as const;

function sha(char: string): string {
  return char.repeat(64);
}

// One fixture per kind — must each have stable id, observedAt, sourceLocator/rawSha256, provider/model
const fixtures = {
  estimated: createEstimatedRecord({
    id: "est-001",
    observedAt: BASE.observedAt,
    sourceLocator: BASE.sourceLocator,
    rawSha256: sha("a"),
    provider: BASE.provider,
    model: BASE.model,
    tokens: 5419,
    method: "heuristic-word-count",
    estimatorVersion: "v1",
  }),
  providerCounted: createProviderCountedRecord({
    id: "cnt-001",
    observedAt: BASE.observedAt,
    sourceLocator: "api/countTokens",
    rawSha256: sha("b"),
    provider: BASE.provider,
    model: BASE.model,
    tokens: 51393,
    counterId: "gemini-countTokens",
  }),
  providerReportedUsage: createProviderReportedUsageRecord({
    id: "usage-plain-001",
    observedAt: BASE.observedAt,
    sourceLocator: "evidence/raw/plain_20k.json",
    rawSha256: sha("c"),
    provider: BASE.provider,
    model: BASE.model,
    inputTokens: 20704,
    outputTokens: 128,
    totalTokens: 20832,
  }),
  providerReportedCost: createProviderReportedCostRecord({
    id: "cost-001",
    observedAt: BASE.observedAt,
    sourceLocator: "billing/export/2026-08.json",
    rawSha256: sha("d"),
    provider: BASE.provider,
    model: BASE.model,
    amountMicroUsd: 750000,
    currency: "USD",
  }),
  pricingSnapshot: createPricingSnapshotRecord({
    id: "price-001",
    observedAt: BASE.observedAt,
    sourceLocator: "pricing/google/2026-08-01.json",
    rawSha256: sha("e"),
    provider: BASE.provider,
    model: BASE.model,
    inputPerMillionMicroUsd: 750000,
    outputPerMillionMicroUsd: 3000000,
    effectiveAt: "2026-08-01T00:00:00.000Z",
  }),
  derivedComparison: createDerivedComparisonRecord({
    id: "derived-001",
    observedAt: BASE.observedAt,
    sourceLocator: "derived:usage-plain-001+usage-pdf-001",
    rawSha256: sha("f"),
    provider: BASE.provider,
    model: BASE.model,
    baselineId: "usage-plain-001",
    candidateId: "usage-pdf-001",
    inputRecordIds: ["usage-plain-001", "usage-pdf-001"],
    roundingRule: "nearest",
    deltaTokens: 20200,
    deltaMicroUsd: 15000,
  }),
  benchmarkObservation: createBenchmarkObservationRecord({
    id: "bench-001",
    observedAt: BASE.observedAt,
    sourceLocator: "benchmarks/offline/5k",
    rawSha256: sha("0"),
    provider: BASE.provider,
    model: BASE.model,
    durationMs: 1234,
    repetitions: 3,
    inputTokens: 5000,
    profile: "2.0/2.30",
  }),
};

// ---------------------------------------------------------------------------
// One fixture per kind
// ---------------------------------------------------------------------------

describe("accounting fixtures — seven kinds", () => {
  test("all seven fixtures exist with distinct kinds", () => {
    const kinds = Object.values(fixtures).map((r) => r.kind);
    expect(kinds).toEqual([
      "estimated",
      "provider-counted",
      "provider-reported-usage",
      "provider-reported-cost",
      "pricing-snapshot",
      "derived-comparison",
      "benchmark-observation",
    ]);
  });

  test("each fixture has required provenance fields", () => {
    for (const rec of Object.values(fixtures)) {
      expect(typeof rec.id).toBe("string");
      expect(rec.id.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(rec.observedAt))).toBe(false);
      expect(typeof rec.sourceLocator).toBe("string");
      expect(rec.sourceLocator.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]{64}$/.test(rec.rawSha256)).toBe(true);
      expect(rec.provider).toBe("google");
      expect(rec.model).toBe("gemini-2.0-flash");
    }
  });

  test("validateAccountingRecord round-trips each fixture", () => {
    for (const rec of Object.values(fixtures)) {
      const validated = validateAccountingRecord(structuredClone(rec));
      expect(validated.kind).toBe(rec.kind);
      expect(validated.id).toBe(rec.id);
    }
  });

  test("each kind has distinct shape — method vs counterId vs inputTokens vs amountMicroUsd vs pricing vs ids vs duration", () => {
    expect((fixtures.estimated as { method: string }).method).toBe("heuristic-word-count");
    expect((fixtures.providerCounted as { counterId: string }).counterId).toBe(
      "gemini-countTokens"
    );
    expect((fixtures.providerReportedUsage as { inputTokens: number }).inputTokens).toBe(20704);
    expect((fixtures.providerReportedCost as { amountMicroUsd: number }).amountMicroUsd).toBe(
      750000
    );
    expect(
      (fixtures.pricingSnapshot as { inputPerMillionMicroUsd: number }).inputPerMillionMicroUsd
    ).toBe(750000);
    expect((fixtures.derivedComparison as { baselineId: string }).baselineId).toBe(
      "usage-plain-001"
    );
    expect((fixtures.benchmarkObservation as { durationMs: number }).durationMs).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive never switch
// ---------------------------------------------------------------------------

describe("exhaustive never switch", () => {
  test("describeRecordKind handles all 7 kinds without falling to never", () => {
    for (const rec of Object.values(fixtures)) {
      const label = describeRecordKind(rec);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("getAccountingKindLabel exhaustive for all 7 kinds", () => {
    const labels = [
      "estimated",
      "provider-counted",
      "provider-reported-usage",
      "provider-reported-cost",
      "pricing-snapshot",
      "derived-comparison",
      "benchmark-observation",
    ] as const;
    for (const k of labels) {
      expect(getAccountingKindLabel(k)).toBe(k);
    }
  });

  test("derived comparison records inputRecordIds and roundingRule, not just totals", () => {
    const derived = fixtures.derivedComparison as ReturnType<typeof createDerivedComparisonRecord>;
    expect(derived.inputRecordIds).toEqual(["usage-plain-001", "usage-pdf-001"]);
    expect(derived.roundingRule).toBe("nearest");
    expect(derived.baselineId).toBe("usage-plain-001");
    expect(derived.candidateId).toBe("usage-pdf-001");
  });
});

// ---------------------------------------------------------------------------
// Micro-USD representation — $0.75/1M = 750000
// ---------------------------------------------------------------------------

describe("micro-USD money", () => {
  test("$0.75/1M equals 750000 micro-USD per million", () => {
    expect(dollarsPerMillionToMicroUsd(0.75)).toBe(750000);
    expect(dollarsPerMillionToMicroUsd(0)).toBe(0);
    expect(dollarsPerMillionToMicroUsd(1.5)).toBe(1500000);
  });

  test("createPricingSnapshotFromDollars $0.75 yields 750000", () => {
    const snap = createPricingSnapshotFromDollars({
      id: "price-dollars-001",
      observedAt: BASE.observedAt,
      sourceLocator: "pricing/dollars",
      rawSha256: sha("1"),
      provider: BASE.provider,
      model: BASE.model,
      inputDollarsPerMillion: 0.75,
      outputDollarsPerMillion: 3.0,
      effectiveAt: "2026-08-01T00:00:00.000Z",
    });
    expect(snap.inputPerMillionMicroUsd).toBe(750000);
    expect(snap.outputPerMillionMicroUsd).toBe(3000000);
  });

  test("assertMicroUsd rejects float dollars", () => {
    expect(() => assertMicroUsd(0.75, "amountMicroUsd")).toThrow();
    expect(() => assertMicroUsd(750000.5, "amountMicroUsd")).toThrow();
    expect(() => assertMicroUsd(Number.NaN, "amountMicroUsd")).toThrow();
  });

  test("createProviderReportedCost rejects float-dollar amountMicroUsd", () => {
    expect(() =>
      createProviderReportedCostRecord({
        id: "cost-float",
        observedAt: BASE.observedAt,
        sourceLocator: BASE.sourceLocator,
        rawSha256: sha("2"),
        provider: BASE.provider,
        model: BASE.model,
        amountMicroUsd: 0.75 as unknown as number,
        currency: "USD",
      })
    ).toThrow();
  });

  test("createPricingSnapshot rejects float per-million micro-USD", () => {
    expect(() =>
      createPricingSnapshotRecord({
        id: "price-float",
        observedAt: BASE.observedAt,
        sourceLocator: BASE.sourceLocator,
        rawSha256: sha("3"),
        provider: BASE.provider,
        model: BASE.model,
        inputPerMillionMicroUsd: 750000.5,
        outputPerMillionMicroUsd: 3000000,
        effectiveAt: "2026-08-01T00:00:00.000Z",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Valid comparison — plain/PDF provider-reported usage with optional pricing
// ---------------------------------------------------------------------------

describe("comparison — happy path", () => {
  test("compare plain vs PDF provider-reported usage without pricing — same unit/provenance", () => {
    const plain = createProviderReportedUsageRecord({
      id: "usage-plain-002",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/plain_5k.json",
      rawSha256: sha("4"),
      provider: BASE.provider,
      model: BASE.model,
      inputTokens: 5419,
      totalTokens: 5419,
    });
    const pdf = createProviderReportedUsageRecord({
      id: "usage-pdf-002",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/pdf_5k.json",
      rawSha256: sha("5"),
      provider: BASE.provider,
      model: BASE.model,
      inputTokens: 402,
      totalTokens: 402,
    });
    const derived = compareAccountingRecords(plain, pdf);
    expect(derived.kind).toBe("derived-comparison");
    expect(derived.baselineId).toBe(plain.id);
    expect(derived.candidateId).toBe(pdf.id);
    expect(derived.inputRecordIds).toEqual([plain.id, pdf.id]);
    expect(derived.roundingRule).toBe("nearest");
    expect(derived.deltaTokens).toBe(5017);
    expect(derived.pricingSnapshotId).toBeUndefined();
  });

  test("compare plain/PDF with optional pricing snapshot — records pricingSnapshotId and deltaMicroUsd", () => {
    const plain = createProviderReportedUsageRecord({
      id: "usage-plain-003",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/plain_20k.json",
      rawSha256: sha("6"),
      provider: BASE.provider,
      model: BASE.model,
      inputTokens: 20704,
      totalTokens: 20704,
    });
    const pdf = createProviderReportedUsageRecord({
      id: "usage-pdf-003",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/pdf_20k.json",
      rawSha256: sha("7"),
      provider: BASE.provider,
      model: BASE.model,
      inputTokens: 402,
      totalTokens: 402,
    });
    const pricing = createPricingSnapshotRecord({
      id: "price-002",
      observedAt: BASE.observedAt,
      sourceLocator: "pricing/google/2026-08-01.json",
      rawSha256: sha("8"),
      provider: BASE.provider,
      model: BASE.model,
      inputPerMillionMicroUsd: 750000,
      outputPerMillionMicroUsd: 3000000,
      effectiveAt: "2026-08-01T00:00:00.000Z",
    });
    const derived = compareAccountingRecords(plain, pdf, {
      pricingSnapshot: pricing,
      roundingRule: "nearest",
    });
    expect(derived.inputRecordIds).toEqual([plain.id, pdf.id, pricing.id]);
    expect(derived.pricingSnapshotId).toBe(pricing.id);
    expect(derived.roundingRule).toBe("nearest");
    // (20704-402)=20302 *750000/1e6 = 15226.5 -> nearest 15227
    expect(derived.deltaMicroUsd).toBe(15227);
    expect(derived.deltaTokens).toBe(20302);
  });

  test("compareUsage convenience helper with pricing", () => {
    const plain = createProviderReportedUsageRecord({
      id: "usage-plain-004",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/plain_50k.json",
      rawSha256: sha("9"),
      provider: BASE.provider,
      inputTokens: 51393,
      totalTokens: 51393,
    });
    const pdf = createProviderReportedUsageRecord({
      id: "usage-pdf-004",
      observedAt: BASE.observedAt,
      sourceLocator: "evidence/raw/pdf_50k.json",
      rawSha256: "b".repeat(64),
      provider: BASE.provider,
      inputTokens: 402,
      totalTokens: 402,
    });
    const pricing = fixtures.pricingSnapshot as ReturnType<typeof createPricingSnapshotRecord>;
    const derived = compareUsage(plain, pdf, pricing, "floor");
    expect(derived.deltaTokens).toBe(50991);
    expect(derived.roundingRule).toBe("floor");
  });
});

// ---------------------------------------------------------------------------
// Invalid mixed comparison — cannot emit savings
// ---------------------------------------------------------------------------

describe("comparison — failure paths", () => {
  test("estimate vs provider-reported-usage without flag fails with MIXED_PROVENANCE and no savings", () => {
    const est = fixtures.estimated;
    const usage = fixtures.providerReportedUsage;
    let err: unknown;
    try {
      compareAccountingRecords(est, usage);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ComparisonError);
    expect((err as ComparisonError).code).toBe("MIXED_PROVENANCE");
    // Ensure no derived record was emitted — err path has no delta
    expect(err).not.toHaveProperty("deltaTokens");
  });

  test("estimate vs provider-reported-usage with explicit flag succeeds", () => {
    const est = createEstimatedRecord({
      id: "est-002",
      observedAt: BASE.observedAt,
      sourceLocator: BASE.sourceLocator,
      rawSha256: sha("c"),
      tokens: 10000,
      method: "heuristic",
    });
    const usage = createProviderReportedUsageRecord({
      id: "usage-005",
      observedAt: BASE.observedAt,
      sourceLocator: BASE.sourceLocator,
      rawSha256: sha("d"),
      inputTokens: 402,
      totalTokens: 402,
    });
    const derived = compareAccountingRecords(est, usage, { allowMixedProvenance: true });
    expect(derived.deltaTokens).toBe(9598);
  });

  test("mixed units — usage (tokens) vs cost (micro-USD) fails with MIXED_UNIT", () => {
    const usage = fixtures.providerReportedUsage;
    const cost = fixtures.providerReportedCost;
    expect(() => compareAccountingRecords(usage, cost)).toThrow(ComparisonError);
    try {
      compareAccountingRecords(usage, cost);
    } catch (e) {
      expect((e as ComparisonError).code).toBe("MIXED_UNIT");
    }
  });

  test("float-dollar input for cost fails at record creation — comparison never reached", () => {
    expect(() =>
      createProviderReportedCostRecord({
        id: "cost-float-2",
        observedAt: BASE.observedAt,
        sourceLocator: BASE.sourceLocator,
        rawSha256: sha("e"),
        amountMicroUsd: 123.45 as unknown as number,
        currency: "USD",
      })
    ).toThrow();
  });

  test("derived-comparison as input fails UNLABELED_TOTAL", () => {
    const derived = fixtures.derivedComparison;
    const usage = fixtures.providerReportedUsage;
    expect(() => compareAccountingRecords(derived, usage)).toThrow(ComparisonError);
    try {
      compareAccountingRecords(derived, usage);
    } catch (e) {
      expect((e as ComparisonError).code).toBe("UNLABELED_TOTAL");
    }
  });

  test("invalid mixed comparison cannot emit savings — no derived record returned", () => {
    const est = fixtures.estimated;
    const cost = fixtures.providerReportedCost;
    let threw = false;
    try {
      compareAccountingRecords(est, cost);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
