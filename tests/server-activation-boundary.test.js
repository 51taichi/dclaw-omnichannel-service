import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("server schedules activation after successful private flow replies", () => {
  assert.equal(source.includes("scheduleActivationAfterFlowReply"), true);
  assert.equal(source.includes("scheduleFlowActivationTask"), true);
  assert.equal(
    source.slice(source.indexOf("worktool.send.success")).includes("scheduleActivationAfterFlowReply({"),
    true
  );
});

test("server cancels activation on inbound messages, handoff, reset, and node transition", () => {
  assert.equal(source.includes('reason: "customer_replied"'), true);
  assert.equal(source.includes('reason: "human_handoff"'), true);
  assert.equal(source.includes('reason: "conversation_reset"'), true);
  assert.equal(source.includes('reason: "node_transition"'), true);
  assert.equal(dbSource.includes("incrementFlowActivationGeneration"), true);
});
