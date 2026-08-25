import { describe, expect, test } from "bun:test";
import { GeminiUsageParseError } from "./types.js";
import { normalizeGeminiUsage, parseGeminiUsage } from "./usage.js";

const PROV = {
  id: "usage-test-001",
  observedAt: "2026-08-26T12:00:00.000Z",
  sourceLocator: "evidence/raw/pdf_5k.json",
  rawSha256: "a".repeat(64),
  provider: "google",
  model: "gemini-3.5-flash",
};

// Historical raw fixtures — snake_case (Python) as in pagefold_validation
const lowSnakeRaw = {
  cached_content_token_count: 143,
  candidates_token_count: 153,
  prompt_token_count: 402,
  total_token_count: 1340,
  thoughts_token_count: 785,
  prompt_tokens_details: [
    { modality: "IMAGE", token_count: 266 },
    { modality: "TEXT", token_count: 136 },
  ],
  candidates_tokens_details: null,
  cache_tokens_details: [
    { modality: "TEXT", token_count: 48 },
    { modality: "IMAGE", token_count: 95 },
  ],
};

const mediumSnakeRaw = {
  cached_content_token_count: null,
  candidates_token_count: 153,
  prompt_token_count: 668,
  total_token_count: 1174,
  thoughts_token_count: 353,
  prompt_tokens_details: [
    { modality: "IMAGE", token_count: 532 },
    { modality: "TEXT", token_count: 136 },
  ],
  candidates_tokens_details: null,
  cache_tokens_details: null,
};

const highSnakeRaw = {
  cached_content_token_count: null,
  candidates_token_count: 153,
  prompt_token_count: 1228,
  total_token_count: 2252,
  thoughts_token_count: 871,
  prompt_tokens_details: [
    { modality: "TEXT", token_count: 136 },
    { modality: "IMAGE", token_count: 1092 },
  ],
  candidates_tokens_details: null,
  cache_tokens_details: null,
};

// Official JS SDK camelCase equivalents
const lowCamelRaw = {
  cachedContentTokenCount: 143,
  candidatesTokenCount: 153,
  promptTokenCount: 402,
  totalTokenCount: 1340,
  thoughtsTokenCount: 785,
  promptTokensDetails: [
    { modality: "IMAGE", tokenCount: 266 },
    { modality: "TEXT", tokenCount: 136 },
  ],
  candidatesTokensDetails: null,
  cacheTokensDetails: [
    { modality: "TEXT", tokenCount: 48 },
    { modality: "IMAGE", tokenCount: 95 },
  ],
};

const mediumCamelRaw = {
  cachedContentTokenCount: null,
  candidatesTokenCount: 153,
  promptTokenCount: 668,
  totalTokenCount: 1174,
  thoughtsTokenCount: 353,
  promptTokensDetails: [
    { modality: "IMAGE", tokenCount: 532 },
    { modality: "TEXT", tokenCount: 136 },
  ],
  candidatesTokensDetails: null,
  cacheTokensDetails: null,
};

const highCamelRaw = {
  cachedContentTokenCount: null,
  candidatesTokenCount: 153,
  promptTokenCount: 1228,
  totalTokenCount: 2252,
  thoughtsTokenCount: 871,
  promptTokensDetails: [
    { modality: "TEXT", tokenCount: 136 },
    { modality: "IMAGE", tokenCount: 1092 },
  ],
  candidatesTokensDetails: null,
  cacheTokensDetails: null,
};

