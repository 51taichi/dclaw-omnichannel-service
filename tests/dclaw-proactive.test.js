import assert from "node:assert/strict";
import test from "node:test";
import { buildDclawProactiveEventRequest } from "../src/dclaw.js";
import { buildDclawConversationIdentity } from "../src/dclaw-conversation-identity.js";

test("proactive sync uses the current conversation-purpose identity", () => {
  const conversation = {
    conversationKey: "bot_1:private:张三",
    conversationEpoch: "epoch-proactive"
  };
  const request = buildDclawProactiveEventRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversation,
    target: {
      targetType: "private",
      targetName: "张三",
      content: "您好",
      messageType: "text"
    },
    channelMessageId: "message-1",
    channelResponse: { code: 200 }
  });
  const identity = buildDclawConversationIdentity({
    botId: "bot_1",
    ...conversation,
    purpose: "conversation"
  });

  assert.equal(request.external_user_id, identity.externalUserId);
  assert.equal(request.external_session_id, identity.externalSessionId);
  assert.equal(request.metadata.conversationId, identity.runtimeConversationId);
  assert.equal(request.metadata.localConversationId, conversation.conversationKey);
  assert.equal(
    request.metadata.channel.metadata.localConversationId,
    conversation.conversationKey
  );
});
