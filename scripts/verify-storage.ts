// Narrowly scoped deterministic verification for the Task 4C storage
// abstraction (src/lib/widget-client/storage.ts). No test framework is
// installed in this repository (Task 4A precedent); this script is run
// directly via `node scripts/verify-storage.ts`, relying on Node's
// built-in TypeScript type-stripping (see the "Node runtime portability"
// note at the bottom of this file). It exercises the module's real,
// exported behavior -- no reimplementation of its logic.
//
// Coverage: valid restoration, malformed/unsupported cache rejection,
// storage-unavailable fallback (no window, and a real read/write failure
// against the actual envelope key -- no probe key exists), late-failure
// disablement with call-count evidence, visitorSessionId
// persistence/reuse, visitorSessionId survival across a stale-conversation
// clear, restored-message UUID validation and de-duplication, the
// 100-message bound, the exact 262,144-byte UTF-8 bound, and
// single-oversized-message omission.

import assert from "node:assert/strict";
import {
  createWidgetStorage,
  boundTranscript,
  utf8ByteLength,
  MAX_TRANSCRIPT_MESSAGES,
  MAX_TRANSCRIPT_BYTES,
  SCHEMA_VERSION,
  type PersistedChatMessage,
} from "../src/lib/widget-client/storage.ts";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok   ${name}`);
}

// --- A real (non-mocked-away) localStorage backed by a Map, so tests
// exercise the module's actual read/write/JSON code paths. Optionally
// configurable to start throwing after a given call count, for
// late-failure verification (Codex finding C) -- storage.ts's own
// availability detection no longer writes any probe key (finding A), so
// these fakes are the only thing standing in for real, failing browser
// storage. ---
class FakeLocalStorage {
  private store = new Map<string, string>();
  private failGetItemAfter: number | null;
  private failSetItemAfter: number | null;
  getItemCalls = 0;
  setItemCalls = 0;
  removeItemCalls = 0;

  constructor(options: { failGetItemAfter?: number; failSetItemAfter?: number } = {}) {
    this.failGetItemAfter = options.failGetItemAfter ?? null;
    this.failSetItemAfter = options.failSetItemAfter ?? null;
  }

  getItem(key: string): string | null {
    this.getItemCalls += 1;
    if (this.failGetItemAfter !== null && this.getItemCalls > this.failGetItemAfter) {
      throw new Error("simulated getItem failure");
    }
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (this.failSetItemAfter !== null && this.setItemCalls > this.failSetItemAfter) {
      throw new Error("simulated setItem failure");
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.removeItemCalls += 1;
    this.store.delete(key);
  }

  setRaw(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function installFakeWindow(
  options?: ConstructorParameters<typeof FakeLocalStorage>[0]
): FakeLocalStorage {
  const fake = new FakeLocalStorage(options);
  (globalThis as Record<string, unknown>).window = { localStorage: fake };
  return fake;
}

function uninstallWindow(): void {
  delete (globalThis as Record<string, unknown>).window;
}

const CHATBOT_ID = "d4b00b03-e9d6-4421-a130-9cc95377b457";
const CONVO_A = "11111111-1111-4111-8111-111111111111";
const CONVO_B = "22222222-2222-4222-8222-222222222222";

// 1. No window at all -- Node's own runtime state, matching the actual
// server/build environment. Storage must report unavailable and every
// operation must be a safe no-op, never throwing.
check("createWidgetStorage() with no window is unavailable and inert", () => {
  uninstallWindow();
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.equal(storage.isAvailable(), false);
  assert.deepEqual(storage.load(), {
    visitorSessionId: null,
    conversationId: null,
    transcript: [],
  });
  storage.persistVisitorSessionId("should-not-throw");
  storage.persistConversationId(CONVO_A);
  storage.persistTranscript([
    { id: "77777777-7777-4777-8777-777777777777", role: "visitor", content: "hi" },
  ]);
  storage.clearConversationState();
});

// 2. A late getItem failure (Codex finding A/C): storage starts
// available, an initial operation succeeds, a later getItem throws, the
// controller becomes unavailable, and every subsequent read/write is
// inert -- with the underlying call counts proving no further real
// storage calls are attempted once disabled.
check("a later getItem failure disables the controller and further calls are inert", () => {
  const fake = installFakeWindow({ failGetItemAfter: 1 });
  const storage = createWidgetStorage(CHATBOT_ID);

  // Existence-only detection: available before any real operation.
  assert.equal(storage.isAvailable(), true);

  // First real operation succeeds (getItem call #1).
  assert.deepEqual(storage.load(), {
    visitorSessionId: null,
    conversationId: null,
    transcript: [],
  });
  assert.equal(fake.getItemCalls, 1);
  assert.equal(storage.isAvailable(), true);

  // Second real read (getItem call #2) throws -> disables.
  storage.persistVisitorSessionId("88888888-8888-4888-8888-888888888888");
  assert.equal(storage.isAvailable(), false);
  assert.equal(fake.getItemCalls, 2);
  assert.equal(fake.setItemCalls, 0);

  // Further operations are fully inert: no additional real calls.
  storage.persistConversationId(CONVO_A);
  storage.persistTranscript([]);
  storage.clearConversationState();
  assert.equal(storage.load().visitorSessionId, null);
  assert.equal(fake.getItemCalls, 2);
  assert.equal(fake.setItemCalls, 0);

  uninstallWindow();
});

// 3. A late setItem failure: storage starts available, an initial write
// succeeds, a later setItem throws, the controller becomes unavailable,
// and every subsequent read/write is inert.
check("a later setItem failure disables the controller and further calls are inert", () => {
  const fake = installFakeWindow({ failSetItemAfter: 1 });
  const storage = createWidgetStorage(CHATBOT_ID);

  assert.equal(storage.isAvailable(), true);

  // First write (setItem call #1) succeeds.
  const visitorSessionId = "99999999-9999-4999-8999-999999999999";
  storage.persistVisitorSessionId(visitorSessionId);
  assert.equal(storage.isAvailable(), true);
  assert.equal(fake.setItemCalls, 1);
  assert.equal(storage.load().visitorSessionId, visitorSessionId);

  // Second write (setItem call #2) throws -> disables.
  storage.persistConversationId(CONVO_A);
  assert.equal(storage.isAvailable(), false);
  assert.equal(fake.setItemCalls, 2);
  const getItemCallsAtDisable = fake.getItemCalls;

  // Further operations are fully inert: call counts stop increasing.
  storage.persistTranscript([]);
  storage.clearConversationState();
  void storage.load();
  assert.equal(fake.setItemCalls, 2);
  assert.equal(fake.getItemCalls, getItemCallsAtDisable);

  uninstallWindow();
});

// 4. Fresh visitorSessionId persistence, then reuse across a new
// controller instance sharing the same fake backing store (simulating a
// reload, which creates a brand-new storage controller in the real app).
check("visitorSessionId persists and is reused across reloads", () => {
  const fake = installFakeWindow();
  const first = createWidgetStorage(CHATBOT_ID);
  assert.equal(first.isAvailable(), true);
  assert.equal(first.load().visitorSessionId, null);

  const generated = "33333333-3333-4333-8333-333333333333";
  first.persistVisitorSessionId(generated);

  const second = createWidgetStorage(CHATBOT_ID);
  assert.equal(second.load().visitorSessionId, generated);
  void fake;
  uninstallWindow();
});

// 5. visitorSessionId survives clearConversationState(); conversationId
// and transcript are cleared.
check("clearConversationState preserves visitorSessionId only", () => {
  installFakeWindow();
  const storage = createWidgetStorage(CHATBOT_ID);
  const visitorSessionId = "44444444-4444-4444-8444-444444444444";
  const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  storage.persistVisitorSessionId(visitorSessionId);
  storage.persistConversationId(CONVO_A);
  storage.persistTranscript([{ id: messageId, role: "visitor", content: "hello" }]);

  assert.deepEqual(storage.load(), {
    visitorSessionId,
    conversationId: CONVO_A,
    transcript: [{ id: messageId, role: "visitor", content: "hello" }],
  });

  storage.clearConversationState();

  assert.deepEqual(storage.load(), {
    visitorSessionId,
    conversationId: null,
    transcript: [],
  });
  uninstallWindow();
});

// 6. Replacement continuation: persisting a new conversationId after a
// clear behaves like Section 3.A's replacement-creation step.
check("conversationId can be replaced after a clear", () => {
  installFakeWindow();
  const storage = createWidgetStorage(CHATBOT_ID);
  storage.persistVisitorSessionId("55555555-5555-4555-8555-555555555555");
  storage.persistConversationId(CONVO_A);
  storage.clearConversationState();
  storage.persistConversationId(CONVO_B);
  assert.equal(storage.load().conversationId, CONVO_B);
  uninstallWindow();
});

// 7. Malformed/tampered stored payloads are safely ignored, never
// thrown, and degrade to defaults -- per-field where the envelope itself
// is recognizable.
check("unparseable JSON is ignored, not thrown", () => {
  const fake = installFakeWindow();
  fake.setRaw(`ai-kb-widget-state:${CHATBOT_ID}`, "{not valid json");
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load(), {
    visitorSessionId: null,
    conversationId: null,
    transcript: [],
  });
  uninstallWindow();
});

check("wrong schemaVersion is treated as entirely absent", () => {
  const fake = installFakeWindow();
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 1,
      visitorSessionId: CONVO_A,
      conversationId: CONVO_B,
      transcript: [],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load(), {
    visitorSessionId: null,
    conversationId: null,
    transcript: [],
  });
  uninstallWindow();
});

check("non-UUID conversationId is dropped but a valid visitorSessionId survives", () => {
  const fake = installFakeWindow();
  const validVisitor = "66666666-6666-4666-8666-666666666666";
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: validVisitor,
      conversationId: "<script>not-a-uuid</script>",
      transcript: [],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load(), {
    visitorSessionId: validVisitor,
    conversationId: null,
    transcript: [],
  });
  uninstallWindow();
});

check("a transcript entry with an invalid role is dropped, valid entries kept", () => {
  const fake = installFakeWindow();
  const idKept1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const idDropped = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const idKept2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript: [
        { id: idKept1, role: "visitor", content: "kept" },
        { id: idDropped, role: "system-prompt-injection", content: "dropped" },
        { id: idKept2, role: "assistant", content: "kept" },
      ],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, [
    { id: idKept1, role: "visitor", content: "kept" },
    { id: idKept2, role: "assistant", content: "kept" },
  ]);
  uninstallWindow();
});

// 8. Restored message id validation (Codex finding B): a non-empty
// arbitrary string is not sufficient -- ids must be valid UUIDs, and
// duplicate ids within one transcript keep only the first occurrence,
// never regenerating or rewriting an id.

check("a message with a non-UUID id is rejected on restoration", () => {
  const fake = installFakeWindow();
  const validId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript: [
        { id: "not-a-uuid", role: "visitor", content: "rejected" },
        { id: validId, role: "assistant", content: "kept" },
      ],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, [
    { id: validId, role: "assistant", content: "kept" },
  ]);
  uninstallWindow();
});

check("a duplicate valid UUID id retains only the first occurrence", () => {
  const fake = installFakeWindow();
  const dupeId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript: [
        { id: dupeId, role: "visitor", content: "first (kept)" },
        { id: dupeId, role: "assistant", content: "duplicate (discarded)" },
      ],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, [
    { id: dupeId, role: "visitor", content: "first (kept)" },
  ]);
  uninstallWindow();
});

check("valid unique UUID messages restore exactly as stored", () => {
  const fake = installFakeWindow();
  const idOne = "10101010-1010-4010-8010-101010101010";
  const idTwo = "20202020-2020-4020-8020-202020202020";
  const transcript: PersistedChatMessage[] = [
    { id: idOne, role: "visitor", content: "one" },
    { id: idTwo, role: "assistant", content: "two" },
  ];
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript,
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, transcript);
  uninstallWindow();
});

check("invalid and duplicate entries do not cause valid unique entries to be lost", () => {
  const fake = installFakeWindow();
  const idValid1 = "30303030-3030-4030-8030-303030303030";
  const idValid2 = "40404040-4040-4040-8040-404040404040";
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript: [
        { id: idValid1, role: "visitor", content: "valid, kept" },
        { id: "also-not-a-uuid", role: "visitor", content: "invalid, dropped" },
        { id: idValid1, role: "assistant", content: "duplicate of first, dropped" },
        { id: idValid2, role: "assistant", content: "valid, kept" },
        { id: idValid2, role: "assistant", content: "duplicate of fourth, dropped" },
      ],
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, [
    { id: idValid1, role: "visitor", content: "valid, kept" },
    { id: idValid2, role: "assistant", content: "valid, kept" },
  ]);
  uninstallWindow();
});

check("a transcript exceeding the message-count bound is discarded entirely", () => {
  const fake = installFakeWindow();
  const tooMany: PersistedChatMessage[] = Array.from(
    { length: MAX_TRANSCRIPT_MESSAGES + 1 },
    () => ({ id: crypto.randomUUID(), role: "visitor", content: "x" })
  );
  fake.setRaw(
    `ai-kb-widget-state:${CHATBOT_ID}`,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      visitorSessionId: null,
      conversationId: null,
      transcript: tooMany,
    })
  );
  const storage = createWidgetStorage(CHATBOT_ID);
  assert.deepEqual(storage.load().transcript, []);
  uninstallWindow();
});

// 9. Transcript bounding (Section 13.2 / part C of the implementation
// requirements): exactly 100 newest messages retained, oldest-first
// trimming down to <= 262,144 UTF-8 bytes, and single-message omission
// when even one message cannot fit. boundTranscript() is a pure,
// write-side trimming function -- it does not validate id format (that
// is validateTranscript's read-side responsibility, exercised above) --
// so these fixtures use simple sequential ids to make trim-order
// assertions easy to read.

check("utf8ByteLength measures UTF-8 bytes, not UTF-16 string length", () => {
  // U+1F600 (grinning face) is 1 UTF-16 code unit pair (length 2 in JS)
  // but 4 UTF-8 bytes -- a deterministic case where the two disagree.
  const emoji = "\u{1F600}";
  assert.equal(emoji.length, 2);
  assert.equal(utf8ByteLength(emoji), 4);
});

check("boundTranscript retains no more than the newest 100 messages", () => {
  const messages: PersistedChatMessage[] = Array.from({ length: 150 }, (_, i) => ({
    id: String(i),
    role: i % 2 === 0 ? "visitor" : "assistant",
    content: "short",
  }));
  const bounded = boundTranscript(messages);
  assert.equal(bounded.length, MAX_TRANSCRIPT_MESSAGES);
  assert.equal(bounded[0]!.id, "50");
  assert.equal(bounded[bounded.length - 1]!.id, "149");
});

check("boundTranscript trims oldest messages until <= 262,144 bytes", () => {
  const bigContent = "x".repeat(10_000);
  const messages: PersistedChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    role: "visitor",
    content: bigContent,
  }));
  // 40 * ~10,000+ bytes of JSON overhead is well over 262,144 bytes.
  const serializedBefore = utf8ByteLength(JSON.stringify(messages));
  assert.ok(serializedBefore > MAX_TRANSCRIPT_BYTES);

  const bounded = boundTranscript(messages);
  const serializedAfter = utf8ByteLength(JSON.stringify(bounded));
  assert.ok(serializedAfter <= MAX_TRANSCRIPT_BYTES);
  assert.ok(bounded.length < messages.length);
  // Oldest removed first: whatever remains must be a suffix (newest ids).
  assert.equal(bounded[bounded.length - 1]!.id, "39");
});

check("boundTranscript omits a single message that cannot fit alone", () => {
  const oneEnormousMessage: PersistedChatMessage[] = [
    { id: "only", role: "visitor", content: "y".repeat(MAX_TRANSCRIPT_BYTES + 1000) },
  ];
  const bounded = boundTranscript(oneEnormousMessage);
  assert.deepEqual(bounded, []);
});

check("persistTranscript applies the same bound before writing", () => {
  installFakeWindow();
  const storage = createWidgetStorage(CHATBOT_ID);
  // Valid UUIDs here (unlike the pure boundTranscript() fixtures above):
  // this round-trips through storage.load(), which validates restored
  // message ids (Codex finding B) -- non-UUID ids would be rejected on
  // read and would falsely appear to satisfy the count bound.
  const messages: PersistedChatMessage[] = Array.from({ length: 150 }, () => ({
    id: crypto.randomUUID(),
    role: "visitor",
    content: "short",
  }));
  storage.persistTranscript(messages);
  const loaded = storage.load().transcript;
  assert.equal(loaded.length, MAX_TRANSCRIPT_MESSAGES);
  assert.deepEqual(loaded, messages.slice(-MAX_TRANSCRIPT_MESSAGES));
  uninstallWindow();
});

console.log(`\n${passed} storage verification checks passed.`);

// --- Node runtime portability -----------------------------------------
// This script (and scripts/verify-api-classification.ts,
// scripts/verify-message-lifecycle.ts) is executed directly via
// `node scripts/<name>.ts`, relying on Node's built-in TypeScript
// type-stripping (no ts-node, no build step, no test framework). It was
// verified under this repository's current Node runtime: v24.14.1
// (see `node --version` in the Task 4C verification report). Running it
// requires a Node version that supports this exact direct-.ts-execution
// and explicit-extension-import model; no `engines` range is declared in
// package.json for this, since only v24.14.1 has been verified end to
// end against this exact script set -- declaring a broader range without
// verifying every version in it would be an unverified claim.