describe("Gemini usage normalizer — happy path", () => {
  test("parses LOW snake 266 modality correctly", () => {
    const res = normalizeGeminiUsage(lowSnakeRaw, {
      ...PROV,
      id: "low-snake",
      sourceLocator: "pdf_5k.json",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.kind).toBe("provider-reported-usage");
    expect(res.record.inputTokens).toBe(402);
    expect(res.record.totalTokens).toBe(1340);
    expect(res.record.outputTokens).toBe(153);
    expect(res.record.cachedTokens).toBe(143);
    expect(res.record.thoughtsTokens).toBe(785);
    const img = res.record.promptModalities?.find((m) => m.modality === "IMAGE");
    expect(img?.tokenCount).toBe(266);
    // Every record has provenance
    expect(res.record.id).toBe("low-snake");
    expect(res.record.sourceLocator).toBe("pdf_5k.json");
    expect(res.record.rawSha256).toBe("a".repeat(64));
    expect(res.record.observedAt).toBe(PROV.observedAt);
  });

  test("parses MEDIUM snake 532 modality correctly", () => {
    const res = normalizeGeminiUsage(mediumSnakeRaw, { ...PROV, id: "med-snake" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.inputTokens).toBe(668);
    const img = res.record.promptModalities?.find((m) => m.modality === "IMAGE");
    expect(img?.tokenCount).toBe(532);
    expect(res.record.totalTokens).toBe(1174);
  });

  test("parses HIGH snake 1092 modality correctly", () => {
    const res = normalizeGeminiUsage(highSnakeRaw, { ...PROV, id: "high-snake" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.inputTokens).toBe(1228);
    const img = res.record.promptModalities?.find((m) => m.modality === "IMAGE");
    expect(img?.tokenCount).toBe(1092);
    expect(res.record.totalTokens).toBe(2252);
  });

  test("parses camelCase identically to snake_case — LOW", () => {
    const snakeRes = normalizeGeminiUsage(lowSnakeRaw, { ...PROV, id: "cmp-snake" });
    const camelRes = normalizeGeminiUsage(lowCamelRaw, { ...PROV, id: "cmp-camel" });
    expect(snakeRes.ok && camelRes.ok).toBe(true);
    if (!snakeRes.ok || !camelRes.ok) return;
    expect(camelRes.record.inputTokens).toBe(snakeRes.record.inputTokens);
    expect(camelRes.record.totalTokens).toBe(snakeRes.record.totalTokens);
    expect(camelRes.record.outputTokens).toBe(snakeRes.record.outputTokens);
    expect(camelRes.record.cachedTokens).toBe(snakeRes.record.cachedTokens);
    expect(camelRes.record.thoughtsTokens).toBe(snakeRes.record.thoughtsTokens);
    expect(camelRes.record.promptModalities).toEqual(snakeRes.record.promptModalities);
    expect(camelRes.record.cachedModalities).toEqual(snakeRes.record.cachedModalities);
  });

  test("parses camelCase identically — MEDIUM and HIGH", () => {
    const mSnake = normalizeGeminiUsage(mediumSnakeRaw, { ...PROV, id: "m-s" });
    const mCamel = normalizeGeminiUsage(mediumCamelRaw, { ...PROV, id: "m-c" });
    expect(mSnake.ok && mCamel.ok).toBe(true);
    if (!mSnake.ok || !mCamel.ok) return;
    expect(mCamel.record.inputTokens).toBe(668);
    expect(mSnake.record.inputTokens).toBe(668);
    expect(mCamel.record.promptModalities?.find((m) => m.modality === "IMAGE")?.tokenCount).toBe(
      532
    );

    const hSnake = normalizeGeminiUsage(highSnakeRaw, { ...PROV, id: "h-s" });
    const hCamel = normalizeGeminiUsage(highCamelRaw, { ...PROV, id: "h-c" });
    expect(hSnake.ok && hCamel.ok).toBe(true);
    if (!hSnake.ok || !hCamel.ok) return;
    expect(hCamel.record.promptModalities?.find((m) => m.modality === "IMAGE")?.tokenCount).toBe(
      1092
    );
  });

  test("parses via usageMetadata wrapper (official SDK shape)", () => {
    const wrapped = { usageMetadata: lowCamelRaw };
    const res = parseGeminiUsage(wrapped, { ...PROV, id: "wrap-low" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.inputTokens).toBe(402);
    expect(res.record.promptModalities?.find((m) => m.modality === "IMAGE")?.tokenCount).toBe(266);
  });

  test("parses via raw wrapper (historical JSON shape {raw:{...}})", () => {
    const wrapped = { raw: highSnakeRaw };
    const res = parseGeminiUsage(wrapped, { ...PROV, id: "wrap-high" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.inputTokens).toBe(1228);
  });

  test("every record has provenance and kind", () => {
    for (const raw of [lowSnakeRaw, mediumSnakeRaw, highSnakeRaw, lowCamelRaw]) {
      const res = normalizeGeminiUsage(raw, { ...PROV, id: `prov-${Math.random()}` });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.record.kind).toBe("provider-reported-usage");
      expect(typeof res.record.id).toBe("string");
      expect(res.record.id.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(res.record.observedAt))).toBe(false);
      expect(typeof res.record.sourceLocator).toBe("string");
      expect(/^[0-9a-f]{64}$/.test(res.record.rawSha256)).toBe(true);
    }
  });

  test("missing values remain absent not zero-filled", () => {
    // medium/high have cached null => should be undefined, not 0
    const med = normalizeGeminiUsage(mediumSnakeRaw, { ...PROV, id: "miss-med" });
    expect(med.ok).toBe(true);
    if (!med.ok) return;
    expect(med.record.cachedTokens).toBeUndefined();
    expect(med.record.cachedModalities).toBeUndefined();
    expect(med.record.cachedTokens).not.toBe(0);
    // Also candidatesTokensDetails null => absent
    expect(med.record.candidatesModalities).toBeUndefined();

    // Custom raw with only prompt, no cached/candidates/thoughts
    const minimal = { prompt_token_count: 100, total_token_count: 150 };
    const res = normalizeGeminiUsage(minimal, { ...PROV, id: "minimal" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.inputTokens).toBe(100);
    expect(res.record.totalTokens).toBe(150);
    expect(res.record.cachedTokens).toBeUndefined();
    expect(res.record.outputTokens).toBeUndefined();
    expect(res.record.thoughtsTokens).toBeUndefined();
    expect(res.record.promptModalities).toBeUndefined();
    // must not be zero-filled
    expect("cachedTokens" in res.record ? res.record.cachedTokens : undefined).toBeUndefined();
  });
});

describe("Gemini usage normalizer — failure paths", () => {
  test("malformed unknown usage returns typed parse failure without invented totals", () => {
    const cases: unknown[] = [
      {},
      { foo: 123 },
      { bar: "baz" },
      null,
      undefined,
      42,
      "string",
      { unknownField: 999 },
    ];
    for (const c of cases) {
      const res = normalizeGeminiUsage(c, { ...PROV, id: "malformed" });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error).toBeInstanceOf(GeminiUsageParseError);
      expect(res.error.code).toBe("INVALID_USAGE");
      // No invented totals — error path has no record with totalTokens
      expect((res as { ok: false; error: GeminiUsageParseError }).error.message).not.toContain("0");
    }
  });

  test("does not invent totals for object with only unknown fields", () => {
    const res = normalizeGeminiUsage({ someRandom: 123, another: "x" }, { ...PROV, id: "unknown" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INVALID_USAGE");
    }
  });

  test("invalid token type (string instead of int) returns failure not zero-fill", () => {
    const res = normalizeGeminiUsage(
      { prompt_token_count: "402" as unknown as number, total_token_count: 1340 },
      { ...PROV, id: "bad-type" }
    );
    expect(res.ok).toBe(false);
  });

  test("negative token count returns failure", () => {
    const res = normalizeGeminiUsage(
      { prompt_token_count: -1, total_token_count: 100 },
      { ...PROV, id: "neg" }
    );
    expect(res.ok).toBe(false);
  });

  test("imports no provider auth/request framework", async () => {
    const fs = await import("node:fs");
    const pathMod = await import("node:path");
    const content = fs.readFileSync(pathMod.join(import.meta.dir, "usage.ts"), "utf8");
    expect(content).not.toMatch(/from\s+["'].*@google\/genai/);
    expect(content).not.toMatch(/from\s+["'].*openrouter/i);
    expect(content).not.toMatch(/import\s+.*\bJWT\b/);
    expect(content).not.toMatch(/import\s+.*\bgenerateContent\b/);
    const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    for (const src of imports) {
      expect(src.startsWith("./") || src.startsWith("../")).toBe(true);
    }
  });
});
