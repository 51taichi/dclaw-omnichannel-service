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
    import { DatabaseSync } from "node:sqlite";
    import { insertOutgoingMessage, listRecords, updateOutgoingMessageChannelStatus } from "./src/db.js";
    insertOutgoingMessage({
      botId: "bot-a", conversationKey: "whapi:CHAN-A:private:123", messageId: "message-1",
      targetName: "123", content: "hello",
      channelResponse: { channelResult: { accepted: true, externalMessageId: "message-1", status: "pending" } }
    });
    insertOutgoingMessage({
      botId: "bot-b", conversationKey: "whapi:CHAN-B:private:123", messageId: "message-1",
      targetName: "123", content: "other", provider: "whapi", channelAccountId: "CHAN-B",
      deliveryStatus: "pending", channelResponse: {}
    });
    insertOutgoingMessage({
      botId: "bot-shadow", conversationKey: "whapi:CHAN-A:private:shadow", messageId: "message-1",
      targetName: "shadow", content: "same provider account and message id", provider: "whapi", channelAccountId: "CHAN-A",
      deliveryStatus: "pending", channelResponse: {}
    });
    const delivered = updateOutgoingMessageChannelStatus({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "delivered" });
    const regressed = updateOutgoingMessageChannelStatus({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "sent" });
    const read = updateOutgoingMessageChannelStatus({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", messageId: "message-1", status: "read" });
    const sqlite = new DatabaseSync(process.env.DATABASE_PATH);
    const indexColumns = sqlite.prepare("PRAGMA index_xinfo(idx_outgoing_messages_callback_lookup)").all()
      .filter((column) => column.key === 1)
      .map((column) => ({ name: column.name, descending: column.desc }));
    const callbackPlan = sqlite.prepare(\`
      EXPLAIN QUERY PLAN
      SELECT * FROM outgoing_messages
      WHERE bot_id = ? AND provider = ? AND channel_account_id = ? AND message_id = ?
      ORDER BY id DESC LIMIT 1
    \`).all("bot-a", "whapi", "CHAN-A", "message-1").map((row) => row.detail).join("\\n");
    sqlite.close();
    console.log(JSON.stringify({
      delivered, regressed, read, rows: listRecords("outgoing-messages"), indexColumns, callbackPlan
    }));
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
  assert.equal(output.read.botId, "bot-a");
  const isolated = output.rows.find((row) => row.bot_id === "bot-b");
  assert.equal(isolated.delivery_status, "pending");
  const shadow = output.rows.find((row) => row.bot_id === "bot-shadow");
  assert.equal(shadow.delivery_status, "pending");
  assert.deepEqual(output.indexColumns, [
    { name: "bot_id", descending: 0 },
    { name: "provider", descending: 0 },
    { name: "channel_account_id", descending: 0 },
    { name: "message_id", descending: 0 },
    { name: "id", descending: 1 }
  ]);
  assert.match(output.callbackPlan, /USING INDEX idx_outgoing_messages_callback_lookup/);
});
