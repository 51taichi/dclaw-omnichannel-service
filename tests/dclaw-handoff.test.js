import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDclawConversationMemoryClearRequest,
  buildDclawConversationResetRequest,
  buildDclawHandoffTranscriptRequest,
  parseConversationMemoryClearAcknowledgement,
  parseConversationResetAcknowledgement
} from "../src/dclaw.js";

test("buildDclawHandoffTranscriptRequest creates a sync-only handoff event", () => {
  const request = buildDclawHandoffTranscriptRequest({
    binding: {
      botId: "bot_1",
      agentId: "agent_1"
    },
    conversation: {
      conversationKey: "bot_1:private:张三"
    },
    message: {
      messageId: "msg_1",
      spoken: "人工期间客户消息",
      rawSpoken: "人工期间客户消息",
      roomType: 2,
      receivedName: "张三",
      groupName: "张三",
      atMe: "false",
      textType: 1
    },
    flow: {
      session: {
        handoffStatus: "human"
      }
    },
    conversationReset: false
  });

  assert.equal(request.metadata.eventType, "handoff_transcript_message");
  assert.equal(request.metadata.worktool.eventType, "handoff_transcript_message");
  assert.equal(request.external_session_id, "bot_1:private:张三");
  assert.match(request.message, /不要生成客户可见回复/);
  assert.match(request.message, /最终请输出空字符串/);
});

test("tag-enabled handoff transcripts request decisions with an empty customer reply", () => {
  const request = buildDclawHandoffTranscriptRequest({
    binding: {
      botId: "bot_1",
      agentId: "agent_1"
    },
    conversation: {
      conversationKey: "bot_1:private:张三"
    },
    message: {
      messageId: "msg_2",
      spoken: "你们老师水平怎么样",
      rawSpoken: "你们老师水平怎么样",
      roomType: 2,
      receivedName: "张三",
      groupName: "张三",
      atMe: "false",
      textType: 1
    },
    flow: {
      session: {
        handoffStatus: "human"
      }
    },
    tagContext: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [{ id: "b", name: "B类", condition: "询问问题" }]
      }],
      currentTags: []
    },
    tagEvidenceCandidates: [{
      id: "42",
      conversationMessageId: 42,
      text: "你们老师水平怎么样"
    }]
  });

  assert.equal(request.metadata.tagRules.groups[0].id, "intent");
  assert.equal(request.metadata.tagEvidenceCandidates[0].id, "42");
  assert.match(request.message, /tagDecision/);
  assert.match(request.message, /evidenceMessageId/);
  assert.match(request.message, /"reply":""/);
  assert.doesNotMatch(request.message, /最终请输出空字符串/);
});

test("conversation reset request uses a bounded event and exact acknowledgement", () => {
  const request = buildDclawConversationResetRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversationKey: "bot_1:private:张三",
    reason: "console_reset"
  });

  assert.equal(request.metadata.eventType, "conversation_reset");
  assert.equal(request.metadata.worktool.eventType, "conversation_reset");
  assert.equal(request.external_user_id, "张三");
  assert.equal(request.external_session_id, "bot_1:private:张三");
  assert.match(request.message, /客户档案/);
  assert.match(request.message, /conversationId/);
  assert.deepEqual(
    parseConversationResetAcknowledgement('{"ok":true,"eventType":"conversation_reset"}'),
    { ok: true }
  );
  assert.equal(parseConversationResetAcknowledgement('{"reply":"好的"}').ok, false);
  assert.equal(parseConversationResetAcknowledgement('```json\n{"ok":true,"eventType":"conversation_reset"}\n```').ok, false);
  assert.equal(parseConversationResetAcknowledgement('{"ok":true,"eventType":"other"}').ok, false);
});

test("conversation memory clear targets the customer's existing DClaw session", () => {
  const request = buildDclawConversationMemoryClearRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversationKey: "bot_1:private:张三",
    reason: "console_reset"
  });

  assert.equal(request.external_user_id, "张三");
  assert.equal(request.external_session_id, "bot_1:private:张三");
  assert.equal(request.message, "/clear");
  assert.equal(request.metadata.eventType, "conversation_memory_clear");
  assert.deepEqual(
    parseConversationMemoryClearAcknowledgement(
      "**History Cleared!**\n\n- Memory is now empty\n- Plan state cleared"
    ),
    { ok: true }
  );
  assert.equal(parseConversationMemoryClearAcknowledgement("好的").ok, false);
});

test("conversation memory clear is private-only because group sessions are sender-scoped", () => {
  const request = buildDclawConversationMemoryClearRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversationKey: "bot_1:group:测试群",
    reason: "console_reset"
  });

  assert.equal(request, null);
});
