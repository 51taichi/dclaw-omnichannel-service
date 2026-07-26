import assert from "node:assert/strict";
import test from "node:test";

import { buildDclawConversationIdentity } from "../src/dclaw-conversation-identity.js";

const safeExternalId = /^[a-z0-9._:-]+$/;

test("Chinese WorkTool conversations produce stable ASCII DClaw identities", () => {
  const input = {
    botId: "bot_中文",
    conversationKey: "bot_中文:private:魔兮",
    conversationEpoch: "epoch-1",
    purpose: "conversation"
  };

  const first = buildDclawConversationIdentity(input);
  const repeated = buildDclawConversationIdentity(input);

  assert.deepEqual(repeated, first);
  assert.match(first.externalUserId, safeExternalId);
  assert.match(first.externalSessionId, safeExternalId);
  assert.match(first.runtimeConversationId, safeExternalId);
  assert.notEqual(first.externalUserId, "anonymous");
  assert.ok(first.externalUserId.length <= 128);
  assert.ok(first.externalSessionId.length <= 128);
  assert.ok(first.runtimeConversationId.length <= 128);
});

test("different Chinese customers never share one DClaw identity", () => {
  const common = {
    botId: "bot-1",
    conversationEpoch: "epoch-1",
    purpose: "conversation"
  };
  const first = buildDclawConversationIdentity({
    ...common,
    conversationKey: "bot-1:private:魔兮"
  });
  const second = buildDclawConversationIdentity({
    ...common,
    conversationKey: "bot-1:private:顺事"
  });

  assert.notEqual(first.externalUserId, second.externalUserId);
  assert.notEqual(first.externalSessionId, second.externalSessionId);
  assert.notEqual(first.runtimeConversationId, second.runtimeConversationId);
});

test("a new conversation epoch rotates runtime and session identity", () => {
  const common = {
    botId: "bot-1",
    conversationKey: "bot-1:private:魔兮",
    purpose: "conversation"
  };
  const oldIdentity = buildDclawConversationIdentity({
    ...common,
    conversationEpoch: "epoch-old"
  });
  const newIdentity = buildDclawConversationIdentity({
    ...common,
    conversationEpoch: "epoch-new"
  });

  assert.equal(oldIdentity.externalUserId, newIdentity.externalUserId);
  assert.notEqual(oldIdentity.runtimeConversationId, newIdentity.runtimeConversationId);
  assert.notEqual(oldIdentity.externalSessionId, newIdentity.externalSessionId);
});

test("background analysis changes only the purpose-specific session", () => {
  const common = {
    botId: "bot-1",
    conversationKey: "bot-1:private:魔兮",
    conversationEpoch: "epoch-1"
  };
  const live = buildDclawConversationIdentity({
    ...common,
    purpose: "conversation"
  });
  const background = buildDclawConversationIdentity({
    ...common,
    purpose: "legacy-history-analysis"
  });

  assert.equal(live.externalUserId, background.externalUserId);
  assert.equal(live.runtimeConversationId, background.runtimeConversationId);
  assert.notEqual(live.externalSessionId, background.externalSessionId);
});
