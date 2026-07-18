import assert from "node:assert/strict";
import test from "node:test";

import { createInboundMessageCoalescer } from "../src/inbound-coalescer.js";

function createFakeClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimer(callback, delay) {
    const id = nextId++;
    timers.set(id, { id, callback, at: current + Math.max(0, delay) });
    return id;
  }

  function clearTimer(id) {
    timers.delete(id);
  }

  async function advance(ms) {
    const target = current + ms;
    while (true) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) break;
      timers.delete(due.id);
      current = due.at;
      due.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    current = target;
    await Promise.resolve();
  }

  return {
    now: () => current,
    setTimer,
    clearTimer,
    advance
  };
}

test("coalescer increases the quiet window for each appended message without a hard cutoff", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 10_000,
    incrementMs: 5_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch)
  });

  coalescer.push("bot-a:private:张三", { text: "去哪里听？" });
  await clock.advance(9_000);
  coalescer.push("bot-a:private:张三", { text: "收钱的不？" });
  await clock.advance(14_000);
  assert.equal(flushed.length, 0);
  coalescer.push("bot-a:private:张三", { text: "需要预约吗？" });
  await clock.advance(19_999);
  assert.equal(flushed.length, 0);
  await clock.advance(1);

  assert.deepEqual(flushed[0].items.map((item) => item.text), ["去哪里听？", "收钱的不？", "需要预约吗？"]);
  assert.equal(flushed[0].reason, "quiet_window");
});

test("coalescer flushes one message after the quiet window", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 10_000,
    incrementMs: 5_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch)
  });

  coalescer.push("bot-a:private:张三", { text: "你好" });
  await clock.advance(9_999);
  assert.equal(flushed.length, 0);
  await clock.advance(1);

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].reason, "quiet_window");
});

test("coalescer allows a zero increment override", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 100,
    incrementMs: 50,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch)
  });

  coalescer.push("bot-a:private:张三", { text: "1" }, { incrementMs: 0 });
  await clock.advance(50);
  coalescer.push("bot-a:private:张三", { text: "2" });
  await clock.advance(99);
  assert.equal(flushed.length, 0);
  await clock.advance(1);
  assert.equal(flushed.length, 1);
});

test("coalescer isolates conversations and reports lifecycle events", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const events = [];
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 100,
    incrementMs: 50,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch),
    onEvent: (name, details) => events.push({ name, details })
  });

  coalescer.push("bot-a:private:张三", { text: "A1" });
  coalescer.push("bot-a:private:李四", { text: "B1" });
  coalescer.push("bot-a:private:张三", { text: "A2" });

  assert.equal(coalescer.pendingCount(), 2);
  assert.equal(coalescer.has("bot-a:private:张三"), true);
  await clock.advance(100);

  assert.equal(flushed.length, 1);
  await clock.advance(50);
  assert.equal(flushed.length, 2);
  assert.deepEqual(flushed.find((batch) => batch.key.endsWith("张三")).items.map((item) => item.text), ["A1", "A2"]);
  assert.deepEqual(events.map((event) => event.name), ["started", "started", "appended", "flushed", "flushed"]);
});

test("coalescer cancellation returns items and prevents a late flush", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const events = [];
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 100,
    incrementMs: 50,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch),
    onEvent: (name, details) => events.push({ name, details })
  });

  coalescer.push("bot-a:private:张三", { text: "不会发送" });
  const canceled = coalescer.cancel("bot-a:private:张三", "conversation_reset");
  await clock.advance(300);

  assert.deepEqual(canceled.map((item) => item.text), ["不会发送"]);
  assert.equal(flushed.length, 0);
  assert.equal(coalescer.pendingCount(), 0);
  assert.equal(events.at(-1).name, "canceled");
  assert.equal(events.at(-1).details.reason, "conversation_reset");
});

test("coalescer cancels only pending batches for one bot", () => {
  const clock = createFakeClock();
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 100,
    incrementMs: 50,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async () => {}
  });

  coalescer.push("bot-a\u0000bot-a:private:张三", { text: "A" });
  coalescer.push("bot-b\u0000bot-b:private:张三", { text: "B" });
  const canceled = coalescer.cancelByBot("bot-a", "bot_deleted");

  assert.equal(canceled.length, 1);
  assert.equal(canceled[0].items[0].text, "A");
  assert.equal(coalescer.has("bot-a\u0000bot-a:private:张三"), false);
  assert.equal(coalescer.has("bot-b\u0000bot-b:private:张三"), true);
});

test("coalescer serializes flushed batches for the same conversation", async () => {
  const clock = createFakeClock();
  const calls = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const coalescer = createInboundMessageCoalescer({
    baseQuietMs: 10,
    incrementMs: 5,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => {
      calls.push(`start:${batch.items[0].text}`);
      if (batch.items[0].text === "first") await firstBlocked;
      calls.push(`finish:${batch.items[0].text}`);
    }
  });

  coalescer.push("bot-a:private:张三", { text: "first" });
  await clock.advance(10);
  coalescer.push("bot-a:private:张三", { text: "second" });
  await clock.advance(10);
  assert.deepEqual(calls, ["start:first"]);

  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["start:first", "finish:first", "start:second", "finish:second"]);
});
