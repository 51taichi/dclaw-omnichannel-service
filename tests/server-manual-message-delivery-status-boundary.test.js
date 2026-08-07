import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("manual replies preserve the channel message ID for delivery-status lookup", () => {
  assert.match(serverSource, /const messageId = result\.data \|\| ""/);
  assert.match(serverSource, /source: "manual_reply"[\s\S]*?messageId/);
  assert.match(serverSource, /insertOutgoingMessage\(\{[\s\S]*?conversationKey[\s\S]*?messageId/);
  assert.match(serverSource, /listConversationMessages\(\{[\s\S]*?botId[\s\S]*?conversationKey/);
});

test("manual replies return the raw channel response without claiming delivery", () => {
  const routeStart = serverSource.indexOf('"/api/flow-sessions/:conversationKey/manual-reply"');
  const routeEnd = serverSource.indexOf('\napp.put(', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "manual reply route is present");
  const routeSource = serverSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /rawPayload = \{[\s\S]*?messageId,[\s\S]*?channelResponse: result/);
  assert.match(routeSource, /channelResponse: rawPayload/);
  assert.match(routeSource, /res\.json\([\s\S]*?channelResponse: result/);
  assert.doesNotMatch(routeSource, /deliveryStatus/);
});
