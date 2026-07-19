import "server-only";
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
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return { text: result.text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}
