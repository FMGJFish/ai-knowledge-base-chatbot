// Narrowly scoped deterministic verification of the extracted production
// bounded send/recovery orchestration
// (src/lib/widget-client/message-lifecycle.ts). This calls the real,
// exported runConversationContinuationLifecycle -- the exact function
// widget-app.tsx invokes -- with fake sendMessage/createConversation
// dependencies substituted via the module's own dependency-injection
// seam (MessageLifecycleDeps). No algorithm is reimplemented here: only
// the injected network calls are faked, never the orchestration logic
// itself.
//
// Run via `node scripts/verify-message-lifecycle.ts` (Node's built-in
// TypeScript type-stripping; see the portability note in
// scripts/verify-storage.ts).

import assert from "node:assert/strict";
import {
  runConversationContinuationLifecycle,
  type MessageLifecycleDeps,
} from "../src/lib/widget-client/message-lifecycle.ts";
import type { ApiResult } from "../src/lib/widget-client/api.ts";

let passed = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`ok   ${name}`);
}

const VISITOR_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CHATBOT_ID = "d4b00b03-e9d6-4421-a130-9cc95377b457";
const EXISTING_CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT_CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const PENDING_CONTENT = "the exact immutable pending message";

// A call-counting fake of the two injected dependencies. Each fake
// returns a queued result per call, so a test can script exactly what
// the "server" does on each successive invocation.
function makeFakeDeps(options: {
  sendMessageResults: ApiResult<{ answer: string }>[];
  createConversationResults?: ApiResult<{ conversationId: string }>[];
}) {
  let sendMessageCallIndex = 0;
  let createConversationCallIndex = 0;
  const sendMessageCalls: Array<{ conversationId: string; content: string }> = [];
  const createConversationCalls: Array<{ visitorSessionId: string }> = [];
  let staleConversationDetectedCalls = 0;

  const deps: MessageLifecycleDeps = {
    sendMessage: async (conversationId, content) => {
      sendMessageCalls.push({ conversationId, content });
      const result = options.sendMessageResults[sendMessageCallIndex];
      sendMessageCallIndex += 1;
      if (!result) {
        throw new Error("test misconfiguration: no queued sendMessage result");
      }
      return result;
    },
    createConversation: async (visitorSessionId) => {
      createConversationCalls.push({ visitorSessionId });
      const result = options.createConversationResults?.[createConversationCallIndex];
      createConversationCallIndex += 1;
      if (!result) {
        throw new Error("test misconfiguration: no queued createConversation result");
      }
      return result;
    },
    onStaleConversationDetected: () => {
      staleConversationDetectedCalls += 1;
    },
  };

  return {
    deps,
    sendMessageCalls,
    createConversationCalls,
    get staleConversationDetectedCalls() {
      return staleConversationDetectedCalls;
    },
  };
}

