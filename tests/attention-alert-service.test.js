import assert from "node:assert/strict";
import test from "node:test";

import { applyAgentAttentionAlert } from "../src/attention-alert-service.js";

const context = {
  botId: "bot-1",
  binding: { agentId: "agent-1" },
  conversationKey: "bot-1:private:Ada",
  conversationEpoch: "epoch-1",
  customerName: "Ada",
  evidenceCandidates: [{ id: "41", conversationMessageId: 41, text: "可以寄到德国吗？" }]
};

test("disabled attention decisions do not write", () => {
  let calls = 0;
  const result = applyAgentAttentionAlert({
    ...context,
    agentReply: { attentionAlert: { required: false } },
    recordOccurrence: () => { calls += 1; }
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("required attention decisions write one trusted occurrence", () => {
  let input;
  const expected = { alert: { id: 7 }, created: true, duplicate: false };
  const result = applyAgentAttentionAlert({
    ...context,
    agentReply: { attentionAlert: {
      required: true,
      reason: "需要人工确认",
      evidenceMessageId: "41",
      evidenceText: "可以寄到德国吗？"
    } },
    recordOccurrence: (value) => { input = value; return expected; }
  });
  assert.equal(result, expected);
  assert.deepEqual(input, {
    botId: "bot-1",
    agentId: "agent-1",
    conversationKey: "bot-1:private:Ada",
    conversationEpoch: "epoch-1",
    customerName: "Ada",
    reason: "需要人工确认",
    evidenceMessageId: 41,
    evidenceText: "可以寄到德国吗？"
  });
});

test("service rejects evidence absent from the current customer candidates", () => {
  assert.throws(() => applyAgentAttentionAlert({
    ...context,
    agentReply: { attentionAlert: {
      required: true,
      reason: "需要确认",
      evidenceMessageId: "99",
      evidenceText: "伪造"
    } },
    recordOccurrence: () => assert.fail("must not write")
  }), /evidence/i);
});
