import "server-only";
// Must be imported before "pdf-parse" (maintainer-documented fix; see
// pdf-parse's docs/troubleshooting.md #1/#3 and the Phase 8 Increment 3
// completion record for the full investigation). This statically sets
// `global.DOMMatrix` before pdfjs-dist's own unreliable dynamic require of
// the same package runs, which otherwise crashes this module at import
// time in Vercel's deployed runtime.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

// Knowledge Processing Service — PDF text extraction (Phase 4, Increment 3).
// Wraps pdf-parse@2.4.5's actual class-based API (`new PDFParse({ data
// }).getText()`), not the legacy v1 `pdf(buffer) => { text }` promise
// interface. Must run only in the Node.js runtime (this module's callers
// must never declare `export const runtime = "edge"`).
export interface ExtractionResult {
  text: string;
  pageCount: number;
}

// Extracts concatenated document text from a PDF buffer. Throws on a
// genuinely malformed/unparseable PDF (the caller maps this to the
// `failed` status). Returns an ExtractionResult with possibly-empty `text`
// for a structurally valid PDF containing no extractable text (e.g.
// scanned/image-only) -- empty-text validation is the caller's
// responsibility; OCR is explicitly outside this increment's boundary.
export async function extractDocumentText(buffer: Buffer): Promise<ExtractionResult> {
  const parser = new PDFParse({ data: buffer, CanvasFactory });

  try {
    const result = await parser.getText();
    return { text: result.text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}