async function main() {
  // 1. Existing conversation succeeds: one send, no replacement
  // creation, no resubmission.
  await check("existing conversation succeeds with exactly one send", async () => {
    const fake = makeFakeDeps({
      sendMessageResults: [{ ok: true, data: { answer: "a real answer" } }],
    });

    const result = await runConversationContinuationLifecycle(
      {
        conversationId: EXISTING_CONVERSATION_ID,
        visitorSessionId: VISITOR_SESSION_ID,
        publicChatbotIdentifier: CHATBOT_ID,
        content: PENDING_CONTENT,
      },
      fake.deps
    );

    assert.deepEqual(result, {
      ok: true,
      conversationId: EXISTING_CONVERSATION_ID,
      answer: "a real answer",
      recovered: false,
    });
    assert.equal(fake.sendMessageCalls.length, 1);
    assert.equal(fake.createConversationCalls.length, 0);
    assert.equal(fake.staleConversationDetectedCalls, 0);
  });

  // 2. Initial send returns typed conversation_expired: stale-clear
  // callback exactly once, replacement creation exactly once, exact
  // immutable pending content resubmitted exactly once, no repeated
  // recovery.
  await check(
    "conversation_expired triggers exactly one clear, one replacement, one resubmission",
    async () => {
      const fake = makeFakeDeps({
        sendMessageResults: [
          { ok: false, kind: "conversation_expired" },
          { ok: true, data: { answer: "answer after recovery" } },
        ],
        createConversationResults: [
          { ok: true, data: { conversationId: REPLACEMENT_CONVERSATION_ID } },
        ],
      });

      const result = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fake.deps
      );

      assert.deepEqual(result, {
        ok: true,
        conversationId: REPLACEMENT_CONVERSATION_ID,
        answer: "answer after recovery",
        recovered: true,
      });
      assert.equal(fake.staleConversationDetectedCalls, 1);
      assert.equal(fake.createConversationCalls.length, 1);
      assert.equal(fake.sendMessageCalls.length, 2);
      // Both the initial attempt and the resubmission carry the exact
      // same immutable pending content -- never re-derived.
      assert.equal(fake.sendMessageCalls[0]!.content, PENDING_CONTENT);
      assert.equal(fake.sendMessageCalls[1]!.content, PENDING_CONTENT);
      assert.equal(fake.sendMessageCalls[0]!.conversationId, EXISTING_CONVERSATION_ID);
      assert.equal(fake.sendMessageCalls[1]!.conversationId, REPLACEMENT_CONVERSATION_ID);
    }
  );

  // 3. Replacement creation fails: no resubmission occurs, lifecycle
  // terminates with failure, no repeated create, and -- since no
  // replacement conversation was ever created -- no replacement
  // conversationId is propagated.
  await check(
    "replacement-creation failure terminates without resubmission and with no replacement conversationId",
    async () => {
      const fake = makeFakeDeps({
        sendMessageResults: [{ ok: false, kind: "conversation_expired" }],
        createConversationResults: [{ ok: false, kind: "rate_limited" }],
      });

      const result = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fake.deps
      );

      assert.deepEqual(result, {
        ok: false,
        kind: "rate_limited",
        recoveredConversationId: null,
      });
      assert.equal(fake.staleConversationDetectedCalls, 1);
      assert.equal(fake.createConversationCalls.length, 1);
      // Only the initial send -- no resubmission was ever attempted.
      assert.equal(fake.sendMessageCalls.length, 1);
    }
  );

  // 4. Replacement resubmission fails: the blocking defect this
  // correction fixes. Replacement creation genuinely succeeded
  // server-side, so its conversationId must be propagated on the
  // terminal failure result even though the overall attempt still
  // fails -- otherwise a real, persisted conversation would be silently
  // lost and the next retry would create yet another one unnecessarily.
  await check(
    "resubmission failure propagates the successfully created replacement conversationId, with no second recovery cycle",
    async () => {
      const fake = makeFakeDeps({
        sendMessageResults: [
          { ok: false, kind: "conversation_expired" },
          { ok: false, kind: "network_error" },
        ],
        createConversationResults: [
          { ok: true, data: { conversationId: REPLACEMENT_CONVERSATION_ID } },
        ],
      });

      const result = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fake.deps
      );

      // 1. initial send occurred once, against the original conversation.
      assert.equal(fake.sendMessageCalls[0]!.conversationId, EXISTING_CONVERSATION_ID);
      // 2. stale callback occurred exactly once.
      assert.equal(fake.staleConversationDetectedCalls, 1);
      // 3. replacement creation occurred exactly once.
      assert.equal(fake.createConversationCalls.length, 1);
      // 4. resubmission occurred exactly once, against the replacement.
      assert.equal(fake.sendMessageCalls.length, 2);
      assert.equal(fake.sendMessageCalls[1]!.conversationId, REPLACEMENT_CONVERSATION_ID);
      assert.equal(fake.sendMessageCalls[1]!.content, PENDING_CONTENT);
      // 5. no second creation or send: counts above are exact totals,
      // not lower bounds -- a second attempt would have raised them.
      // 6 & 7. terminal result carries the resubmission error kind AND
      // the exact replacement conversationId createConversation
      // returned -- both required, not one at the expense of the other.
      // 8. recoveredConversationId being non-null is itself the
      // explicit indication that replacement creation/recovery
      // occurred, since it is null in every other failure case
      // (verified by checks 3 and 5).
      assert.deepEqual(result, {
        ok: false,
        kind: "network_error",
        recoveredConversationId: REPLACEMENT_CONVERSATION_ID,
      });
    }
  );

  // 5. An unrelated initial-send error: no stale clear, no replacement
  // creation, no resubmission, and no replacement conversationId (none
  // was ever created).
  await check(
    "an unrelated initial-send error short-circuits with no recovery and no replacement conversationId",
    async () => {
      const fake = makeFakeDeps({
        sendMessageResults: [{ ok: false, kind: "rate_limited" }],
      });

      const result = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fake.deps
      );

      assert.deepEqual(result, {
        ok: false,
        kind: "rate_limited",
        recoveredConversationId: null,
      });
      assert.equal(fake.staleConversationDetectedCalls, 0);
      assert.equal(fake.createConversationCalls.length, 0);
      assert.equal(fake.sendMessageCalls.length, 1);
    }
  );

  // 6. The expiry-success result's `recovered: true` flag is what tells
  // WidgetApp to build the transcript from an explicit empty base --
  // this is the exact mechanism preserving the already-fixed
  // stale-closure correction (widget-app.tsx builds `[]` when
  // `recovered` is true, never the pre-expiry `messages` state).
  await check(
    "the expiry-success result signals recovered:true so callers use an empty transcript base",
    async () => {
      const fake = makeFakeDeps({
        sendMessageResults: [
          { ok: false, kind: "conversation_expired" },
          { ok: true, data: { answer: "fresh answer" } },
        ],
        createConversationResults: [
          { ok: true, data: { conversationId: REPLACEMENT_CONVERSATION_ID } },
        ],
      });

      const result = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fake.deps
      );

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.recovered, true);
      }

      // Contrast: the non-recovered success path signals recovered:false,
      // so a caller building `recovered ? [] : messages` never discards
      // history when no expiry occurred.
      const fakeNoRecovery = makeFakeDeps({
        sendMessageResults: [{ ok: true, data: { answer: "no recovery needed" } }],
      });
      const resultNoRecovery = await runConversationContinuationLifecycle(
        {
          conversationId: EXISTING_CONVERSATION_ID,
          visitorSessionId: VISITOR_SESSION_ID,
          publicChatbotIdentifier: CHATBOT_ID,
          content: PENDING_CONTENT,
        },
        fakeNoRecovery.deps
      );
      assert.equal(resultNoRecovery.ok, true);
      if (resultNoRecovery.ok) {
        assert.equal(resultNoRecovery.recovered, false);
      }
    }
  );

  console.log(`\n${passed} message-lifecycle verification checks passed.`);
}

await main();
