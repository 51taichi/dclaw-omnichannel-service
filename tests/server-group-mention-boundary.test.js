import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server normalizes mentioned group callbacks before sending them to the agent", () => {
  assert.match(serverSource, /function normalizeMessageForAgent\(message, binding\)/);
  assert.match(serverSource, /if \(!isGroupMessage\(message\) \|\| !isMentioned\(message, binding\)\)/);
  assert.match(serverSource, /atMe: "true"/);
  assert.match(serverSource, /originalAtMe/);
  assert.match(serverSource, /const agentMessage = normalizeMessageForAgent\(message, binding\)/);
  assert.match(serverSource, /message: agentMessage/);
});
