import "server-only";

// Knowledge Processing Service — embedding generation (Phase 4, Increment 3).
// Calls the OpenAI REST API directly via native fetch -- no SDK dependency
// added, since only pdf-parse is an approved new dependency for this
// increment. Uses text-embedding-3-small (1536 dimensions), matching the
// document_chunks.embedding column and the model already selected for
// query embedding (technical_specification_v1.md, AI Integration). Issued
// exclusively from this service, preserving the provider-isolation
// principle.
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";
const EXPECTED_DIMENSIONS = 1536;

// OpenAI's embeddings endpoint enforces a hard maximum of 2048 input items
// and 300,000 total tokens per request. This is not a performance/batch-size
// tuning choice -- a single request for a realistically large document (a
// 25 MB PDF chunked at Increment 3's default parameters produces roughly
// 5,000 chunks, well over both ceilings) would be rejected outright by
// OpenAI, not merely run slowly. Batching here is a correctness requirement
// of "embedding generation" as already approved, not a new capability.
// Conservative, well under both hard limits to leave safety margin for
// token-count estimation error (chunking.ts's own documented ~4
// chars/token approximation, reused here for consistency).
const MAX_ITEMS_PER_REQUEST = 500;
const MAX_ESTIMATED_TOKENS_PER_REQUEST = 250_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

// Rate-limit resilience (CSA-approved implementation correction: documented
// OpenAI rate limiting is part of the normal operating contract of the API,
// not an architectural limitation). Bounded -- never an unbounded retry
// loop. A batch that still fails after MAX_RETRIES surfaces as a normal
// processing failure (Document -> `failed`, per existing status handling),
// exactly as any other embedding failure already does.
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_HONORED_SERVER_DELAY_MS = 60_000;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// Splits texts into request-sized batches respecting both the item-count
// and estimated-token ceilings. A single text whose estimated token count
// alone exceeds the per-request budget still gets its own one-item batch
// (OpenAI's separate 8,192-token per-input limit is a distinct constraint,
// not handled here -- chunking.ts's ~500-800 token target keeps individual
// chunks far under that ceiling in practice).
function batchTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const wouldExceed =
      current.length >= MAX_ITEMS_PER_REQUEST ||
      currentTokens + tokens > MAX_ESTIMATED_TOKENS_PER_REQUEST;

    if (wouldExceed && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(text);
    currentTokens += tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parses a duration string in OpenAI's rate-limit header format
// (e.g. "19.225s", "150ms", "6m0s") into milliseconds. Returns null for any
// shape not recognized, rather than guessing.
function parseHeaderDurationMs(text: string): number | null {
  const minutesSeconds = text.match(/^(\d+)m([\d.]+)s$/);
  if (minutesSeconds) {
    return (Number(minutesSeconds[1]) * 60 + Number(minutesSeconds[2])) * 1000;
  }
  const secondsOnly = text.match(/^([\d.]+)s$/);
  if (secondsOnly) {
    return Number(secondsOnly[1]) * 1000;
  }
  const msOnly = text.match(/^([\d.]+)ms$/);
  if (msOnly) {
    return Number(msOnly[1]);
  }
  return null;
}

// Determines how long to wait before retrying a rate-limited request,
// preferring the API's own guidance over a guess, in priority order:
// 1. The standard `Retry-After` header (seconds), per RFC 9110.
// 2. OpenAI's own `x-ratelimit-reset-tokens` / `x-ratelimit-reset-requests`
//    headers, which report exactly when the relevant limit will clear.
// 3. The human-readable hint embedded in the error message itself
//    (e.g. "Please try again in 3.321s").
// Returns null if none of the above are present or parseable -- the caller
// falls back to bounded exponential backoff with jitter in that case.
function parseServerRetryDelayMs(
  response: Response,
  errorBody: OpenAIErrorBody | null
): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const resetHeader =
    response.headers.get("x-ratelimit-reset-tokens") ??
    response.headers.get("x-ratelimit-reset-requests");
  if (resetHeader) {
    const ms = parseHeaderDurationMs(resetHeader);
    if (ms !== null) {
      return ms;
    }
  }

  const message = errorBody?.error?.message;
  if (message) {
    const match = message.match(/try again in ([\d.]+)(ms|s)\b/i);
    const value = match ? Number(match[1]) : NaN;
    const unit = match?.[2];
    if (match && unit && Number.isFinite(value)) {
      return unit.toLowerCase() === "ms" ? value : value * 1000;
    }
  }

  return null;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  let attempt = 0;

  for (;;) {
    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });

    if (response.ok) {
      const body = (await response.json()) as OpenAIEmbeddingResponse;
      const embeddings = new Array<number[]>(texts.length);

      for (const item of body.data) {
        if (item.embedding.length !== EXPECTED_DIMENSIONS) {
          throw new Error("Embedding generation returned an unexpected vector size.");
        }
        embeddings[item.index] = item.embedding;
      }

      return embeddings;
    }

    if (response.status === 429) {
      attempt++;

      if (attempt > MAX_RETRIES) {
        throw new Error(`Embedding generation rate-limited after ${MAX_RETRIES} retries.`);
      }

      let errorBody: OpenAIErrorBody | null = null;
      try {
        errorBody = (await response.json()) as OpenAIErrorBody;
      } catch {
        errorBody = null;
      }

      const serverDelay = parseServerRetryDelayMs(response, errorBody);
      const exponentialBackoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      const jitteredBackoff = exponentialBackoff * (0.5 + Math.random() * 0.5);

      const delayMs =
        serverDelay !== null ? Math.min(serverDelay, MAX_HONORED_SERVER_DELAY_MS) : jitteredBackoff;

      await sleep(delayMs);
      continue;
    }

    // Any non-429, non-2xx response is not retried -- unchanged from prior
    // behavior (e.g. an auth failure or malformed request should surface
    // immediately, not be retried).
    throw new Error(`Embedding generation failed (status ${response.status}).`);
  }
}

// Generates embeddings for a batch of chunk texts, preserving input order
// in the returned array regardless of how many underlying requests (or
// retries within a request) were required. Throws a safe, non-sensitive
// error message (never the API key, request body, or raw provider
// response) on a missing key, a non-retryable non-2xx OpenAI response, a
// rate limit that persists past MAX_RETRIES, or a returned embedding whose
// dimensionality does not match the approved 1536-dimension column.
//
// Idempotency / no-duplicate-chunks: this function performs no persistence
// of any kind -- it only computes vectors and returns them in memory.
// Retrying a rate-limited batch here re-requests embeddings for the same
// texts; it never touches document_chunks. processDocument() (processing.ts)
// inserts Document Chunks only once, in a single batch insert, after every
// batch across the whole document -- including all of its retries -- has
// completed successfully. A batch that exhausts its retries throws, which
// processDocument() maps to the existing `failed` status path; no partial
// or duplicate chunk rows are ever written for a Document that didn't fully
// succeed.
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Embedding generation is not configured.");
  }

  const batches = batchTexts(texts);
  const embeddings: number[][] = [];

  for (const batch of batches) {
    const batchEmbeddings = await embedBatch(batch, apiKey);
    embeddings.push(...batchEmbeddings);
  }

  return embeddings;
}
