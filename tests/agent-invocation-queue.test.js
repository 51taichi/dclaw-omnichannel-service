import assert from "node:assert/strict";
import test from "node:test";
import { createAgentInvocationQueue } from "../src/agent-invocation-queue.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("unrelated conversations run up to the configured concurrency", async () => {
  const queue = createAgentInvocationQueue({ concurrency: 3 });
  const gates = new Map([
    ["conversation-a", deferred()],
    ["conversation-b", deferred()],
    ["conversation-c", deferred()],
    ["conversation-d", deferred()]
  ]);
  const started = [];

  const tasks = [...gates].map(([key, gate]) =>
    queue.enqueue(async () => {
      started.push(key);
      await gate.promise;
    }, { key })
  );

  await waitFor(
    () => started.length === 3,
    "three unrelated conversations should start concurrently"
  );
  assert.deepEqual(started, [
    "conversation-a",
    "conversation-b",
    "conversation-c"
  ]);

  gates.get("conversation-b").resolve();
  await waitFor(
    () => started.includes("conversation-d"),
    "the fourth conversation should start after capacity is released"
  );

  for (const gate of gates.values()) gate.resolve();
  await Promise.all(tasks);
});

test("tasks for the same conversation stay serial while another conversation runs", async () => {
  const queue = createAgentInvocationQueue({ concurrency: 2 });
  const firstGate = deferred();
  const otherGate = deferred();
  const order = [];

  const first = queue.enqueue(async () => {
    order.push("same-1-start");
    await firstGate.promise;
    order.push("same-1-end");
  }, { key: "same" });
  const second = queue.enqueue(async () => {
    order.push("same-2");
  }, { key: "same" });
  const other = queue.enqueue(async () => {
    order.push("other-start");
    await otherGate.promise;
    order.push("other-end");
  }, { key: "other" });

  await waitFor(
    () => order.includes("other-start"),
    "a different conversation should use the second slot"
  );
  assert.deepEqual(order, ["same-1-start", "other-start"]);

  firstGate.resolve();
  await waitFor(
    () => order.includes("same-2"),
    "the second task should start after the first task releases its conversation"
  );
  assert.deepEqual(order.slice(0, 4), [
    "same-1-start",
    "other-start",
    "same-1-end",
    "same-2"
  ]);

  otherGate.resolve();
  await Promise.all([first, second, other]);
});

test("realtime Agent work runs before queued background work", async () => {
  const queue = createAgentInvocationQueue({ concurrency: 1 });
  const firstBackground = deferred();
  const order = [];

  const first = queue.enqueue(async () => {
    order.push("background-1-start");
    await firstBackground.promise;
    order.push("background-1-end");
  }, { priority: "background", key: "background-1" });
  const second = queue.enqueue(async () => {
    order.push("background-2");
  }, { priority: "background", key: "background-2" });
  const realtime = queue.enqueue(async () => {
    order.push("realtime");
  }, { key: "realtime" });

  firstBackground.resolve();
  await Promise.all([first, second, realtime]);

  assert.deepEqual(order, [
    "background-1-start",
    "background-1-end",
    "realtime",
    "background-2"
  ]);
});

test("a rejected Agent task does not stop either priority queue", async () => {
  const queue = createAgentInvocationQueue({ concurrency: 1 });
  const failureGate = deferred();
  const order = [];

  const failed = queue.enqueue(async () => {
    order.push("failed-start");
    await failureGate.promise;
    throw new Error("failed task");
  }, { priority: "background", key: "failed" });
  const background = queue.enqueue(async () => {
    order.push("background");
  }, { priority: "background", key: "background" });
  const realtime = queue.enqueue(async () => {
    order.push("realtime");
  }, { key: "realtime" });

  failureGate.resolve();
  await assert.rejects(failed, /failed task/);
  await Promise.all([background, realtime]);

  assert.deepEqual(order, ["failed-start", "realtime", "background"]);
});

test("priority does not reorder tasks within the same conversation", async () => {
  const queue = createAgentInvocationQueue({ concurrency: 1 });
  const firstGate = deferred();
  const order = [];

  const first = queue.enqueue(async () => {
    order.push("background-start");
    await firstGate.promise;
    order.push("background-end");
  }, { priority: "background", key: "same" });
  const second = queue.enqueue(async () => {
    order.push("background-second");
  }, { priority: "background", key: "same" });
  const realtime = queue.enqueue(async () => {
    order.push("realtime-third");
  }, { key: "same" });

  firstGate.resolve();
  await Promise.all([first, second, realtime]);

  assert.deepEqual(order, [
    "background-start",
    "background-end",
    "background-second",
    "realtime-third"
  ]);
});
