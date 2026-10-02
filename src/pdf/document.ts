/** Shared, bounded PDF loading and resource ownership for extraction. */
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { ContextPackError } from "../errors.js";

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_PAGES = 32;

export interface ExtractionOptions {
  readonly signal?: AbortSignal;
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ContextPackError({ code: "ABORTED", details: { reason: "aborted" } }, "Aborted");
  }
}

function validateBytes(pdfBytes: Uint8Array): void {
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "pdfBytes must be Uint8Array" } },
      "Malformed PDF: pdfBytes not Uint8Array"
    );
  }
  if (pdfBytes.length === 0) {
    throw new ContextPackError(
      { code: "MALFORMED_PDF", details: { reason: "empty pdfBytes" } },
      "Malformed PDF: empty bytes"
    );
  }
  if (pdfBytes.length > MAX_PDF_BYTES) {
    throw new ContextPackError(
      { code: "PDF_LIMIT_EXCEEDED", details: { limit: "64MiB", actual: pdfBytes.length } },
      "PDF limit exceeded: 64MiB"
    );
  }
}

export async function withPdfDocument<T>(
  pdfBytes: Uint8Array,
  options: ExtractionOptions | undefined,
  read: (doc: PDFDocumentProxy) => Promise<T>
): Promise<T> {
  validateBytes(pdfBytes);
  checkAborted(options?.signal);
  // Keep pdfjs lazy for consumers that only use canonicalization or compilation setup.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  checkAborted(options?.signal);
  let task: PDFDocumentLoadingTask | undefined;
  let result: T;
  try {
    let doc: PDFDocumentProxy;
    try {
      const parameters = {
        // pdfjs may transfer the buffer; the caller retains ownership of its bytes.
        data: new Uint8Array(pdfBytes),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
      };
      task = pdfjs.getDocument(parameters);
      doc = await task.promise;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ContextPackError(
        { code: "MALFORMED_PDF", details: { reason } },
        `Malformed PDF: ${reason}`
      );
    }

    checkAborted(options?.signal);
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
    result = await read(doc);
  } finally {
    // The loading task owns resources even when its promise rejects. Await cleanup
    // so asynchronous failures cannot escape as unhandled rejections.
    try {
      await task?.destroy();
    } catch {
      // Best effort: cleanup must not replace the extraction result or typed error.
    }
  }
  // Only a successful read reaches this point. Honor cancellation during cleanup
  // without replacing a primary load/extraction error already propagating above.
  checkAborted(options?.signal);
  return result;
}
