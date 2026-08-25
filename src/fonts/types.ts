/**
 * Font bundle types — bytes-only, no fs/fetch.
 * Core contract: caller provides Uint8Array(s); never fetches at runtime.
 */

import type { FontBundle } from "../types.js";

export type { FontBundle };

export interface BundledFontEntry {
  readonly name: string;
  readonly filename: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly license: string;
  readonly attribution: string;
}

export interface BundledFontManifest {
  readonly version: number;
  readonly fonts: readonly BundledFontEntry[];
  readonly licenseFile: string;
  readonly licenseSha256?: string;
}

/** Options for node-side bundled helper */
export interface BundledCompileOptions {
  readonly pageBudget?: number;
  readonly signal?: AbortSignal;
}
