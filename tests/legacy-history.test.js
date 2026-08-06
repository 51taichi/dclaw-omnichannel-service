import assert from "node:assert/strict";
import test from "node:test";
import {
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
    message: { roomType: 2, textType: 1, spoken: "hello", metadata: { provider: "whapi" } }
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
