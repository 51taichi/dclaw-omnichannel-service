import assert from "node:assert/strict";
import test from "node:test";

await import("../public/console/proactive-target-selection.js");

const { intersectTargetMaps } = globalThis.ProactiveTargetSelection;

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
