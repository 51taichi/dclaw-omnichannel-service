import assert from "node:assert/strict";
import test from "node:test";
import { buildDclawActivationRequest } from "../src/dclaw.js";

test("buildDclawActivationRequest creates a flow activation event", () => {
  const request = buildDclawActivationRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversationKey: "bot_1:private:张三",
    task: {
      id: 7,
      nodeId: "node_1",
      attemptNumber: 1,
      maxTimes: 2,
      messages: ["再提醒您一下", "看到后回我一句"],
      intervalMinutes: 30
    },
    flow: {
      currentNode: { id: "node_1", name: "邀约", goal: "邀约客户" },
      session: { currentNodeId: "node_1" }
    },
    recentMessages: [
      { direction: "outbound", senderName: "客服", content: "刚才给您发了邀请" }
    ]
  });

  assert.equal(request.metadata.eventType, "flow_activation_due");
  assert.equal(request.metadata.worktool.eventType, "flow_activation_due");
  assert.equal(request.external_session_id, "bot_1:private:张三");
  assert.match(request.message, /请结合当前会话上下文/);
  assert.match(request.message, /最终只输出一个 JSON 对象/);
  assert.match(request.message, /"reply":"发给客户的激活话术"/);
  assert.match(request.message, /再提醒您一下/);
});
