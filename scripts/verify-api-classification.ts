// Narrowly scoped deterministic verification that
// src/lib/widget-client/api.ts classifies the Messages resource's real,
// already-shipped rejection contract
// (404 { error: "conversation_not_found_or_expired" }, from
// src/app/api/v1/conversations/[id]/messages/route.ts) as the new
// "conversation_expired" ApiErrorKind, and that other responses keep
// their existing classification. This exercises sendMessage() itself
// (transport + classification together) against a mocked global fetch --
// no reimplementation of the classifier's internal logic.

import assert from "node:assert/strict";
import { sendMessage } from "../src/lib/widget-client/api.ts";

let passed = 0;

function check(name: string, fn: () => Promise<void> | void): Promise<void> | void {
  const finish = () => {
    passed += 1;
    console.log(`ok   ${name}`);
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.then(finish);
  }
  finish();
}

function mockFetchOnce(status: number, body: unknown): void {
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

async function main() {
  await check(
    "the real missing-or-expired rejection classifies as conversation_expired",
    async () => {
      mockFetchOnce(404, { error: "conversation_not_found_or_expired" });
      const result = await sendMessage("some-conversation-id", "hello", "some-chatbot-id");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.kind, "conversation_expired");
      }
    }
  );

  await check("an unrelated 404 does not classify as conversation_expired", async () => {
    mockFetchOnce(404, { error: "not_found" });
    const result = await sendMessage("some-conversation-id", "hello", "some-chatbot-id");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "unknown_error");
    }
  });

  await check("a 429 still classifies as rate_limited (unaffected by this change)", async () => {
    mockFetchOnce(429, { error: "rate_limited" });
    const result = await sendMessage("some-conversation-id", "hello", "some-chatbot-id");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "rate_limited");
    }
  });

  await check("a successful response still parses normally (unaffected)", async () => {
    mockFetchOnce(200, { answer: "a real answer" });
    const result = await sendMessage("some-conversation-id", "hello", "some-chatbot-id");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.answer, "a real answer");
    }
  });

  console.log(`\n${passed} API classification verification checks passed.`);
}

await main();
