/**
 * Type-level proof that public API rejects forbidden patterns.
 * This file is type-checked but not executed. Each @ts-expect-error must be valid,
 * proving callers cannot: omit fonts, pass role/message policy, disable verification,
 * or forge the private verified brand.
 */

import { compileContext } from "../src/index.js";
import type { VerifiedArtifact } from "../src/types.js";

// @ts-expect-error fonts is required — omitting should fail
void compileContext("hello", {});

// @ts-expect-error role must not be allowed
void compileContext("hello", { fonts: { regular: new Uint8Array([1]) }, role: "system" });

// biome-ignore format: preserve single line for ts-expect-error
// @ts-expect-error messages must not be allowed
void compileContext("hello", { fonts: { regular: new Uint8Array([1]) }, messages: [{ role: "user", content: "hi" }] });

// @ts-expect-error disabling verification must not exist
void compileContext("hello", { fonts: { regular: new Uint8Array([1]) }, verify: false });

// @ts-expect-error forging VerifiedArtifact via plain literal must fail
const forged: VerifiedArtifact = {
  pdfBytes: new Uint8Array([1]),
  canonicalSource: "hi",
  canonicalHash: "abc",
  canonicalizationId: "gemini-context-pack-v1",
  pageCount: 1,
  createdAt: new Date().toISOString(),
};

// Valid usage must pass
void compileContext("hello", { fonts: { regular: new Uint8Array([1]) } });
void compileContext("hello", { fonts: { regular: new Uint8Array([1]) }, pageBudget: 1 });
