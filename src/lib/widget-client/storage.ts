// Client-only persisted-state storage abstraction for the Public Chat
// Widget (Phase 7, Increment 3, Task 4C; AD-022, AD-029, ADR Decision
// 006's client-side portion). Owns everything about *how* state is
// stored: chatbot-scoped key construction, envelope serialization and
// parsing, schema-version and shape validation, UUID/role/string
// validation, transcript bounding, read/write/clear mechanics, and
// detection of (and graceful degradation from) unavailable storage.
// It does not decide *when* values are hydrated, persisted, cleared, or
// replaced -- that policy belongs to widget-app.tsx. It also does not
// determine server-side conversation validity: a restored
// conversationId is returned as-is, never asserted to still be active.
//
// One chatbot-scoped localStorage entry holds one coherent versioned
// envelope for all four logical fields (schemaVersion, visitorSessionId,
// conversationId, transcript) -- not independent raw keys -- so a single
// write is what changes the persisted state, reducing partial-write
// inconsistency between fields that must otherwise stay in sync.
//
// All values read back from storage are treated as untrusted input:
// malformed or unsupported stored content is ignored or cleared,
// per-field where feasible, rather than crashing or being trusted.

export type PersistedChatMessage = {
  id: string;
  role: "visitor" | "assistant";
  content: string;
};

export type WidgetPersistedState = {
  visitorSessionId: string | null;
  conversationId: string | null;
  transcript: PersistedChatMessage[];
};

// eslint-disable no-unused-vars for the interface method parameter names
// below: they exist solely to document this contract and are not
// bindings the base (non-type-aware) no-unused-vars rule can recognize
// as declarations rather than usages.
/* eslint-disable no-unused-vars */
export interface WidgetStorage {
  isAvailable(): boolean;
  load(): WidgetPersistedState;
  // Persists the visitor session UUID.
  persistVisitorSessionId(visitorSessionId: string): void;
  // Persists the server-owned conversation id, or null to clear it.
  persistConversationId(conversationId: string | null): void;
  // Bounds (Section 13.2) then persists the transcript.
  persistTranscript(transcript: PersistedChatMessage[]): void;
  clearConversationState(): void;
}
/* eslint-enable no-unused-vars */

export const SCHEMA_VERSION = 1;
export const MAX_TRANSCRIPT_MESSAGES = 100;
// 256 KiB, defined precisely as 262,144 bytes -- not an approximation.
export const MAX_TRANSCRIPT_BYTES = 262144;

const STORAGE_KEY_PREFIX = "ai-kb-widget-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PersistedEnvelope = {
  schemaVersion: number;
  visitorSessionId: string | null;
  conversationId: string | null;
  transcript: PersistedChatMessage[];
};

function buildStorageKey(publicChatbotIdentifier: string): string {
  return `${STORAGE_KEY_PREFIX}:${publicChatbotIdentifier}`;
}

// Deterministic UTF-8 byte length -- deliberately not JavaScript string
// .length (UTF-16 code unit count), which does not reflect serialized
// byte size.
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validateUuidOrNull(value: unknown): string | null {
  return isValidUuid(value) ? value : null;
}

function validatePersistedMessage(value: unknown): PersistedChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, role, content } = value;

  // Same UUID-validation discipline as visitorSessionId/conversationId --
  // a non-empty arbitrary string is not sufficient for a message id.
  if (!isValidUuid(id)) {
    return null;
  }

  if (role !== "visitor" && role !== "assistant") {
    return null;
  }

  if (typeof content !== "string") {
    return null;
  }

  return { id, role, content };
}

// Per-message shape/UUID validation first (dropping only invalid
// entries), then de-duplication by id -- retaining the first valid
// occurrence and discarding later entries that duplicate an
// already-accepted id, never regenerating or rewriting an id -- then a
// whole-transcript bounds check against the same limits enforced on
// write. A transcript that still exceeds either bound after filtering is
// treated as tampered and discarded to an empty transcript, rather than
// partially trusted.
function validateTranscript(value: unknown): PersistedChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const validated: PersistedChatMessage[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    const message = validatePersistedMessage(item);

    if (!message || seenIds.has(message.id)) {
      continue;
    }

    seenIds.add(message.id);
    validated.push(message);
  }

  if (validated.length > MAX_TRANSCRIPT_MESSAGES) {
    return [];
  }

  if (utf8ByteLength(JSON.stringify(validated)) > MAX_TRANSCRIPT_BYTES) {
    return [];
  }

  return validated;
}

