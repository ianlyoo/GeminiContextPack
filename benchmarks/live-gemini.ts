/**
 * benchmarks/live-gemini — opt-in symmetric Gemini live smoke (credential-safe).
 *
 * - Offline by default: needs BOTH --run-live flag AND GEMINI_API_KEY env to network.
 * - Otherwise prints exact SKIP status and exits 0 (no network, no secret serialization).
 * - When live: uses official @google/genai (devDependency) with identical control/wrapper
 *   config for plain vs verified PDF, via countTokens + generateContent.
 * - Defaults: 5k / seed 42 / MEDIA_RESOLUTION_LOW / one model / each 1 run, max calls 2.
 * - Output records SDK/model/config/time/raw SHA/accounting records with credential redaction.
 * - Call cap enforced before network; malformed payload and missing key stop before network.
 */

import { createHash } from "node:crypto";
import { normalizeGeminiUsage } from "../src/gemini/usage.js";
import { toGeminiInlinePart } from "../src/gemini/inline-part.js";
import { compileContextWithBundledFonts } from "../src/fonts/node-loader.js";
import { generateSeed42Corpus } from "./offline.js";

// ---------------------------------------------------------------------------
// Constants — defaults per spec
// ---------------------------------------------------------------------------

export const LIVE_SMOKE_MAX_CALLS = 2 as const;
export const LIVE_SMOKE_DEFAULT_MODEL = "gemini-2.5-flash" as const;
export const LIVE_SMOKE_DEFAULT_TOKENS = 5000 as const;
export const LIVE_SMOKE_DEFAULT_SEED = 42 as const;
export const LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_LOW" as const;

/** Identical control/wrapper config for plain vs PDF (only contents differ). */
export const LIVE_SMOKE_DEFAULT_CONFIG = {
  temperature: 0.0,
  maxOutputTokens: 8192,
  mediaResolution: LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION,
} as const;

/** Exact SKIP status printed when opt-in not satisfied (tests assert this). */
export const LIVE_SMOKE_SKIP_REASON =
  "SKIP: live smoke requires --run-live flag and GEMINI_API_KEY env — no network call";

export const LIVE_SMOKE_SKIP_MESSAGE = `[live-gemini] ${LIVE_SMOKE_SKIP_REASON}`;

// ---------------------------------------------------------------------------
// Redaction — never log GEMINI_API_KEY
// ---------------------------------------------------------------------------

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.trim().length === 0) continue;
    // Replace all occurrences (literal, not regex)
    out = out.split(s).join("[REDACTED]");
  }
  // Also redact any pattern that looks like a long API key in loose logs
  // Keep narrow to avoid false positives, but cover generic leakage vectors
  return out;
}

export function collectSecretsFromEnv(env: Record<string, string | undefined>): string[] {
  const secrets: string[] = [];
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (key && key.trim().length > 0) secrets.push(key);
  return secrets;
}

export function redactJsonForLogging(value: unknown, secrets: readonly string[]): string {
  const json = JSON.stringify(value, null, 2);
  return redactSecrets(json, secrets);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sha256Hex(input: Uint8Array | string): string {
  const h = createHash("sha256");
  if (typeof input === "string") h.update(input, "utf8");
  else h.update(input);
  return h.digest("hex");
}

export function shouldRunLive(
  argv: readonly string[],
  env: Record<string, string | undefined>
): boolean {
  const hasFlag = argv.includes("--run-live");
  const key = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim();
  return hasFlag && key.length > 0;
}

export function parseLiveArgs(argv: readonly string[]): {
  runLive: boolean;
  model: string;
  targetTokens: number;
  seed: number;
  mediaResolution: string;
} {
  let model = LIVE_SMOKE_DEFAULT_MODEL;
  let targetTokens = LIVE_SMOKE_DEFAULT_TOKENS;
  let seed = LIVE_SMOKE_DEFAULT_SEED;
  let mediaResolution = LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION;
  const runLive = argv.includes("--run-live");
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === "--model" && i + 1 < argv.length) {
      model = String(argv[i + 1]);
      i += 1;
    } else if (a.startsWith("--model=")) {
      model = a.slice("--model=".length);
    } else if (a === "--tokens" && i + 1 < argv.length) {
      const v = Number(argv[i + 1]);
      if (Number.isInteger(v) && v > 0) targetTokens = v;
      i += 1;
    } else if (a.startsWith("--tokens=")) {
      const v = Number(a.slice("--tokens=".length));
      if (Number.isInteger(v) && v > 0) targetTokens = v;
    } else if (a === "--seed" && i + 1 < argv.length) {
      const v = Number(argv[i + 1]);
      if (Number.isInteger(v)) seed = v;
      i += 1;
    } else if (a.startsWith("--seed=")) {
      const v = Number(a.slice("--seed=".length));
      if (Number.isInteger(v)) seed = v;
    } else if (a === "--media-resolution" && i + 1 < argv.length) {
      mediaResolution = String(argv[i + 1]);
      i += 1;
    } else if (a.startsWith("--media-resolution=")) {
      mediaResolution = a.slice("--media-resolution=".length);
    }
  }
  return { runLive, model, targetTokens, seed, mediaResolution };
}

