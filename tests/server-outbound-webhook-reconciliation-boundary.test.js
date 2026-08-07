import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${name} closes its body`);
}

test("outbound Whapi messages reconcile before and outside customer inbound processing", () => {
  const body = functionBody("dispatchChannelWebhookEvent");
  const reconcileAt = body.indexOf("reconcileOutboundWebhookMessage({");
  const inboundBridgeAt = body.indexOf("toCoreMessage(event)");

  assert.ok(reconcileAt >= 0, "message.sent invokes outbound reconciliation");
  assert.ok(reconcileAt < inboundBridgeAt, "outbound reconciliation runs before inbound bridging");
  assert.match(
    body,
    /if \(event\.eventType === "message\.sent"\) \{[\s\S]*reconcileOutboundWebhookMessage\(\{[\s\S]*return;[\s\S]*\}/
  );
});
