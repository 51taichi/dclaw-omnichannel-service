import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createAttentionAlertStreamHub } from "../src/attention-alert-stream.js";

class FakeRequest extends EventEmitter {}
class FakeResponse {
  headers = new Map(); output = ""; ended = false;
  setHeader(name, value) { this.headers.set(name, value); }
  flushHeaders() {}
  write(value) { this.output += value; }
  end() { this.ended = true; }
}

test("attention stream registers before loading its snapshot", async () => {
  const hub = createAttentionAlertStreamHub({ heartbeatMs: 60_000 });
  const req = new FakeRequest();
  const res = new FakeResponse();
  await hub.subscribe({
    botId: "bot-a",
    req,
    res,
    loadSnapshot: async () => {
      hub.publishCreated({ botId: "bot-a", alert: { id: 7 } });
      return [];
    }
  });
  assert.ok(res.output.indexOf("attention.created") < res.output.indexOf("attention.snapshot"));
  assert.match(res.output, /"id":7/);
  hub.close();
});

test("attention stream isolates Bots and publishes updates and reads", async () => {
  const hub = createAttentionAlertStreamHub({ heartbeatMs: 60_000 });
  const a = { req: new FakeRequest(), res: new FakeResponse() };
  const b = { req: new FakeRequest(), res: new FakeResponse() };
  await hub.subscribe({ botId: "a", ...a, loadSnapshot: () => [{ id: 1 }] });
  await hub.subscribe({ botId: "b", ...b, loadSnapshot: () => [] });
  a.res.output = ""; b.res.output = "";
  hub.publishUpdated({ botId: "a", alert: { id: 1, occurrenceCount: 2 } });
  hub.publishRead({ botId: "a", alert: { id: 1, readAt: "now" } });
  assert.match(a.res.output, /attention\.updated/);
  assert.match(a.res.output, /attention\.read/);
  assert.equal(b.res.output, "");
  a.req.emit("close");
  a.res.output = "";
  hub.publishCreated({ botId: "a", alert: { id: 2 } });
  assert.equal(a.res.output, "");
  hub.close();
});