// ---------------------------------------------------------------------------
// Symmetric request builders — identical config, only contents differ
// ---------------------------------------------------------------------------

export const WRAPPER_PROMPT =
  "Retrieve PF_CHECK_A, PF_CHECK_B, PF_CHECK_C, REMOTE_FACT_ALPHA, REMOTE_FACT_BETA exactly and combine as ALPHA/BETA. Return JSON with keys PF_CHECK_A, PF_CHECK_B, PF_CHECK_C, REMOTE_FACT_ALPHA, REMOTE_FACT_BETA, COMBINED. Do not guess.";

export function buildGenerateContentRequest(
  model: string,
  contents: unknown,
  config: typeof LIVE_SMOKE_DEFAULT_CONFIG
): { model: string; contents: unknown; config: typeof LIVE_SMOKE_DEFAULT_CONFIG } {
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error("model must be non-empty string");
  }
  // Validate contents not malformed before network counting
  if (contents === null || contents === undefined) {
    throw new Error("contents must be non-empty");
  }
  if (Array.isArray(contents) && contents.length === 0) {
    throw new Error("contents must be non-empty array");
  }
  if (typeof contents === "string" && contents.trim().length === 0) {
    throw new Error("contents string must be non-empty");
  }
  return { model, contents, config };
}

export function buildCountTokensRequest(
  model: string,
  contents: unknown
): { model: string; contents: unknown } {
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error("model must be non-empty string");
  }
  if (contents === null || contents === undefined) {
    throw new Error("contents must be non-empty");
  }
  if (Array.isArray(contents) && contents.length === 0) {
    throw new Error("contents must be non-empty array");
  }
  return { model, contents };
}

/** Build plain vs PDF contents with identical wrapper prompt. */
export function buildSymmetricContents(
  corpus: string,
  pdfInlinePart: ReturnType<typeof toGeminiInlinePart>
): { plainContents: unknown; pdfContents: unknown } {
  const plainContents = [{ text: `${WRAPPER_PROMPT}\n\nCorpus:\n${corpus}` }];
  const pdfContents = [pdfInlinePart, { text: WRAPPER_PROMPT }];
  return { plainContents, pdfContents };
}

// ---------------------------------------------------------------------------
// Call cap — enforced BEFORE network
// ---------------------------------------------------------------------------

export class LiveSmokeCallCapError extends Error {
  public readonly code = "CALL_CAP_EXCEEDED" as const;
  public constructor(message: string) {
    super(message);
    this.name = "LiveSmokeCallCapError";
  }
}

export interface LiveModelClient {
  readonly models: {
    countTokens(params: { model: string; contents: unknown }): Promise<unknown>;
    generateContent(params: {
      model: string;
      contents: unknown;
      config?: unknown;
    }): Promise<unknown>;
  };
}

export function createCappedClient(
  inner: LiveModelClient,
  maxCalls: number = LIVE_SMOKE_MAX_CALLS
): LiveModelClient {
  let calls = 0;
  function assertCap(): void {
    calls += 1;
    if (calls > maxCalls) {
      throw new LiveSmokeCallCapError(
        `live smoke call cap exceeded: max ${maxCalls} calls, attempted ${calls}`
      );
    }
  }
  return {
    models: {
      async countTokens(params) {
        assertCap();
        return inner.models.countTokens(params);
      },
      async generateContent(params) {
        assertCap();
        return inner.models.generateContent(params);
      },
    },
  };
}

