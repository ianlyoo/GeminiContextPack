/**
 * Node entry — `gemini-context-pack/node`.
 * Provides bundled-font helpers that read committed bytes via fs.
 * Core remains bytes-only; this is the only fs boundary.
 */

export { compileContextWithBundledFonts, loadBundledFonts } from "./fonts/node-loader.js";
export type {
  BundledCompileOptions,
  BundledFontEntry,
  BundledFontManifest,
} from "./fonts/types.js";
export { PACKAGE_NAME, VERSION } from "./index.js";
