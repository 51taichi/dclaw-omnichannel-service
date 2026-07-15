import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("conversation reset sync validates an exact Agent acknowledgement", () => {
  assert.match(source, /export async function syncConversationResetToAgent/);
  assert.match(source, /buildDclawConversationResetRequest/);
  assert.match(source, /parseConversationResetAcknowledgement/);
  assert.match(source, /markConversationResetHandled\(conversationKey\)/);
  assert.match(source, /agent\.conversation_reset\.failed/);
});

test("reset route stays local-first and returns Agent sync status", () => {
  const routeStart = source.indexOf('"/api/flow-sessions/:conversationKey/reset"');
  const route = source.slice(routeStart, routeStart + 1800);
  assert.equal(routeStart >= 0, true);
  assert.equal(route.indexOf("clearConversationForReset") < route.indexOf("syncConversationResetToAgent"), true);
  assert.match(route, /agentSync/);
  assert.match(route, /reason: "conversation_reset"/);
});
