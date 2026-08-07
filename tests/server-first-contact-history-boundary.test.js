import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/server.js"), "utf8");

test("new private Whapi conversations synchronize history before persisting the live message", () => {
  assert.match(source, /import \{ syncFirstContactHistory \} from "\.\/first-contact-history-sync\.js"/);
  assert.match(source, /async function persistInboundConversation\(/);
  assert.match(source, /firstDiscovery/);
  assert.ok(
    source.indexOf("await syncFirstContactHistory") < source.indexOf("insertConversationMessage({"),
    "history must be imported before the current live message"
  );
  assert.match(source, /skipFirstSeenDateTag:\s*skipFirstSeenDateTag \|\| firstDiscovery/);
  assert.match(source, /await persistInboundConversation\(\{/);
  assert.match(source, /firstDiscovery:\s*shouldSyncFirstContactHistory/);
  assert.match(source, /getFirstContactHistorySync\(\{ botId, conversationKey \}\)/);
  assert.match(source, /await waitForActiveFirstContactHistorySync\(\{/);
  assert.match(source, /prepareConversation:\s*ensureConversationShell/);
});

test("Whapi history lookup uses the configured account credentials and optional test base URL", () => {
  assert.match(source, /function createWhapiClientForBot\(/);
  assert.match(source, /WHAPI_BASE_URL/);
});
