import assert from "node:assert/strict";
import test from "node:test";
import { createConversationResetWorker } from "../src/conversation-reset-worker.js";

test("worker completes a claimed reset task after ordered DClaw cleanup", async () => {
  const events = [];
  const task = {
    id: 7,
    botId: "bot_a",
    agentId: "agent_a",
    conversationKey: "bot_a:private:张三",
    attemptNumber: 1
  };
  let available = true;
  const worker = createConversationResetWorker({
    claimTask: () => {
      if (!available) return null;
      available = false;
      return task;
    },
    getBinding: () => ({ botId: "bot_a", agentId: "agent_a", enabled: true }),
    syncTask: async () => {
      events.push("workspace_then_memory");
      return { status: "synced" };
    },
    completeTask: ({ id }) => events.push(`complete:${id}`),
    failTask: () => assert.fail("successful reset must not fail")
  });

  await worker.runOnce();

  assert.deepEqual(events, ["workspace_then_memory", "complete:7"]);
});

test("worker persists retry state without rejecting the scheduler", async () => {
  const events = [];
  let available = true;
  const worker = createConversationResetWorker({
    claimTask: () => {
      if (!available) return null;
      available = false;
      return {
        id: 8,
        botId: "bot_a",
        agentId: "agent_a",
        conversationKey: "bot_a:private:李四",
        attemptNumber: 1
      };
    },
    getBinding: () => ({ botId: "bot_a", agentId: "agent_a", enabled: true }),
    syncTask: async () => ({ status: "pending", error: "timeout" }),
    completeTask: () => assert.fail("failed reset must not complete"),
    failTask: (input) => events.push(input)
  });

  await worker.runOnce();

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 8);
  assert.match(events[0].error, /timeout/);
});
