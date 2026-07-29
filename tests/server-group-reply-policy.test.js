import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server resolves group callbacks to a managed canonical conversation before persistence", () => {
  assert.match(source, /function resolveInboundConversation\(\{ botId, message \}\)/);
  assert.match(source, /createOrGetGroup\(\{/);
  assert.match(source, /conversationKey: group\.conversationKey/);
  assert.match(source, /const received = intake \|\| ingestIncomingMessage\(\{ botId, message \}\)/);
});

test("server applies managed group and role reply policy after persisting inbound history", () => {
  const processSource = source.slice(source.indexOf("async function processIncomingMessage"));
  assert.match(source, /function resolveInboundGroupPolicy\(\{ botId, group, message \}\)/);
  assert.match(source, /resolveGroupReplyDecision\(\{/);
  assert.equal(
    processSource.indexOf("persistInboundConversation({") <
      processSource.indexOf("resolveInboundGroupPolicy({"),
    true
  );
  assert.match(processSource, /group_policy_never|group_mention_required/);
});

test("server carries an authorized role decision through coalescing and strict validation", () => {
  assert.match(source, /matchedRole:\s*role\s*\?/);
  assert.match(source, /groupReplyDecision:\s*groupPolicy/);
  assert.match(
    source,
    /const groupReplyDecision = batch\.items[\s\S]*?\.find\(\(decision\) => decision\?\.invokeAgent\)/
  );
  assert.match(source, /replyDecision:\s*groupReplyDecision/);
  assert.match(
    source,
    /requireReplyContent:\s*Boolean\(request\?\.metadata\?\.requireReplyContent\)/
  );
});
