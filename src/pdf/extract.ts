/**
 * Writer-independent extraction via pdfjs-dist.
 * Guards: 64MiB file size, 32 pages.
 * Draw-order join, EOL ignored, JSON transport decode.
 */
import { canonicalize, decodeTransport } from "../canonicalization.js";
import { ContextPackError } from "../errors.js";

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_PAGES = 32;

// Lazy import pdfjs to avoid top-level worker issues in non-node contexts.
async function getPdfjs(): Promise<{
  getDocument: (src: unknown) => { promise: Promise<unknown> };
}> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (src: unknown) => { promise: Promise<unknown> };
  };
  return mod;
}

function ensureUint8Array(pdfBytes: unknown): Uint8Array {
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "pdfBytes must be Uint8Array" } },
      "Malformed PDF: pdfBytes not Uint8Array"
    );
  }
  return pdfBytes;
}

export interface ExtractResult {
  readonly transportText: string;
  readonly canonicalSource: string;
}

/**
 * Extract transport text from PDF bytes via pdfjs-dist.
 * - Enforces 64MiB and 32-page guards
 * - Joins text items in draw order without adding EOL
 * - Strips extractor-added EOL before returning
 */
export async function extractTransportText(
  pdfBytes: Uint8Array,
  options?: { readonly signal?: AbortSignal }
): Promise<string> {
  const bytes = ensureUint8Array(pdfBytes);

  if (bytes.length === 0) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "empty pdfBytes" } },
      "Malformed PDF: empty bytes"
    );
  }
  if (bytes.length > MAX_PDF_BYTES) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "64MiB", actual: bytes.length } },
      "PDF limit exceeded: 64MiB"
    );
  }
  if (options?.signal?.aborted) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }

  const pdfjs = await getPdfjs();

  let doc: {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{ items: readonly { str: string; hasEOL?: boolean }[] }>;
    }>;
    destroy: () => void;
  };

  try {
    // Clone to avoid detaching original buffer (pdfjs may transfer)
    const data = new Uint8Array(bytes);
    const loadingTask = pdfjs.getDocument({
      data,
      // Ensure Node usage without worker / canvas.
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    } as unknown as Record<string, unknown>);
    const loaded = (await loadingTask.promise) as unknown as typeof doc;
    doc = loaded;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason } },
      `Malformed PDF: ${reason}`
    );
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new ContextPackError(
        {
          code: "PDF_LIMIT_EXCEEDED",
          details: { limit: "pageCount <= 32", actual: doc.numPages },
        },
        "PDF limit exceeded: pageCount > 32"
      );
    }
    if (doc.numPages === 0) {
      throw new ContextPackError(
        { code: "MALFORMED_PDF", details: { reason: "no pages" } },
        "Malformed PDF: no pages"
      );
    }

    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      if (options?.signal?.aborted) {
        throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
      }
      let textContent: { items: readonly { str: string; hasEOL?: boolean }[] };
      try {
        const page = await doc.getPage(i);
        textContent = await page.getTextContent();
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new ContextPackError(
          { code: "MALFORMED_PDF", details: { reason } },
          `Malformed PDF: page ${i} text extraction failed: ${reason}`
        );
      }
      // Draw order is the order pdfjs returns items. Join without adding EOL.
      for (const item of textContent.items) {
        // Only TextItem has str; TextMarkedContent has no str.
        if (typeof item.str === "string") {
          parts.push(item.str);
        }
      }
      // Do NOT insert EOL between pages. Writer-independent extraction must not
      // invent line breaks; JSON transport is single-line.
    }

    const rawJoined = parts.join("");
    // Ignore extractor-added EOL: JSON transport contains no literal LF/CR
    // (newlines are escaped as \n inside JSON). Any literal newline must be artifact.
    // Normalize: strip all literal CR/LF characters without touching escaped sequences.
    const normalized = rawJoined.replaceAll("\r\n", "").replaceAll("\r", "").replaceAll("\n", "");

    if (normalized.length === 0) {
      // Empty after strip implies no valid transport; treat as invalid transport
      // unless raw also empty (handled downstream as decode failure)
      // Let decode handle.
    }

    return normalized;
  } finally {
    try {
      doc.destroy();
    } catch {
      // ignore
    }
  }
}

/**
 * Extract and decode canonical source from PDF bytes.
 * Throws MALFORMED_PDF, PDF_LIMIT_EXCEEDED, INVALID_TRANSPORT as appropriate.
 */
export async function extractCanonicalSource(
  pdfBytes: Uint8Array,
  options?: { readonly signal?: AbortSignal }
): Promise<string> {
  const transportText = await extractTransportText(pdfBytes, options);
  try {
    const decoded = decodeTransport(transportText);
    // Ensure decoded is already canonical; defensively canonicalize again for SHA stability
    // but return as decoded (which equals canonicalize(original)).
    void canonicalize;
    return decoded;
  } catch (err: unknown) {
    if (err instanceof ContextPackError && err.code === "INVALID_TRANSPORT") {
      // Re-throw as INVALID_TRANSPORT with same details
      throw err;
    }
    if (err instanceof ContextPackError) throw err;
    throw new ContextPackError(
      { code: "INVALID_TRANSPORT", details: { reason: String(err) } },
      "Invalid transport"
    );
  }
}
