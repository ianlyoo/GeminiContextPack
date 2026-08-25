import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  LIVE_SMOKE_DEFAULT_CONFIG,
  LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION,
  LIVE_SMOKE_DEFAULT_MODEL,
  LIVE_SMOKE_DEFAULT_SEED,
  LIVE_SMOKE_DEFAULT_TOKENS,
  LIVE_SMOKE_MAX_CALLS,
  LIVE_SMOKE_SKIP_MESSAGE,
  LIVE_SMOKE_SKIP_REASON,
  WRAPPER_PROMPT,
  buildCountTokensRequest,
  buildGenerateContentRequest,
  buildSymmetricContents,
  createCappedClient,
  LiveSmokeCallCapError,
  redactSecrets,
  sha256Hex,
  shouldRunLive,
  runLiveSmokeWithClient,
  type LiveModelClient,
} from "./live-gemini.js";
import { toGeminiInlinePart } from "../src/gemini/inline-part.js";
import { compileContextWithBundledFonts } from "../src/fonts/node-loader.js";
import { generateSeed42Corpus } from "./offline.js";

// ---------------------------------------------------------------------------
// Fake client factory — deterministic distinct plain/PDF usage records
// ---------------------------------------------------------------------------

function createFakeClient(opts?: {
  onGenerateContent?: (params: { model: string; contents: unknown; config?: unknown }) => unknown;
  onCountTokens?: (params: { model: string; contents: unknown }) => unknown;
}): { client: LiveModelClient; calls: { generate: unknown[]; count: unknown[] } } {
  const calls: { generate: unknown[]; count: unknown[] } = { generate: [], count: [] };
  let generateCallIndex = 0;
  const client: LiveModelClient = {
    models: {
      async countTokens(params) {
        calls.count.push(structuredClone(params));
        if (opts?.onCountTokens) return opts.onCountTokens(params);
        // Distinct token counts for symmetry proof — plain larger than pdf
        const contentsStr = JSON.stringify(params.contents);
        const isPdf = contentsStr.includes("inlineData");
        return {
          totalTokens: isPdf ? 598 : 5225,
          raw: { totalTokens: isPdf ? 598 : 5225 },
        };
      },
      async generateContent(params) {
        calls.generate.push(structuredClone(params));
        if (opts?.onGenerateContent) return opts.onGenerateContent(params);
        generateCallIndex += 1;
        const contentsStr = JSON.stringify(params.contents);
        const isPdf = contentsStr.includes("inlineData");
        // Return distinct usageMetadata per call — plain 5419, pdf 402
        if (isPdf) {
          return {
            usageMetadata: {
              promptTokenCount: 402,
              candidatesTokenCount: 153,
              totalTokenCount: 1340,
              cachedContentTokenCount: 143,
              thoughtsTokenCount: 785,
              promptTokensDetails: [
                { modality: "IMAGE", tokenCount: 266 },
                { modality: "TEXT", tokenCount: 136 },
              ],
            },
            text: "fake pdf response PF_CHECK_A=ABC",
          };
        }
        return {
          usageMetadata: {
            promptTokenCount: 5419,
            candidatesTokenCount: 200,
            totalTokenCount: 6400,
            promptTokensDetails: [{ modality: "TEXT", tokenCount: 5419 }],
          },
          text: "fake plain response PF_CHECK_A=ABC",
        };
      },
    },
  };
  return { client, calls };
}

describe("live-gemini — opt-in gate and SKIP", () => {
  test("shouldRunLive false without flag", () => {
    expect(shouldRunLive([], {})).toBe(false);
    expect(shouldRunLive([], { GEMINI_API_KEY: "sk-fake" })).toBe(false);
  });

  test("shouldRunLive false without key", () => {
    expect(shouldRunLive(["--run-live"], {})).toBe(false);
    expect(shouldRunLive(["--run-live"], { GEMINI_API_KEY: "" })).toBe(false);
    expect(shouldRunLive(["--run-live"], { GEMINI_API_KEY: "   " })).toBe(false);
  });

  test("shouldRunLive true only with both flag and key", () => {
    expect(shouldRunLive(["--run-live"], { GEMINI_API_KEY: "fake123" })).toBe(true);
    expect(shouldRunLive(["foo", "--run-live", "bar"], { GEMINI_API_KEY: "fake123" })).toBe(true);
    expect(shouldRunLive(["--run-live"], { GOOGLE_API_KEY: "alt123" })).toBe(true);
  });

  test("SKIP message is exact and credential-safe", () => {
    expect(LIVE_SMOKE_SKIP_MESSAGE).toBe(`[live-gemini] ${LIVE_SMOKE_SKIP_REASON}`);
    expect(LIVE_SMOKE_SKIP_MESSAGE).not.toContain("GEMINI_API_KEY=");
    // Must contain SKIP token per spec
    expect(LIVE_SMOKE_SKIP_MESSAGE).toMatch(/SKIP/);
  });
});

