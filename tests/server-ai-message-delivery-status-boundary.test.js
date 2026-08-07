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

test("normal AI replies retain every text and attachment channel message id", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  const collectText = "const textMessageIds = sentParts.map((part) => part.result?.data || \"\").filter(Boolean);";
  const collectAttachments = "const attachmentMessageIds = sentAttachments.map((part) => part.result?.data || \"\").filter(Boolean);";
  const combineIds = "const channelMessageIds = [...textMessageIds, ...attachmentMessageIds].filter(Boolean);";
  const conversationWrite = body.indexOf("insertConversationMessage({", body.indexOf(combineIds));

  assert.ok(body.indexOf(collectText) >= 0);
  assert.ok(body.indexOf(collectAttachments) >= 0);
  assert.ok(body.indexOf(combineIds) > body.indexOf(collectAttachments));
  assert.ok(conversationWrite > body.indexOf(combineIds));
  assert.match(body.slice(conversationWrite), /rawPayload:\s*\{[\s\S]*channelMessageId:\s*channelMessageIds\[0\][\s\S]*channelMessageIds,/);
});

test("normal AI replies persist one outgoing record per text and attachment result", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  const textLoop = body.indexOf("for (const [index, part] of sentParts.entries())");
  const attachmentLoop = body.indexOf("for (const [index, part] of sentAttachments.entries())");

  assert.ok(textLoop >= 0);
  assert.ok(attachmentLoop > textLoop);
  for (const block of [
    body.slice(textLoop, attachmentLoop),
    body.slice(attachmentLoop)
  ]) {
    assert.match(block, /insertOutgoingMessage\(\{/);
    assert.match(block, /messageId:\s*part\.result\?\.data \|\| ""/);
    assert.match(block, /channelResponse:\s*\{\s*\.\.\.\(part\.result \|\| \{\}\),/);
  }
});
