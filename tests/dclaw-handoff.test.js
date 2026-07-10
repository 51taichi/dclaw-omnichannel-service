import assert from "node:assert/strict";
import test from "node:test";
import { buildDclawHandoffTranscriptRequest } from "../src/dclaw.js";

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