// Parses and validates a raw stored envelope. An unparseable payload, a
// non-object payload, or a schemaVersion mismatch is treated as entirely
// absent (defaults are used) rather than partially recovered -- schema
// migration is out of this slice's scope. Once the envelope itself is
// recognized, each field is validated independently so one corrupted
// field (e.g. a tampered conversationId) does not discard the others
// (e.g. a still-valid visitorSessionId).
function parseEnvelope(raw: string): PersistedEnvelope | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION) {
    return null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    visitorSessionId: validateUuidOrNull(parsed.visitorSessionId),
    conversationId: validateUuidOrNull(parsed.conversationId),
    transcript: validateTranscript(parsed.transcript),
  };
}

// Bounds a transcript for persistence: retain no more than the newest
// 100 messages, then drop oldest messages until the JSON-serialized
// UTF-8 byte size is at or below MAX_TRANSCRIPT_BYTES. If even the
// single newest message cannot fit, it is dropped too -- an empty
// persisted transcript, never a thrown error or a blocked send.
export function boundTranscript(messages: PersistedChatMessage[]): PersistedChatMessage[] {
  let bounded = messages.slice(-MAX_TRANSCRIPT_MESSAGES);

  while (bounded.length > 0 && utf8ByteLength(JSON.stringify(bounded)) > MAX_TRANSCRIPT_BYTES) {
    bounded = bounded.slice(1);
  }

  return bounded;
}

// Existence-only check -- no probe key is written or removed. Task 4C
// permits exactly one chatbot-scoped localStorage entry (the real
// envelope); availability is otherwise determined lazily, the first time
// a guarded read or write against that real entry actually throws (see
// readEnvelope/writeEnvelope below).
function detectAvailability(): boolean {
  return typeof window !== "undefined" && "localStorage" in window;
}

const EMPTY_ENVELOPE: PersistedEnvelope = {
  schemaVersion: SCHEMA_VERSION,
  visitorSessionId: null,
  conversationId: null,
  transcript: [],
};

// Creates one storage controller scoped to a single mounted widget
// instance for the given chatbot. If storage is found unavailable --
// at creation, or on any later read/write failure -- further
// persistence attempts are disabled for the remaining lifetime of this
// instance rather than repeatedly throwing or retrying.
export function createWidgetStorage(publicChatbotIdentifier: string): WidgetStorage {
  let available = detectAvailability();
  const key = buildStorageKey(publicChatbotIdentifier);

  function disable(): void {
    available = false;
  }

  function readEnvelope(): PersistedEnvelope | null {
    if (!available) {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : parseEnvelope(raw);
    } catch {
      disable();
      return null;
    }
  }

  function writeEnvelope(envelope: PersistedEnvelope): void {
    if (!available) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(envelope));
    } catch {
      disable();
    }
  }

  function currentOrDefault(): PersistedEnvelope {
    return readEnvelope() ?? EMPTY_ENVELOPE;
  }

  return {
    isAvailable: () => available,

    load: () => {
      const envelope = currentOrDefault();
      return {
        visitorSessionId: envelope.visitorSessionId,
        conversationId: envelope.conversationId,
        transcript: envelope.transcript,
      };
    },

    persistVisitorSessionId: (visitorSessionId) => {
      const envelope = currentOrDefault();
      writeEnvelope({ ...envelope, visitorSessionId });
    },

    persistConversationId: (conversationId) => {
      const envelope = currentOrDefault();
      writeEnvelope({ ...envelope, conversationId });
    },

    persistTranscript: (transcript) => {
      const envelope = currentOrDefault();
      writeEnvelope({ ...envelope, transcript: boundTranscript(transcript) });
    },

    clearConversationState: () => {
      const envelope = currentOrDefault();
      writeEnvelope({ ...envelope, conversationId: null, transcript: [] });
    },
  };
}
