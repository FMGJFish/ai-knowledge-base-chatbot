import "server-only";
import { getChatbotConfiguration, type ChatbotConfiguration } from "./config";
import type { RetrievedChunk } from "@/lib/services/retrieval/retrieve";

// AI Response Service (Phase 6, Increment 1). Owns prompt construction and
// configured chat-completion invocation. Stateless and input-driven: never
// retrieves (Retrieval Service, Phase 5), never persists (Conversation
// Service, Phase 7), never calls another service directly, and never
// authenticates or validates a request (Route Handler). Conversation
// history is intentionally not a parameter of this increment -- its
// contract has not yet been established (phase6_execution_strategy_v1.md,
// Increment 1 Boundary) and is deferred to whichever future increment or
// phase first defines it, rather than invented here.
//
// Response contract note: this increment returns response text only. This
// is Version 1 of the service contract, not its permanent shape -- the
// internal chat-completion call already has access to the full provider
// response body before extracting content, so a future increment can
// extend the return value (citations, usage, finish reason, safety
// metadata) without restructuring this module. Nothing beyond text is
// implemented here.
const CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Bounded retry only, mirroring the rate-limit resilience already
// established for the configured embedding provider
// (knowledge-processing/embedding.ts, Phase 4/5 -- ADR Decision 018) --
// the same class of external-platform ceiling applies here. This is an
// independent implementation, not a shared import: embedding.ts is not
// modified, consistent with Increment 1's file-change plan.
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_HONORED_SERVER_DELAY_MS = 60_000;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string };
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
// Retry-After header, OpenAI's rate-limit-reset headers, the human-readable
// hint in the error body, and only as a last resort, bounded exponential
// backoff with jitter.
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

// Required, no default -- fails immediately with a safe configuration
// error if unset (Chief Systems Architect Decision 1). Distinct from, and
// does not resolve, the pre-existing hardcoded EMBEDDING_MODEL constant in
// embedding.ts, which remains outside Phase 6's authority to change.
function getChatModel(): string {
  const model = process.env.OPENAI_CHAT_MODEL;

  if (!model) {
    throw new Error("AI response generation is not configured.");
  }

  return model;
}

// Combines the active Chatbot Configuration (name, welcome message,
// instructions) with the retrieved context chunks into a single system
// prompt, per technical_specification_v1.md's AI Integration section. The
// insufficient-context instruction is always included -- Option A (Chief
// Systems Architect Decision 5): the configured provider is always invoked,
// and insufficient-information behavior is achieved entirely through this
// instruction, never by an application-level shortcut that skips
// invocation.
function buildSystemPrompt(config: ChatbotConfiguration, contextBlock: string): string {
  const lines: string[] = [
    `You are ${config.name}, an AI assistant answering questions using only the knowledge base content provided below.`,
  ];

  if (config.instructions) {
    lines.push(config.instructions);
  }

  if (config.welcomeMessage) {
    lines.push(`Your usual welcome message to users is: "${config.welcomeMessage}"`);
  }

  lines.push(
    "If the provided context does not contain enough information to answer the question, say clearly that you do not have enough information to answer. Do not answer from general knowledge."
  );

  lines.push(`Context:\n${contextBlock}`);

  return lines.join("\n\n");
}

// Formats retrieved chunks as numbered reference material, ordered by
// similarity (descending). An empty array (no qualifying context) still
// produces a valid context block -- the model relies on the system
// prompt's instruction above to respond appropriately, per Option A.
function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "No relevant context was found for this question.";
  }

  return chunks
    .slice()
    .sort((a, b) => b.similarity - a.similarity)
    .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
    .join("\n\n");
}

async function callChatCompletion(
  systemPrompt: string,
  question: string,
  apiKey: string,
  model: string
): Promise<string> {
  let attempt = 0;

  for (;;) {
    const response = await fetch(CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      }),
    });

    if (response.ok) {
      const body = (await response.json()) as ChatCompletionResponse;
      const message = body.choices?.[0]?.message;

      if (!message) {
        throw new Error("Response generation returned a malformed completion.");
      }

      const content = message.content;

      if (typeof content !== "string" || content.length === 0) {
        throw new Error("Response generation returned no completion content.");
      }

      // A provider safety refusal is not distinguished from any other
      // completion here (Chief Systems Architect Decision 4) -- it is
      // returned to the caller unchanged, exactly like any other
      // successful response.
      return content;
    }

    if (response.status === 429) {
      attempt++;

      if (attempt > MAX_RETRIES) {
        throw new Error(`Response generation rate-limited after ${MAX_RETRIES} retries.`);
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

    // Any non-429, non-2xx response is not retried -- provider
    // authentication failure, token/context-window overflow, and any other
    // 4xx/5xx response all surface immediately as a safe, generic,
    // non-sensitive error (Chief Systems Architect Decision 4), never
    // exposing the API key, request body, or raw provider response. No
    // custom timeout is applied; the platform's own function execution
    // limit is relied upon instead.
    throw new Error(`Response generation failed (status ${response.status}).`);
  }
}

// Generates a response grounded in the supplied retrieved context, per the
// active Chatbot Configuration. Reads its own configuration internally,
// mirroring how retrieveRelevantChunks() (retrieval/retrieve.ts) reads its
// own retrieval configuration internally -- the caller supplies only the
// question and the already-computed retrieved context, never the
// configuration itself.
export async function generateResponse(
  question: string,
  retrievedChunks: RetrievedChunk[]
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI response generation is not configured.");
  }

  const model = getChatModel();
  const config = await getChatbotConfiguration();
  const contextBlock = buildContextBlock(retrievedChunks);
  const systemPrompt = buildSystemPrompt(config, contextBlock);

  return callChatCompletion(systemPrompt, question, apiKey, model);
}
