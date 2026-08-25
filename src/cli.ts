#!/usr/bin/env node
/**
 * gemini-context-pack CLI — offline context packaging commands.
 * Uses Node parseArgs, bundled fonts only, no API key/provider/network options.
 * Success JSON to stdout, typed failure JSON to stderr, stable exit codes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";

import { hashCanonical } from "./canonicalization.js";
import { ContextPackError } from "./errors.js";
import { compileContextWithBundledFonts } from "./fonts/node-loader.js";
import { extractCanonicalSource } from "./pdf/extract.js";
import { verifyPdf } from "./pdf/verify.js";
import { CANONICALIZATION_ID } from "./types.js";

const VERSION = "0.1.0";

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 1;
const EXIT_FAILURE = 2;

function emitSuccess(payload: Record<string, unknown>): never {
  console.log(JSON.stringify(payload));
  process.exit(EXIT_SUCCESS);
}

function emitFailure(code: string, message: string, details?: unknown): never {
  const payload: Record<string, unknown> =
    details === undefined ? { ok: false, code, message } : { ok: false, code, message, details };
  console.error(JSON.stringify(payload));
  process.exit(EXIT_FAILURE);
}

function emitUsage(message: string, details?: unknown): never {
  const payload: Record<string, unknown> =
    details === undefined
      ? { ok: false, code: "USAGE_ERROR", message }
      : { ok: false, code: "USAGE_ERROR", message, details };
  console.error(JSON.stringify(payload));
  process.exit(EXIT_USAGE);
}

function helpText(): string {
  return [
    "gemini-context-pack v" + VERSION,
    "",
    "Usage: gemini-context-pack <command> [options]",
    "",
    "Commands:",
    "  compile --input <file> --output <pdf> [--page-budget <n>] [--force]  Compile source to PDF",
    "  verify  --pdf <file> --source <file>                                  Verify PDF against source",
    "  inspect --pdf <file>                                                   Inspect PDF metadata",
    "",
    "Options:",
    "  -h, --help     Show help",
    "  --version      Show version",
    "  --force        Allow overwrite of existing output (compile only)",
    "",
    "Exit codes: 0 success, 1 usage, 2 failure",
  ].join("\n");
}

function compileHelp(): string {
  return [
    "Usage: gemini-context-pack compile --input <file> --output <pdf> [--page-budget <n>] [--force]",
    "  --input <file>        Source text file (utf-8)",
    "  --output <pdf>        Output PDF path",
    "  --page-budget <n>     Max pages (1..32, default 1)",
    "  --force               Overwrite existing output",
  ].join("\n");
}

function verifyHelp(): string {
  return [
    "Usage: gemini-context-pack verify --pdf <file> --source <file>",
    "  --pdf <file>          PDF artifact to verify",
    "  --source <file>       Expected source text file (utf-8)",
  ].join("\n");
}

function inspectHelp(): string {
  return ["Usage: gemini-context-pack inspect --pdf <file>", "  --pdf <file>          PDF artifact to inspect"].join(
    "\n"
  );
}

function parseOptionalPageBudget(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // Must be decimal integer string (allow 0..32+ to let compiler emit typed failure)
  if (!/^[0-9]+$/.test(raw)) {
    emitUsage("Invalid --page-budget: must be integer", { value: raw });
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    emitUsage("Invalid --page-budget: must be integer", { value: raw });
  }
  return n;
}

async function withSuppressedPdfjs<T>(fn: () => Promise<T>): Promise<T> {
  const origWarn = console.warn;
  const origLog = console.log;
  const origError = console.error;
  const noop = (): void => {};
  try {
    console.warn = noop as typeof console.warn;
    console.log = noop as typeof console.log;
    console.error = noop as typeof console.error;
    return await fn();
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    console.error = origError;
  }
}

async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  return withSuppressedPdfjs(async () => {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument: (src: unknown) => { promise: Promise<{ numPages: number; destroy: () => void }> };
    };
    const data = new Uint8Array(pdfBytes);
    let doc: { numPages: number; destroy: () => void } | null = null;
    try {
      const task = mod.getDocument({ data, disableWorker: true, isEvalSupported: false } as unknown as Record<
        string,
        unknown
      >);
      const loaded = (await task.promise) as unknown as { numPages: number; destroy: () => void };
      doc = loaded;
      return loaded.numPages;
    } finally {
      try {
        doc?.destroy();
      } catch {
        // ignore
      }
    }
  });
}

async function handleCompile(rawArgs: string[]): Promise<void> {
  let values: {
    input?: string;
    output?: string;
    "page-budget"?: string;
    force?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: rawArgs,
      options: {
        input: { type: "string" },
        output: { type: "string" },
        "page-budget": { type: "string" },
        force: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    values = parsed.values as typeof values;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitUsage(msg);
  }

  if (values.help) {
    console.log(compileHelp());
    process.exit(EXIT_SUCCESS);
  }
  if (values.input === undefined || values.output === undefined) {
    emitUsage("compile requires --input <file> and --output <pdf>", {
      help: compileHelp(),
    });
  }

  const inputPath = resolve(values.input);
  const outputPath = resolve(values.output);
  const pageBudget = parseOptionalPageBudget(values["page-budget"]);
  const force = values.force === true;

  // Validate input exists and is readable
  if (!existsSync(inputPath)) {
    emitFailure("INPUT_NOT_FOUND", `Input not found: ${values.input}`, { input: values.input });
  }
  let source: string;
  try {
    source = readFileSync(inputPath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("INPUT_NOT_FOUND", `Cannot read input: ${msg}`, { input: values.input });
  }

  // No overwrite without --force — preserve output
  if (existsSync(outputPath) && !force) {
    emitFailure("OUTPUT_EXISTS", `Output exists (use --force to overwrite): ${values.output}`, {
      output: values.output,
    });
  }

  // Compile via bundled fonts only
  let artifact: Awaited<ReturnType<typeof compileContextWithBundledFonts>>;
  try {
    artifact = await withSuppressedPdfjs(() =>
      compileContextWithBundledFonts(source, {
        ...(pageBudget !== undefined ? { pageBudget } : {}),
      })
    );
  } catch (err: unknown) {
    if (err instanceof ContextPackError) {
      emitFailure(err.code, err.message, err.details);
    }
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("COMPILE_FAILED", msg);
  }

  // Ensure parent directory exists (OS temp-safe: handles arbitrary paths)
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
  } catch {
    // ignore — write will fail with typed error below
  }

  // Atomic write to avoid partial output on failure
  const tmpName = `${outputPath}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmpName, artifact.pdfBytes);
    // Verify written data is correct size before rename
    renameSync(tmpName, outputPath);
  } catch (err: unknown) {
    try {
      if (existsSync(tmpName)) unlinkSync(tmpName);
    } catch {
      // ignore
    }
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("OUTPUT_WRITE_FAILED", msg, { output: values.output });
  }

  emitSuccess({
    ok: true,
    command: "compile",
    canonicalizationId: CANONICALIZATION_ID,
    canonicalHash: artifact.canonicalHash,
    pageCount: artifact.pageCount,
    bytes: artifact.pdfBytes.length,
    input: values.input,
    output: values.output,
  });
}

async function handleVerify(rawArgs: string[]): Promise<void> {
  let values: { pdf?: string; source?: string; help?: boolean };
  try {
    const parsed = parseArgs({
      args: rawArgs,
      options: {
        pdf: { type: "string" },
        source: { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    values = parsed.values as typeof values;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitUsage(msg);
  }

  if (values.help) {
    console.log(verifyHelp());
    process.exit(EXIT_SUCCESS);
  }
  if (values.pdf === undefined || values.source === undefined) {
    emitUsage("verify requires --pdf <file> and --source <file>", { help: verifyHelp() });
  }

  const pdfPath = resolve(values.pdf);
  const sourcePath = resolve(values.source);

  if (!existsSync(pdfPath)) {
    emitFailure("INPUT_NOT_FOUND", `PDF not found: ${values.pdf}`, { pdf: values.pdf });
  }
  if (!existsSync(sourcePath)) {
    emitFailure("INPUT_NOT_FOUND", `Source not found: ${values.source}`, { source: values.source });
  }

  let pdfBytes: Uint8Array;
  let expectedSource: string;
  try {
    pdfBytes = readFileSync(pdfPath) as unknown as Uint8Array;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("INPUT_NOT_FOUND", `Cannot read PDF: ${msg}`, { pdf: values.pdf });
  }
  try {
    expectedSource = readFileSync(sourcePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("INPUT_NOT_FOUND", `Cannot read source: ${msg}`, { source: values.source });
  }

  try {
    const report = await withSuppressedPdfjs(() => verifyPdf(pdfBytes, expectedSource));
    if (report.status === "verified") {
      const pc = await getPdfPageCount(pdfBytes).catch(() => undefined);
      emitSuccess({
        ok: true,
        command: "verify",
        status: "verified",
        canonicalizationId: report.canonicalizationId,
        expectedHash: report.expectedHash,
        extractedHash: report.extractedHash,
        pageCount: pc,
        bytes: pdfBytes.length,
      });
    } else {
      emitFailure("INTEGRITY_MISMATCH", "Verification mismatch: expected source differs from extracted", {
        expectedHash: report.expectedHash,
        actualHash: report.extractedHash,
        canonicalizationId: report.canonicalizationId,
      });
    }
  } catch (err: unknown) {
    if (err instanceof ContextPackError) {
      if (err.code === "INVALID_TRANSPORT") {
        emitFailure("MALFORMED_PDF", err.message, err.details);
      }
      emitFailure(err.code, err.message, err.details);
    }
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("VERIFY_FAILED", msg);
  }
}

async function handleInspect(rawArgs: string[]): Promise<void> {
  let values: { pdf?: string; help?: boolean };
  try {
    const parsed = parseArgs({
      args: rawArgs,
      options: {
        pdf: { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    values = parsed.values as typeof values;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitUsage(msg);
  }

  if (values.help) {
    console.log(inspectHelp());
    process.exit(EXIT_SUCCESS);
  }
  if (values.pdf === undefined) {
    emitUsage("inspect requires --pdf <file>", { help: inspectHelp() });
  }

  const pdfPath = resolve(values.pdf);
  if (!existsSync(pdfPath)) {
    emitFailure("INPUT_NOT_FOUND", `PDF not found: ${values.pdf}`, { pdf: values.pdf });
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = readFileSync(pdfPath) as unknown as Uint8Array;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("INPUT_NOT_FOUND", `Cannot read PDF: ${msg}`, { pdf: values.pdf });
  }

  try {
    const extractedSource = await withSuppressedPdfjs(() => extractCanonicalSource(pdfBytes));
    const extractedHash = hashCanonical(extractedSource);
    const pageCount = await getPdfPageCount(pdfBytes);
    emitSuccess({
      ok: true,
      command: "inspect",
      canonicalizationId: CANONICALIZATION_ID,
      extractedHash,
      pageCount,
      bytes: pdfBytes.length,
      extractedSourceLength: extractedSource.length,
    });
  } catch (err: unknown) {
    if (err instanceof ContextPackError) {
      if (err.code === "INVALID_TRANSPORT") {
        emitFailure("MALFORMED_PDF", err.message, err.details);
      }
      emitFailure(err.code, err.message, err.details);
    }
    const msg = err instanceof Error ? err.message : String(err);
    emitFailure("INSPECT_FAILED", msg);
  }
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);

  // Global help / version
  if (raw.length === 0 || raw.includes("--help") || raw.includes("-h")) {
    // If no command, show global help (unless command-specific --help handled downstream)
    // Detect if a known command precedes --help: treat as command help -> delegate
    if (raw.length >= 2 && ["compile", "verify", "inspect"].includes(raw[0] ?? "")) {
      // delegate to command handler — it will handle --help
    } else if (raw.length === 0 || (raw.length === 1 && (raw[0] === "--help" || raw[0] === "-h"))) {
      console.log(helpText());
      process.exit(EXIT_SUCCESS);
    }
  }
  if (raw.includes("--version") || raw.includes("-v")) {
    if (raw.length === 1) {
      console.log(VERSION);
      process.exit(EXIT_SUCCESS);
    }
  }

  const command = raw[0];
  const rest = raw.slice(1);

  // Global --help without command
  if (command === "--help" || command === "-h") {
    console.log(helpText());
    process.exit(EXIT_SUCCESS);
  }
  if (command === "--version") {
    console.log(VERSION);
    process.exit(EXIT_SUCCESS);
  }

  if (command === "compile") {
    await handleCompile(rest);
  } else if (command === "verify") {
    await handleVerify(rest);
  } else if (command === "inspect") {
    await handleInspect(rest);
  } else if (command === undefined) {
    console.log(helpText());
    process.exit(EXIT_SUCCESS);
  } else {
    emitUsage(`Unknown command: ${String(command)}`, { help: helpText() });
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  // Never leak stack
  console.error(JSON.stringify({ ok: false, code: "UNKNOWN_ERROR", message: msg }));
  process.exit(EXIT_FAILURE);
});
