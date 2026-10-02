import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { encodeTransport } from "../canonicalization.js";
import { extractCanonicalSource, extractTransportText, MAX_PDF_BYTES } from "./extract.js";
import { verifyPdf, verifyPdfWithMetadata } from "./verify.js";

const bytes = new Uint8Array([1, 2, 3]);
const transport = encodeTransport("fixture source");
let restoreDocument = (): void => {};

function stubDocument() {
  const destroy = mock(async () => {});
  const getTextContent = mock(async () => ({ items: [{ str: transport }] }));
  const doc = {
    numPages: 1,
    getPage: mock(async (_page: number) => ({ getTextContent })),
    destroy,
  };
  const task = { promise: Promise.resolve(doc), destroy };
  const open = spyOn(pdfjs, "getDocument").mockReturnValue(
    task as unknown as ReturnType<typeof pdfjs.getDocument>
  );
  restoreDocument = () => open.mockRestore();
  return { doc, task, destroy, getTextContent, open };
}

afterEach(() => restoreDocument());

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PDF extraction resource lifecycle", () => {
  test("verification reads page metadata from one document without changing the public report", async () => {
    const { doc, open } = stubDocument();
    doc.numPages = 2;
    const split = Math.floor(transport.length / 2);
    doc.getPage.mockImplementation(async (page) => ({
      getTextContent: mock(async () => ({
        items: [{ str: page === 1 ? transport.slice(0, split) : transport.slice(split) }],
      })),
    }));
    const result = await verifyPdfWithMetadata(bytes, "fixture source");
    expect(result.pageCount).toBe(2);
    expect(result.report.status).toBe("verified");
    expect(result.report.extractedSource).toBe("fixture source");
    expect(open).toHaveBeenCalledTimes(1);
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(result.report).not.toHaveProperty("pageCount");
    expect(await verifyPdf(bytes, "fixture source")).toEqual(result.report);
  });

  test("waits for asynchronous cleanup before resolving extraction", async () => {
    const { destroy } = stubDocument();
    let cleaned = false;
    destroy.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      cleaned = true;
    });
    expect(await extractCanonicalSource(bytes)).toBe("fixture source");
    expect(cleaned).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("cancellation during deferred cleanup prevents successful verification", async () => {
    const { destroy } = stubDocument();
    const cleanupStarted = deferred();
    const finishCleanup = deferred();
    const controller = new AbortController();
    destroy.mockImplementation(async () => {
      cleanupStarted.resolve();
      await finishCleanup.promise;
    });

    const verification = verifyPdf(bytes, "fixture source", { signal: controller.signal });
    await cleanupStarted.promise;
    controller.abort();
    finishCleanup.resolve();

    await expect(verification).rejects.toMatchObject({ code: "ABORTED" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("cancellation and rejection during deferred cleanup preserve the primary extraction error", async () => {
    const { doc, destroy } = stubDocument();
    const cleanupStarted = deferred();
    const finishCleanup = deferred();
    const controller = new AbortController();
    doc.getPage.mockRejectedValue(new Error("fixture page failure"));
    destroy.mockImplementation(async () => {
      cleanupStarted.resolve();
      await finishCleanup.promise;
      throw new Error("fixture cleanup failure");
    });

    const verification = verifyPdf(bytes, "fixture source", { signal: controller.signal });
    await cleanupStarted.promise;
    controller.abort();
    finishCleanup.resolve();

    await expect(verification).rejects.toMatchObject({
      code: "MALFORMED_PDF",
      message: "Malformed PDF: page 1 text extraction failed: fixture page failure",
      details: { reason: "fixture page failure" },
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("destroys a rejected loading task and preserves the typed load error", async () => {
    const { task, destroy } = stubDocument();
    task.promise = Promise.reject(new Error("fixture load failure"));
    await expect(extractTransportText(bytes)).rejects.toMatchObject({
      code: "MALFORMED_PDF",
      details: { reason: "fixture load failure" },
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("aborting during the last page cannot return extracted content", async () => {
    const { getTextContent, destroy } = stubDocument();
    const controller = new AbortController();
    getTextContent.mockImplementation(async () => {
      controller.abort();
      return { items: [{ str: transport }] };
    });
    await expect(
      extractCanonicalSource(bytes, { signal: controller.signal })
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("page failures and rejected cleanup retain the extraction error", async () => {
    const { doc, destroy } = stubDocument();
    doc.getPage.mockRejectedValue(new Error("fixture page failure"));
    destroy.mockRejectedValue(new Error("fixture cleanup failure"));
    await expect(extractTransportText(bytes)).rejects.toMatchObject({
      code: "MALFORMED_PDF",
      message: "Malformed PDF: page 1 text extraction failed: fixture page failure",
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("guards reject bytes and pre-aborted requests without opening a document", async () => {
    const { open } = stubDocument();
    await expect(extractTransportText(new Uint8Array())).rejects.toMatchObject({
      code: "MALFORMED_PDF",
    });
    await expect(extractTransportText(new Uint8Array(MAX_PDF_BYTES + 1))).rejects.toMatchObject({
      code: "PDF_LIMIT_EXCEEDED",
    });
    await expect(
      extractTransportText(bytes, { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(open).not.toHaveBeenCalled();
  });

  test("page limits release the document without reading any pages", async () => {
    const { doc, destroy } = stubDocument();
    doc.numPages = 33;
    await expect(extractTransportText(bytes)).rejects.toMatchObject({
      code: "PDF_LIMIT_EXCEEDED",
      details: { limit: "pageCount <= 32", actual: 33 },
    });
    expect(doc.getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
