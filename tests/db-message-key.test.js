import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-message-key-test-"));
const {
  beginMessageProcessing,
  buildMessageKey,
  insertIncomingMessage,
  listRecords
} = await import("../src/db.js");

const base = {
  botId: "bot-a",
  conversationKey: "bot-a:private:诺"
};

test("identical callbacks keep the same message key", () => {
  const message = {
    messageId: "shared-id",
    textType: 1,
    roomType: 2,
    receivedName: "诺",
    spoken: "3",
    rawSpoken: "3"
  };
  assert.equal(
    buildMessageKey({ ...base, message }),
    buildMessageKey({ ...base, message: { ...message } })
  );
});

test("different content sharing a WorkTool message id is not deduplicated", () => {
  const first = buildMessageKey({
    ...base,
    message: { messageId: "shared-id", textType: 1, roomType: 2, receivedName: "诺", spoken: "3", rawSpoken: "3" }
  });
  const second = buildMessageKey({
    ...base,
    message: { messageId: "shared-id", textType: 1, roomType: 2, receivedName: "诺", spoken: "4", rawSpoken: "4" }
  });
  assert.notEqual(first, second);
});

test("duplicate callbacks remain in the raw intake log even when processing is deduplicated", () => {
  const message = {
    messageId: "",
    textType: 1,
    roomType: 2,
    receivedName: "诺",
    spoken: "同一句话"
  };
  const messageKey = buildMessageKey({ ...base, message, nowMs: 10_000 });
  insertIncomingMessage({ botId: base.botId, conversationKey: base.conversationKey, payload: message });
  assert.equal(
    beginMessageProcessing({
      messageKey,
      botId: base.botId,
      conversationKey: base.conversationKey,
      messageId: message.messageId
    }),
    true
  );
  insertIncomingMessage({ botId: base.botId, conversationKey: base.conversationKey, payload: message });
  assert.equal(
    beginMessageProcessing({
      messageKey,
      botId: base.botId,
      conversationKey: base.conversationKey,
      messageId: message.messageId
    }),
    false
  );
  assert.equal(
    listRecords("incoming-messages", { botId: base.botId, limit: 10 }).length,
    2
  );
});
