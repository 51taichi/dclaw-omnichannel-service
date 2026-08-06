import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("Whapi proactive address book persists stable chat IDs and conversation keys", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dclaw-whapi-proactive-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { insertIncomingMessage, listProactiveAddressBookTargets } from "./src/db.js";
    insertIncomingMessage({ botId: "bot-a", conversationKey: "whapi:CHAN-A:private:1555@s.whatsapp.net", payload: {
      messageId: "m1", roomType: 2, receivedName: "Ada", spoken: "hello",
      metadata: { provider: "whapi", channelAccountId: "CHAN-A", externalChatId: "1555@s.whatsapp.net", conversationKey: "whapi:CHAN-A:private:1555@s.whatsapp.net" }
    } });
    insertIncomingMessage({ botId: "bot-a", conversationKey: "whapi:CHAN-A:group:12001@g.us", payload: {
      messageId: "m2", roomType: 1, groupName: "Support", receivedName: "Grace", spoken: "hello",
      metadata: { provider: "whapi", channelAccountId: "CHAN-A", externalChatId: "12001@g.us", conversationKey: "whapi:CHAN-A:group:12001@g.us" }
    } });
    console.log(JSON.stringify(listProactiveAddressBookTargets({ botId: "bot-a", limit: 10 })));
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: path.join(directory, "service.sqlite") },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const targets = JSON.parse(result.stdout);
  assert.deepEqual(targets.map(({ targetType, targetName, displayName, conversationKey }) => ({
    targetType, targetName, displayName, conversationKey
  })), [
    { targetType: "group", targetName: "12001@g.us", displayName: "Support", conversationKey: "whapi:CHAN-A:group:12001@g.us" },
    { targetType: "private", targetName: "1555@s.whatsapp.net", displayName: "Ada", conversationKey: "whapi:CHAN-A:private:1555@s.whatsapp.net" }
  ]);
});
