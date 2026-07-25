import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyHistoryContext,
  createKeyedSingleFlight,
  isLegacyCustomerCandidate
} from "../src/legacy-history.js";

test("only a first ordinary private message is a legacy candidate", () => {
  const base = {
    binding: { enabled: true },
    hadConversation: false,
    hadFlowSession: false
  };
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 2, textType: 1, spoken: "在吗" }
  }), true);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 2, textType: 1, spoken: "我已经添加了你，现在我们可以开始聊天了" }
  }), false);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 1, textType: 1, spoken: "在吗" }
  }), false);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    hadConversation: true,
    message: { roomType: 2, textType: 1, spoken: "在吗" }
  }), false);
});

test("single flight shares one task and releases it after completion", async () => {
  const flight = createKeyedSingleFlight();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const task = async () => {
    calls += 1;
    await pending;
    return { status: "success" };
  };
  const first = flight.run("conversation", task);
  const second = flight.run("conversation", task);
  assert.equal(calls, 1);
  assert.equal(flight.has("conversation"), true);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(flight.has("conversation"), false);
  await flight.run("conversation", task);
  assert.equal(calls, 2);
});

test("bounded context prioritizes customer history and recent local messages", () => {
  const context = buildLegacyHistoryContext({
    customerMessages: [
      { direction: "inbound", content: "客户旧问题", createdAt: "2026-07-10T03:00:00.000Z", source: "worktool_customer_history" },
      { direction: "inbound", content: "客户最新问题", createdAt: "2026-07-17T17:00:00.000Z", source: "worktool_customer_history" }
    ],
    localMessages: [
      { direction: "outbound", content: "最近回复", createdAt: "2026-07-17T17:01:00.000Z", source: "local" }
    ],
    cachedApiMessages: Array.from({ length: 5 }, (_, index) => ({
      direction: "outbound",
      content: `旧发送${index}`,
      createdAt: `2026-07-01T00:0${index}:00.000Z`,
      source: "worktool_api_history"
    })),
    maxMessages: 3,
    maxChars: 10_000
  });

  assert.deepEqual(context.messages.map((item) => item.content), [
    "客户旧问题",
    "客户最新问题",
    "最近回复"
  ]);
  assert.equal(context.importedCustomerCount, 2);
  assert.equal(context.truncated, true);
});

test("bounded context deduplicates matching direction time and content", () => {
  const duplicate = {
    direction: "inbound",
    content: "同一条",
    createdAt: "2026-07-10T03:00:00.000Z"
  };
  const context = buildLegacyHistoryContext({
    customerMessages: [duplicate],
    localMessages: [duplicate],
    cachedApiMessages: [],
    maxMessages: 10,
    maxChars: 100
  });
  assert.equal(context.messages.length, 1);
  assert.equal(context.truncated, false);
});
