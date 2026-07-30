import assert from "node:assert/strict";
import test from "node:test";

await import("../public/console/proactive-target-selection.js");

const { createInteractionLock, intersectTargetMaps } = globalThis.ProactiveTargetSelection;

function targetMap(...names) {
  return new Map(
    names.map((name) => [
      `private:${name}`,
      { targetType: "private", targetName: name, displayName: name }
    ])
  );
}

test("automatic proactive filters keep only targets present in every filter", () => {
  const aClass = targetMap("今天A", "昨天A", "共享客户");
  const today = targetMap("今天A", "今天B", "共享客户");

  assert.deepEqual(
    [...intersectTargetMaps([aClass, today]).keys()],
    ["private:今天A", "private:共享客户"]
  );
});

test("automatic proactive filters intersect all selected tags and dates", () => {
  const aClass = targetMap("一号", "二号", "三号");
  const paid = targetMap("二号", "三号");
  const today = targetMap("三号", "四号");

  assert.deepEqual(
    [...intersectTargetMaps([aClass, paid, today]).keys()],
    ["private:三号"]
  );
});

test("no automatic proactive filter produces no automatic targets", () => {
  assert.deepEqual([...intersectTargetMaps([]).entries()], []);
});

test("interaction lock rejects a second task while the first is pending", async () => {
  let releaseFirst;
  const lock = createInteractionLock(() => {});
  const first = lock.run(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      })
  );

  assert.deepEqual(await lock.run(async () => "second"), { accepted: false });
  assert.equal(lock.isLocked(), true);

  releaseFirst("first");
  assert.deepEqual(await first, { accepted: true, value: "first" });
  assert.equal(lock.isLocked(), false);
});

test("interaction lock releases after a failed task", async () => {
  const states = [];
  const lock = createInteractionLock((locked) => states.push(locked));

  await assert.rejects(
    lock.run(async () => {
      throw new Error("filter failed");
    }),
    /filter failed/
  );

  assert.equal(lock.isLocked(), false);
  assert.deepEqual(states, [true, false]);
});

test("interaction lock reset prevents a stale task from unlocking a newer task", async () => {
  let releaseOld;
  let releaseNew;
  const states = [];
  const lock = createInteractionLock((locked) => states.push(locked));
  const oldTask = lock.run(
    () =>
      new Promise((resolve) => {
        releaseOld = resolve;
      })
  );

  lock.reset();
  const newTask = lock.run(
    () =>
      new Promise((resolve) => {
        releaseNew = resolve;
      })
  );
  releaseOld("old");
  await oldTask;

  assert.equal(lock.isLocked(), true);
  assert.deepEqual(states, [true, false, true]);

  releaseNew("new");
  await newTask;
  assert.equal(lock.isLocked(), false);
  assert.deepEqual(states, [true, false, true, false]);
});
