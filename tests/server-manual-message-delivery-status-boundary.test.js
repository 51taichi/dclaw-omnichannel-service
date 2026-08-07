import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function manualReplyRouteSource() {
  const routeStart = serverSource.indexOf('"/api/flow-sessions/:conversationKey/manual-reply"');
  const routeEnd = serverSource.indexOf('\napp.put(', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "manual reply route is present");
  return serverSource.slice(routeStart, routeEnd);
}

test("manual replies preserve the local channel message ID for delivery-status lookup", () => {
  const routeSource = manualReplyRouteSource();

  assert.match(
    routeSource,
    /const messageId = result\.data \|\| "";[\s\S]*?const rawPayload = \{[\s\S]*?source: "manual_reply",[\s\S]*?messageId,[\s\S]*?channelResponse: result[\s\S]*?\};/
  );
  assert.match(
    routeSource,
    /insertOutgoingMessage\(\{[\s\S]*?conversationKey,[\s\S]*?messageId,[\s\S]*?channelResponse: rawPayload[\s\S]*?\}\);/
  );
  assert.match(
    routeSource,
    /rawPayload = \{[\s\S]*?messageId,[\s\S]*?insertOutgoingMessage\(\{[\s\S]*?messageId/
  );
});

test("flow session detail reads decorated messages through the bot-scoped boundary", () => {
  const routeStart = serverSource.indexOf('"/api/flow-sessions/:conversationKey",');
  const routeEnd = serverSource.indexOf('\napp.post(\n  "/api/flow-sessions/:conversationKey/tags/manual"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "flow session detail route is present");
  const routeSource = serverSource.slice(routeStart, routeEnd);

  assert.match(routeSource, /listConversationMessages\(\{[\s\S]*?botId,[\s\S]*?conversationKey/);
});

test("manual replies return the raw channel response without claiming delivery", () => {
  const routeSource = manualReplyRouteSource();

  assert.match(routeSource, /rawPayload = \{[\s\S]*?messageId,[\s\S]*?channelResponse: result/);
  assert.match(routeSource, /res\.json\([\s\S]*?channelResponse: result/);
  assert.doesNotMatch(routeSource, /deliveryStatus/);
});
