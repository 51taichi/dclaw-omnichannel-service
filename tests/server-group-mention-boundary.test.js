import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server normalizes authorized group callbacks before sending them to the agent", () => {
  assert.match(
    serverSource,
    /function normalizeMessageForAgent\(message, binding, groupReplyDecision = null\)/
  );
  assert.match(serverSource, /groupReplyDecision\?\.invokeAgent/);
  assert.match(serverSource, /atMe: "true"/);
  assert.match(serverSource, /originalAtMe/);
  assert.match(serverSource, /groupReplyAuthorized: true/);
  assert.match(
    serverSource,
    /const agentMessage = normalizeMessageForAgent\(\s*coalescedMessage,\s*binding,\s*groupReplyDecision\s*\)/
  );
  assert.match(serverSource, /message: agentMessage/);
});
