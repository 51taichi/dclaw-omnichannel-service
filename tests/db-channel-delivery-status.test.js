import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("Whapi delivery statuses update by provider account and never regress", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dclaw-channel-status-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { insertOutgoingMessage, listRecords, updateOutgoingMessageChannelStatus } from "./src/db.js";
    insertOutgoingMessage({
      botId: "bot-a", conversationKey: "whapi:CHAN-A:private:123", messageId: "message-1",
      targetName: "123", content: "hello",
      worktoolResponse: { channelResult: { accepted: true, externalMessageId: "message-1", status: "pending" } }
    });
    insertOutgoingMessage({
      botId: "bot-b", conversationKey: "whapi:CHAN-B:private:123", messageId: "message-1",
      targetName: "123", content: "other", provider: "whapi", channelAccountId: "CHAN-B",
      deliveryStatus: "pending", worktoolResponse: {}
    });
    const delivered = updateOutgoingMessageChannelStatus({ provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "delivered" });
    const regressed = updateOutgoingMessageChannelStatus({ provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "sent" });
    const read = updateOutgoingMessageChannelStatus({ provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "read" });
    console.log(JSON.stringify({ delivered, regressed, read, rows: listRecords("outgoing-messages") }));
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: path.join(directory, "status.sqlite") },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.delivered.deliveryStatus, "delivered");
  assert.equal(output.regressed.deliveryStatus, "delivered");
  assert.equal(output.read.deliveryStatus, "read");
  const isolated = output.rows.find((row) => row.bot_id === "bot-b");
  assert.equal(isolated.delivery_status, "pending");
});
