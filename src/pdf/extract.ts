/** Writer-independent extraction: draw-order join, EOL removal, JSON transport. */
import type { TextContent } from "pdfjs-dist/types/src/display/api.js";
import { decodeTransport } from "../canonicalization.js";
import { ContextPackError } from "../errors.js";
import { checkAborted, type ExtractionOptions, withPdfDocument } from "./document.js";

export { MAX_PAGES, MAX_PDF_BYTES } from "./document.js";

export interface ExtractResult {
  readonly transportText: string;
  readonly canonicalSource: string;
}

interface TransportResult {
  readonly transportText: string;
  readonly pageCount: number;
}

/** Read text and metadata from the same bounded document lifetime. */
async function extractTransport(
  pdfBytes: Uint8Array,
  options?: ExtractionOptions
): Promise<TransportResult> {
  return withPdfDocument(pdfBytes, options, async (doc) => {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      checkAborted(options?.signal);
      let textContent: TextContent;
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
      checkAborted(options?.signal);
      // TextMarkedContent has no str. Do not invent EOL between items or pages.
      for (const item of textContent.items) {
        if ("str" in item && typeof item.str === "string") parts.push(item.str);
      }
    }

    // JSON transport escapes source newlines; literal CR/LF are extractor artifacts.
    const transportText = parts
      .join("")
      .replaceAll("\r\n", "")
      .replaceAll("\r", "")
      .replaceAll("\n", "");
    return { transportText, pageCount: doc.numPages };
  });
}

/** Extract transport text with the 64MiB and 32-page guards. */
export async function extractTransportText(
  pdfBytes: Uint8Array,
  options?: ExtractionOptions
): Promise<string> {
  return (await extractTransport(pdfBytes, options)).transportText;
}

/** Internal metadata path used by the CLI without reopening the PDF. */
export async function extractPdfContent(
  pdfBytes: Uint8Array,
  options?: ExtractionOptions
): Promise<ExtractResult & { readonly pageCount: number }> {
  const extracted = await extractTransport(pdfBytes, options);
  try {
    return { ...extracted, canonicalSource: decodeTransport(extracted.transportText) };
  } catch (err: unknown) {
    if (err instanceof ContextPackError) throw err;
    throw new ContextPackError(
      { code: "INVALID_TRANSPORT", details: { reason: String(err) } },
      "Invalid transport"
    );
  }
}

/** Extract canonical source, preserving the existing string-returning contract. */
export async function extractCanonicalSource(
  pdfBytes: Uint8Array,
  options?: ExtractionOptions
): Promise<string> {
  return (await extractPdfContent(pdfBytes, options)).canonicalSource;
}