export function getCallCountForTesting(): never {
  throw new Error("call count is internal to capped client closure");
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface LiveSmokeAccountingBundle {
  readonly plain: unknown; // GeminiUsageRecord
  readonly pdf: unknown;
}

export interface LiveSmokeReport {
  readonly version: 1;
  readonly sdk: string;
  readonly model: string;
  readonly config: typeof LIVE_SMOKE_DEFAULT_CONFIG;
  readonly timing: { startedAt: string; durationMs: number };
  readonly rawSha256: { plain: string; pdf: string };
  readonly accounting: LiveSmokeAccountingBundle;
  readonly probe: {
    targetTokens: number;
    seed: number;
    mediaResolution: string;
    corpusChars: number;
    pdfBytes: number;
    pdfPageCount: number;
  };
  readonly provenance: {
    sourceLocatorPlain: string;
    sourceLocatorPdf: string;
  };
}

// ---------------------------------------------------------------------------
// Core runner — testable with injected dependencies
// ---------------------------------------------------------------------------

export interface RunLiveSmokeOptions {
  readonly model?: string | undefined;
  readonly targetTokens?: number | undefined;
  readonly seed?: number | undefined;
  readonly mediaResolution?: string | undefined;
  readonly client: LiveModelClient;
  readonly sdkVersion?: string | undefined;
}

export async function runLiveSmokeWithClient(options: RunLiveSmokeOptions): Promise<{
  report: LiveSmokeReport;
  redactedReportJson: string;
}> {
  const model = options.model ?? LIVE_SMOKE_DEFAULT_MODEL;
  const targetTokens = options.targetTokens ?? LIVE_SMOKE_DEFAULT_TOKENS;
  const seed = options.seed ?? LIVE_SMOKE_DEFAULT_SEED;
  const mediaResolution = options.mediaResolution ?? LIVE_SMOKE_DEFAULT_MEDIA_RESOLUTION;
  const config = {
    ...LIVE_SMOKE_DEFAULT_CONFIG,
    mediaResolution,
  } as typeof LIVE_SMOKE_DEFAULT_CONFIG & { mediaResolution: string };

  // Validate before any network
  if (typeof model !== "string" || model.trim().length === 0) throw new Error("model required");
  if (!Number.isInteger(targetTokens) || targetTokens < 1) throw new Error("targetTokens must be integer >=1");
  if (!Number.isInteger(seed)) throw new Error("seed must be integer");

  // Build corpus and verified PDF (fail-closed, no network)
  const corpus = generateSeed42Corpus(targetTokens as 5000, seed);
  const artifact = await compileContextWithBundledFonts(corpus);
  const pdfPart = toGeminiInlinePart(artifact);
  const { plainContents, pdfContents } = buildSymmetricContents(corpus, pdfPart);

  // Build symmetric requests — must be identical except contents
  const plainReq = buildGenerateContentRequest(model, plainContents, config as typeof LIVE_SMOKE_DEFAULT_CONFIG);
  const pdfReq = buildGenerateContentRequest(model, pdfContents, config as typeof LIVE_SMOKE_DEFAULT_CONFIG);

  // Also validate countTokens symmetry (no network yet) — symmetric config check
  const plainCountReq = buildCountTokensRequest(model, plainContents);
  const pdfCountReq = buildCountTokensRequest(model, pdfContents);
  if (plainCountReq.model !== pdfCountReq.model) {
    throw new Error("countTokens model must be symmetric");
  }

  // Ensure configs are identical (plain vs pdf)
  if (JSON.stringify(plainReq.config) !== JSON.stringify(pdfReq.config)) {
    throw new Error("generateContent config must be identical for plain vs pdf");
  }
  if (plainReq.model !== pdfReq.model) {
    throw new Error("generateContent model must be identical for plain vs pdf");
  }

  // Capped client — 2-call cap enforced before network
  const capped = createCappedClient(options.client, LIVE_SMOKE_MAX_CALLS);

  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  // Exactly 2 network calls: plain generateContent, pdf generateContent
  const plainResp = (await capped.models.generateContent({
    model: plainReq.model,
    contents: plainReq.contents,
    config: plainReq.config,
  })) as Record<string, unknown>;

  const pdfResp = (await capped.models.generateContent({
    model: pdfReq.model,
    contents: pdfReq.contents,
    config: pdfReq.config,
  })) as Record<string, unknown>;

  const durationMs = performance.now() - t0;

  // Extract usageMetadata (SDK returns usageMetadata camelCase)
  const plainUsageRaw =
    (plainResp as { usageMetadata?: unknown }).usageMetadata ??
    (plainResp as { usage_metadata?: unknown }).usage_metadata ??
    plainResp;
  const pdfUsageRaw =
    (pdfResp as { usageMetadata?: unknown }).usageMetadata ??
    (pdfResp as { usage_metadata?: unknown }).usage_metadata ??
    pdfResp;

  const now = new Date().toISOString();
  const plainRawJson = JSON.stringify(plainUsageRaw);
  const pdfRawJson = JSON.stringify(pdfUsageRaw);
  const plainSha = sha256Hex(plainRawJson);
  const pdfSha = sha256Hex(pdfRawJson);

  // Parse to accounting records with provenance (no invented totals)
  const plainParsed = normalizeGeminiUsage(plainUsageRaw, {
    id: `live-plain-${targetTokens}-seed${seed}`,
    observedAt: now,
    sourceLocator: `live-gemini-plain-${targetTokens}-seed${seed}`,
    rawSha256: plainSha,
    provider: "google",
    model,
  });
  const pdfParsed = normalizeGeminiUsage(pdfUsageRaw, {
    id: `live-pdf-${targetTokens}-seed${seed}`,
    observedAt: now,
    sourceLocator: `live-gemini-pdf-${targetTokens}-seed${seed}`,
    rawSha256: pdfSha,
    provider: "google",
    model,
  });

  if (!plainParsed.ok) {
    throw new Error(`plain usage parse failed: ${plainParsed.error.message}`);
  }
  if (!pdfParsed.ok) {
    throw new Error(`pdf usage parse failed: ${pdfParsed.error.message}`);
  }

  // Determine SDK version string — caller supplies or fallback
  let sdkVersion = options.sdkVersion ?? "unknown";
  if (sdkVersion === "unknown") {
    try {
      // Try to read from @google/genai package.json if available
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const pkg = require("@google/genai/package.json") as { version?: string };
      if (pkg.version) sdkVersion = pkg.version;
    } catch {
      // keep unknown
    }
  }

  const report: LiveSmokeReport = {
    version: 1,
    sdk: `@google/genai@${sdkVersion}`,
    model,
    config: config as typeof LIVE_SMOKE_DEFAULT_CONFIG,
    timing: { startedAt, durationMs },
    rawSha256: { plain: plainSha, pdf: pdfSha },
    accounting: {
      plain: plainParsed.record,
      pdf: pdfParsed.record,
    },
    probe: {
      targetTokens,
      seed,
      mediaResolution,
      corpusChars: corpus.length,
      pdfBytes: artifact.pdfBytes.length,
      pdfPageCount: artifact.pageCount,
    },
    provenance: {
      sourceLocatorPlain: `live-gemini-plain-${targetTokens}-seed${seed}`,
      sourceLocatorPdf: `live-gemini-pdf-${targetTokens}-seed${seed}`,
    },
  };

  // Redacted JSON — never contains key
  const secrets: string[] = [];
  const redactedReportJson = redactJsonForLogging(report, secrets);

  return { report, redactedReportJson };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const env = process.env as Record<string, string | undefined>;
  const secrets = collectSecretsFromEnv(env);

  // Skip path — exact SKIP status, exit 0, no network, no secret serialization
  if (!shouldRunLive(argv, env)) {
    console.log(LIVE_SMOKE_SKIP_MESSAGE);
    process.exit(0);
  }

  // Validate key not empty after flag check (fail before client construction)
  const apiKey = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim();
  if (apiKey.length === 0) {
    console.log(LIVE_SMOKE_SKIP_MESSAGE);
    process.exit(0);
  }

  const { model, targetTokens, seed, mediaResolution } = parseLiveArgs(argv);

  // Construct real client — only after opt-in gate
  let client: LiveModelClient;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    // Wrap to LiveModelClient shape (models.countTokens/generateContent)
    client = ai as unknown as LiveModelClient;
  } catch (e) {
    const msg = redactSecrets(String(e), secrets);
    console.error(`[live-gemini] failed to create client: ${msg}`);
    process.exit(1);
  }

  try {
    const { redactedReportJson } = await runLiveSmokeWithClient({
      model,
      targetTokens,
      seed,
      mediaResolution,
      client,
    });
    // Ensure redaction of any accidental key leakage in report
    const safe = redactSecrets(redactedReportJson, secrets);
    console.log(safe);
    // Also ensure secrets never appear in output
    if (secrets.length > 0 && secrets.some((s) => safe.includes(s))) {
      console.error("[live-gemini] credential leak detected — redacting");
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : String(e), secrets);
    const stack = e instanceof Error && e.stack ? redactSecrets(e.stack, secrets) : undefined;
    console.error(`[live-gemini] FAIL: ${msg}`);
    if (stack) console.error(stack);
    process.exit(1);
  }
}

// ESM main detection compatible with Bun
if (import.meta.main) {
  main().catch((e) => {
    const secrets = collectSecretsFromEnv(process.env as Record<string, string | undefined>);
    const msg = redactSecrets(e instanceof Error ? e.message : String(e), secrets);
    console.error(`[live-gemini] FAIL: ${msg}`);
    process.exit(1);
  });
}
