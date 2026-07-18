import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-message-key-test-"));
const { buildMessageKey } = await import("../src/db.js");

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
