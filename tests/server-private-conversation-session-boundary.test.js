import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} has a function signature`);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}

test("private inbound messages create a generic session without an enabled flow machine", () => {
  const body = functionBody("persistInboundConversation");

  assert.match(
    body,
    /if \(isGroupMessage\(message\) \|\| !flowMachine\?\.enabled\) \{\s*getOrCreateConversationSession\(\{ botId, conversationKey \}\);/
  );
  assert.match(
    body,
    /else \{\s*getOrCreateFlowSession\(\{\s*botId,\s*conversationKey,\s*machine: flowMachine\.config/
  );
});

test("generic session indexing does not change private Agent invocation eligibility", () => {
  const body = functionBody("shouldInvokeAgent");

  assert.match(body, /if \(!isGroupMessage\(message\)\) \{\s*return true;/);
});
