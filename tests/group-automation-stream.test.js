import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createGroupAutomationStreamHub } from "../src/group-automation-stream.js";

class FakeRequest extends EventEmitter {}

class FakeResponse {
  constructor() {
    this.headers = new Map();
    this.output = "";
    this.ended = false;
  }
  setHeader(name, value) { this.headers.set(name, value); }
  flushHeaders() {}
  write(value) { this.output += value; return true; }
  end() { this.ended = true; }
}

function subscribe(hub, botId, groupId, snapshot = []) {
  const req = new FakeRequest();
  const res = new FakeResponse();
  hub.subscribe({ botId, groupId, req, res, snapshot });
  return { req, res };
}

test("streams an initial task snapshot and matching group updates", () => {
  const hub = createGroupAutomationStreamHub({ heartbeatMs: 60_000 });
  const groupOne = subscribe(hub, "bot-a", "group-1", [{ id: "task-1" }]);
  const otherGroup = subscribe(hub, "bot-a", "group-2", []);
  const otherBot = subscribe(hub, "bot-b", "group-1", []);

  assert.equal(
    groupOne.res.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8"
  );
  assert.match(groupOne.res.output, /event: snapshot/);
  assert.match(groupOne.res.output, /"id":"task-1"/);
  groupOne.res.output = "";
  otherGroup.res.output = "";
  otherBot.res.output = "";

  hub.publish({
    botId: "bot-a",
    groupId: "group-1",
    task: {
      id: "task-1",
      executionAvailable: true,
      latestOccurrence: { stage: "waiting_target", targetDelayMs: 0 }
    }
  });
  assert.match(groupOne.res.output, /event: task_updated/);
  assert.match(groupOne.res.output, /"executionAvailable":true/);
  assert.match(groupOne.res.output, /"stage":"waiting_target"/);
  assert.equal(otherGroup.res.output, "");
  assert.equal(otherBot.res.output, "");
  hub.close();
});

test("closed connections are removed and hub close ends remaining responses", () => {
  const hub = createGroupAutomationStreamHub({ heartbeatMs: 60_000 });
  const first = subscribe(hub, "bot-a", "group-1");
  const second = subscribe(hub, "bot-a", "group-1");
  first.req.emit("close");
  assert.equal(hub.connectionCount(), 1);
  hub.close();
  assert.equal(second.res.ended, true);
  assert.equal(hub.connectionCount(), 0);
});
