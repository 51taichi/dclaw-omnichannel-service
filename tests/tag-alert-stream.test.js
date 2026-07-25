import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTagAlertStreamHub } from "../src/tag-alert-stream.js";

class FakeRequest extends EventEmitter {}

class FakeResponse {
  constructor() {
    this.headers = new Map();
    this.output = "";
    this.flushCount = 0;
    this.ended = false;
  }

  setHeader(name, value) {
    this.headers.set(name, value);
  }

  flushHeaders() {
    this.flushCount += 1;
  }

  write(value) {
    this.output += value;
    return true;
  }

  end() {
    this.ended = true;
  }
}

function subscribe(hub, botId, snapshot = []) {
  const req = new FakeRequest();
  const res = new FakeResponse();
  hub.subscribe({ botId, req, res, snapshot });
  return { req, res };
}

test("a subscription starts with a persisted snapshot and SSE headers", () => {
  const hub = createTagAlertStreamHub({ heartbeatMs: 60_000 });
  const { res } = subscribe(hub, "bot_a", [{ id: 10, tagName: "B类" }]);

  assert.equal(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("Connection"), "keep-alive");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
  assert.match(res.output, /event: alerts\.snapshot/);
  assert.match(res.output, /"alerts":\[\{"id":10,"tagName":"B类"\}\]/);
  hub.close();
});

test("created and read events reach only matching Bot subscribers", () => {
  const hub = createTagAlertStreamHub({ heartbeatMs: 60_000 });
  const botA1 = subscribe(hub, "bot_a");
  const botA2 = subscribe(hub, "bot_a");
  const botB = subscribe(hub, "bot_b");
  botA1.res.output = "";
  botA2.res.output = "";
  botB.res.output = "";

  hub.publishCreated({
    botId: "bot_a",
    batchId: "invocation:1653",
    alerts: [{ id: 11, conversationKey: "bot_a:private:张三", tagName: "B类" }]
  });
  hub.publishRead({
    botId: "bot_a",
    alertId: 11,
    readAt: "2026-07-26T08:00:00.000Z"
  });

  for (const connection of [botA1, botA2]) {
    assert.match(connection.res.output, /event: alerts\.created/);
    assert.match(connection.res.output, /"batchId":"invocation:1653"/);
    assert.match(connection.res.output, /event: alerts\.read/);
    assert.match(connection.res.output, /"alertId":11/);
  }
  assert.equal(botB.res.output, "");
  hub.close();
});

test("heartbeats are comments and closed requests stop receiving events", async () => {
  const hub = createTagAlertStreamHub({ heartbeatMs: 5 });
  const connection = subscribe(hub, "bot_a");
  connection.res.output = "";

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.match(connection.res.output, /: heartbeat/);

  connection.req.emit("close");
  connection.res.output = "";
  hub.publishRead({ botId: "bot_a", alertId: 12, readAt: "now" });
  assert.equal(connection.res.output, "");
  hub.close();
});

test("closing the hub ends active connections and clears its timer", () => {
  const hub = createTagAlertStreamHub({ heartbeatMs: 60_000 });
  const first = subscribe(hub, "bot_a");
  const second = subscribe(hub, "bot_b");

  hub.close();

  assert.equal(first.res.ended, true);
  assert.equal(second.res.ended, true);
  assert.equal(hub.connectionCount(), 0);
});
