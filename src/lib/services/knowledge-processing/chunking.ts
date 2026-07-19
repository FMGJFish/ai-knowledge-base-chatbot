import "server-only";

// Knowledge Processing Service — chunking (Phase 4, Increment 3).
// Default parameters per technical_specification_v1.md: approximately
// 500-800 tokens per chunk with ~15% overlap, preferring paragraph
// boundaries where practical -- an engineering starting point, exposed as
// configuration and subject to empirical tuning, not a final tuned value.
//
// No tokenizer dependency is installed (only pdf-parse is an approved
// Increment 3 dependency), so token counts are approximated using a
// widely-used rule of thumb for English text (~4 characters per token).
// This is intentionally a documented approximation, not a precision
// tokenizer.
const CHARS_PER_TOKEN_ESTIMATE = 4;
const TARGET_MIN_TOKENS = 500;
const TARGET_MAX_TOKENS = 800;
const OVERLAP_RATIO = 0.15;

const TARGET_MIN_CHARS = TARGET_MIN_TOKENS * CHARS_PER_TOKEN_ESTIMATE;
const TARGET_MAX_CHARS = TARGET_MAX_TOKENS * CHARS_PER_TOKEN_ESTIMATE;
const OVERLAP_CHARS = Math.round(TARGET_MAX_CHARS * OVERLAP_RATIO);

export interface TextChunk {
  content: string;
  chunkOrder: number;
}

// Splits document text into overlapping chunks, preferring to break at
// paragraph boundaries (blank-line-separated) when a break point falls
// within the target range. Falls back to a hard character split, still
// with overlap, when a single paragraph alone exceeds the maximum chunk
// size. Returns an empty array for empty/whitespace-only input -- the
// caller is responsible for treating zero chunks as an empty-text failure.
export function chunkText(text: string): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();

  if (normalized.length === 0) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);
  const chunks: TextChunk[] = [];
  let current = "";
  let chunkOrder = 0;

  const pushChunk = (content: string) => {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      chunks.push({ content: trimmed, chunkOrder: chunkOrder++ });
    }
  };

  for (const paragraph of paragraphs) {
    const candidate = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= TARGET_MAX_CHARS) {
      current = candidate;
      continue;
    }

    if (current.length >= TARGET_MIN_CHARS) {
      pushChunk(current);
      const overlapStart = Math.max(0, current.length - OVERLAP_CHARS);
      current = `${current.slice(overlapStart)}\n\n${paragraph}`;
    } else {
      current = candidate;
    }

    // A single accumulated chunk may still exceed the max (e.g. one very
    // large paragraph) -- hard-split on character boundaries as a
    // fallback, preserving the same overlap ratio.
    while (current.length > TARGET_MAX_CHARS) {
      pushChunk(current.slice(0, TARGET_MAX_CHARS));
      const overlapStart = Math.max(0, TARGET_MAX_CHARS - OVERLAP_CHARS);
      current = current.slice(overlapStart);
    }
  }

  pushChunk(current);

  return chunks;
}