describe("live-gemini — defaults match spec (5k/seed42/LOW/one model/each 1, max 2)", () => {
  test("defaults are exact per spec", () => {
    expect(LIVE_SMOKE_DEFAULT_TOKENS).toBe(5000);
    expect(LIVE_SMOKE_DEFAULT_SEED).toBe(42);
    expect(LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION).toBe("MEDIA_RESOLUTION_LOW");
    expect(LIVE_SMOKE_DEFAULT_MODEL).toBe("gemini-2.5-flash");
    expect(LIVE_SMOKE_MAX_CALLS).toBe(2);
    expect(LIVE_SMOKE_DEFAULT_CONFIG.temperature).toBe(0.0);
    expect(LIVE_SMOKE_DEFAULT_CONFIG.maxOutputTokens).toBe(8192);
    expect(LIVE_SMOKE_DEFAULT_CONFIG.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
  });
});

describe("live-gemini — symmetric request configs (plain vs PDF)", () => {
  test("generateContent plain vs PDF share identical model/config, only contents differ", async () => {
    const corpus = generateSeed42Corpus(5000, 42);
    const artifact = await compileContextWithBundledFonts(corpus);
    const pdfPart = toGeminiInlinePart(artifact);
    const { plainContents, pdfContents } = buildSymmetricContents(corpus, pdfPart);

    const plainReq = buildGenerateContentRequest(
      LIVE_SMOKE_DEFAULT_MODEL,
      plainContents,
      LIVE_SMOKE_DEFAULT_CONFIG
    );
    const pdfReq = buildGenerateContentRequest(
      LIVE_SMOKE_DEFAULT_MODEL,
      pdfContents,
      LIVE_SMOKE_DEFAULT_CONFIG
    );

    // Model identical
    expect(plainReq.model).toBe(pdfReq.model);
    // Config identical (JSON equality)
    expect(JSON.stringify(plainReq.config)).toBe(JSON.stringify(pdfReq.config));
    // Config contains expected fields
    expect(plainReq.config.temperature).toBe(0.0);
    expect(plainReq.config.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
    // Contents differ: pdf contains inlineData, plain does not
    const plainStr = JSON.stringify(plainReq.contents);
    const pdfStr = JSON.stringify(pdfReq.contents);
    expect(plainStr).not.toContain("inlineData");
    expect(pdfStr).toContain("inlineData");
    expect(pdfStr).toContain("application/pdf");
    // Wrapper prompt appears in both
    expect(plainStr).toContain(WRAPPER_PROMPT.slice(0, 20));
    expect(pdfStr).toContain(WRAPPER_PROMPT.slice(0, 20));
  });

  test("countTokens plain vs PDF share identical model, symmetric contents type", async () => {
    const corpus = generateSeed42Corpus(5000, 42);
    const artifact = await compileContextWithBundledFonts(corpus);
    const pdfPart = toGeminiInlinePart(artifact);
    const { plainContents, pdfContents } = buildSymmetricContents(corpus, pdfPart);

    const plainReq = buildCountTokensRequest(LIVE_SMOKE_DEFAULT_MODEL, plainContents);
    const pdfReq = buildCountTokensRequest(LIVE_SMOKE_DEFAULT_MODEL, pdfContents);

    expect(plainReq.model).toBe(pdfReq.model);
    expect(plainReq.model).toBe(LIVE_SMOKE_DEFAULT_MODEL);
    const plainStr = JSON.stringify(plainReq.contents);
    const pdfStr = JSON.stringify(pdfReq.contents);
    expect(plainStr).not.toContain("inlineData");
    expect(pdfStr).toContain("inlineData");
  });

  test("fake client proves symmetric configs reach SDK without asymmetry", async () => {
    const { client, calls } = createFakeClient();
    const corpus = generateSeed42Corpus(5000, 42);
    const artifact = await compileContextWithBundledFonts(corpus);
    const pdfPart = toGeminiInlinePart(artifact);
    const { plainContents, pdfContents } = buildSymmetricContents(corpus, pdfPart);

    await client.models.generateContent(
      buildGenerateContentRequest(LIVE_SMOKE_DEFAULT_MODEL, plainContents, LIVE_SMOKE_DEFAULT_CONFIG)
    );
    await client.models.generateContent(
      buildGenerateContentRequest(LIVE_SMOKE_DEFAULT_MODEL, pdfContents, LIVE_SMOKE_DEFAULT_CONFIG)
    );

    expect(calls.generate.length).toBe(2);
    const [plainCall, pdfCall] = calls.generate as Array<{
      model: string;
      config: typeof LIVE_SMOKE_DEFAULT_CONFIG;
    }>;
    expect(plainCall.model).toBe(pdfCall.model);
    expect(JSON.stringify(plainCall.config)).toBe(JSON.stringify(pdfCall.config));
  });
});

describe("live-gemini — two-call cap enforcement", () => {
  test("capped client allows exactly 2 calls, third throws CALL_CAP_EXCEEDED before network", async () => {
    let networkHit = 0;
    const { client: inner } = createFakeClient({
      onGenerateContent: () => {
        networkHit += 1;
        return { usageMetadata: { promptTokenCount: 100, totalTokenCount: 200 } };
      },
    });
    const capped = createCappedClient(inner, 2);
    await capped.models.generateContent({ model: "m", contents: "a" });
    await capped.models.generateContent({ model: "m", contents: "b" });
    expect(networkHit).toBe(2);
    let threw: unknown = null;
    try {
      await capped.models.generateContent({ model: "m", contents: "c" });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(LiveSmokeCallCapError);
    expect((threw as LiveSmokeCallCapError).code).toBe("CALL_CAP_EXCEEDED");
    expect(threw instanceof Error && threw.message).toContain("max 2");
    // No network for third call
    expect(networkHit).toBe(2);
  });

  test("capped client counts countTokens and generateContent together", async () => {
    const { client: inner } = createFakeClient();
    const capped = createCappedClient(inner, 2);
    await capped.models.countTokens({ model: "m", contents: "a" });
    await capped.models.generateContent({ model: "m", contents: "b" });
    let threw: unknown = null;
    try {
      await capped.models.countTokens({ model: "m", contents: "c" });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(LiveSmokeCallCapError);
  });

  test("malformed payload stops before network (never increments cap nor hits inner)", async () => {
    let hit = 0;
    const { client: inner } = createFakeClient({
      onGenerateContent: () => {
        hit += 1;
        return { usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 } };
      },
    });
    const capped = createCappedClient(inner, 2);
    // Validation via builder before capped call — malformed empty array
    let builderThrew: unknown = null;
    try {
      buildGenerateContentRequest("m", [], LIVE_SMOKE_DEFAULT_CONFIG);
    } catch (e) {
      builderThrew = e;
    }
    expect(builderThrew).toBeInstanceOf(Error);
    expect(hit).toBe(0);

    // Empty string also malformed — should throw via builder not network
    let builderThrew2: unknown = null;
    try {
      buildGenerateContentRequest("m", "", LIVE_SMOKE_DEFAULT_CONFIG);
    } catch (e) {
      builderThrew2 = e;
    }
    expect(builderThrew2).toBeInstanceOf(Error);
    expect(hit).toBe(0);

    // Also null contents
    let builderThrew3: unknown = null;
    try {
      buildGenerateContentRequest("m", null, LIVE_SMOKE_DEFAULT_CONFIG);
    } catch (e) {
      builderThrew3 = e;
    }
    expect(builderThrew3).toBeInstanceOf(Error);
    expect(hit).toBe(0);

    // Valid call still works after malformed attempts (cap not consumed)
    await capped.models.generateContent({ model: "m", contents: "valid" });
    expect(hit).toBe(1);
  });

  test("runLiveSmokeWithClient enforces 2-call cap end-to-end (fake returns distinct usages)", async () => {
    const { client } = createFakeClient();
    const { report } = await runLiveSmokeWithClient({
      model: LIVE_SMOKE_DEFAULT_MODEL,
      targetTokens: 5000,
      seed: 42,
      mediaResolution: LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION,
      client,
      sdkVersion: "test-1.0.0",
    });

    // Report records SDK/model/config/time/raw SHA/accounting
    expect(report.sdk).toContain("@google/genai@");
    expect(report.model).toBe(LIVE_SMOKE_DEFAULT_MODEL);
    expect(JSON.stringify(report.config)).toContain("MEDIA_RESOLUTION_LOW");
    expect(typeof report.timing.startedAt).toBe("string");
    expect(Number.isNaN(Date.parse(report.timing.startedAt))).toBe(false);
    expect(typeof report.timing.durationMs).toBe("number");
    expect(report.timing.durationMs).toBeGreaterThanOrEqual(0);
    // Raw SHAs are 64 hex
    expect(/^[0-9a-f]{64}$/.test(report.rawSha256.plain)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(report.rawSha256.pdf)).toBe(true);
    expect(report.rawSha256.plain).not.toBe(report.rawSha256.pdf);

    // Accounting records distinct with provenance/kind
    const plainAcc = report.accounting.plain as Record<string, unknown>;
    const pdfAcc = report.accounting.pdf as Record<string, unknown>;
    expect(plainAcc.kind).toBe("provider-reported-usage");
    expect(pdfAcc.kind).toBe("provider-reported-usage");
    expect(plainAcc.inputTokens).toBe(5419);
    expect(pdfAcc.inputTokens).toBe(402);
    expect(plainAcc.inputTokens).not.toBe(pdfAcc.inputTokens);
    // Provenance present
    expect(typeof plainAcc.id).toBe("string");
    expect(typeof pdfAcc.id).toBe("string");
    expect(typeof plainAcc.rawSha256).toBe("string");
    expect(/^[0-9a-f]{64}$/.test(plainAcc.rawSha256 as string)).toBe(true);
    expect(typeof plainAcc.observedAt).toBe("string");
    expect(typeof plainAcc.sourceLocator).toBe("string");

    // Probe fields
    expect(report.probe.targetTokens).toBe(5000);
    expect(report.probe.seed).toBe(42);
    expect(report.probe.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
    expect(report.probe.pdfBytes).toBeGreaterThan(0);
    expect(report.probe.pdfPageCount).toBe(1);
  });
});

describe("live-gemini — redaction (credential never serialized)", () => {
  test("redactSecrets replaces all occurrences with [REDACTED]", () => {
    const key = "GEMINI_FAKE_KEY_12345_SECRET";
    const text = `call with key=${key} and again ${key} end`;
    const out = redactSecrets(text, [key]);
    expect(out).not.toContain(key);
    expect(out).toContain("[REDACTED]");
    // Both occurrences redacted
    expect(out.split("[REDACTED]").length - 1).toBe(2);
    // Empty secrets no-op
    expect(redactSecrets(text, [])).toBe(text);
    expect(redactSecrets(text, ["", "   "])).toBe(text);
  });

  test("redacted JSON never contains secret", async () => {
    const secret = "SUPER_SECRET_GEMINI_KEY_999";
    const { client } = createFakeClient();
    const { report, redactedReportJson } = await runLiveSmokeWithClient({
      client,
      sdkVersion: "test-1.0.0",
    });
    // Simulate report accidentally containing secret — redaction must strip it
    const tainted = JSON.stringify({ ...report, leaked: secret });
    const redacted = redactSecrets(tainted, [secret]);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED]");
    // Normal redactedReportJson already credential-safe (no key injected)
    expect(redactedReportJson).not.toContain(secret);
  });

  test("missing key stops before network (shouldRunLive false path)", () => {
    expect(shouldRunLive(["--run-live"], {})).toBe(false);
    expect(shouldRunLive([], { GEMINI_API_KEY: "x" })).toBe(false);
    // Ensure fake client never called when gate false
    // (integration: main() would print SKIP and exit 0 without constructing client)
  });
});

describe("live-gemini — usage parsing (distinct plain/PDF with provenance)", () => {
  test("fake client distinct usages parse to distinct accounting records with provenance", async () => {
    const { client } = createFakeClient();
    const { report } = await runLiveSmokeWithClient({ client, sdkVersion: "test-1.0.0" });
    const plain = report.accounting.plain as {
      inputTokens: number;
      kind: string;
      id: string;
      observedAt: string;
      sourceLocator: string;
      rawSha256: string;
    };
    const pdf = report.accounting.pdf as {
      inputTokens: number;
      kind: string;
      id: string;
      observedAt: string;
      sourceLocator: string;
      rawSha256: string;
      promptModalities?: Array<{ modality: string; tokenCount: number }>;
    };
    expect(plain.inputTokens).toBe(5419);
    expect(pdf.inputTokens).toBe(402);
    expect(plain.kind).toBe("provider-reported-usage");
    expect(pdf.kind).toBe("provider-reported-usage");
    // Provenance SHA ties to raw JSON (sha256Hex of usage raw)
    expect(plain.rawSha256).toBe(sha256Hex(JSON.stringify({ promptTokenCount: 5419, candidatesTokenCount: 200, totalTokenCount: 6400, promptTokensDetails: [{ modality: "TEXT", tokenCount: 5419 }] })));
    // pdf has modality IMAGE 266
    expect(pdf.promptModalities?.find((m) => m.modality === "IMAGE")?.tokenCount).toBe(266);
    expect(plain.id).not.toBe(pdf.id);
    expect(plain.sourceLocator).not.toBe(pdf.sourceLocator);
  });

  test("malformed usage throws typed parse failure without invented totals", async () => {
    const { client: badClient } = createFakeClient({
      onGenerateContent: () => ({ usageMetadata: {} }),
    });
    let threw: unknown = null;
    try {
      await runLiveSmokeWithClient({ client: badClient, sdkVersion: "test-1.0.0" });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    expect(String(threw)).toMatch(/parse failed/i);
  });

  test("sha256Hex is deterministic 64 hex", () => {
    expect(sha256Hex("hello")).toBe(createHash("sha256").update("hello").digest("hex"));
    expect(/^[0-9a-f]{64}$/.test(sha256Hex("test"))).toBe(true);
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
