import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../public/console/group-pins.js", import.meta.url),
  "utf8"
);
const context = {};
vm.runInNewContext(source, context);
const {
  readPinnedGroupIds,
  togglePinnedGroupId,
  sortGroupsByPinned
} = context.GroupPins;

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test("group pins are isolated by workspace and Bot", () => {
  const storage = createStorage();

  togglePinnedGroupId(storage, "workspace-a", "bot-1", "group-1");

  assert.deepEqual([...readPinnedGroupIds(storage, "workspace-a", "bot-1")], ["group-1"]);
  assert.deepEqual([...readPinnedGroupIds(storage, "workspace-a", "bot-2")], []);
  assert.deepEqual([...readPinnedGroupIds(storage, "workspace-b", "bot-1")], []);
});

test("toggling a group pin persists both pin and unpin", () => {
  const storage = createStorage();

  assert.deepEqual([...togglePinnedGroupId(storage, "workspace", "bot", "group-1")], ["group-1"]);
  assert.deepEqual([...togglePinnedGroupId(storage, "workspace", "bot", "group-1")], []);
});

test("group pins tolerate malformed storage and ignore stale IDs while sorting", () => {
  const storage = createStorage();
  storage.setItem("worktool_console_group_pins:workspace:bot", "not-json");
  assert.deepEqual([...readPinnedGroupIds(storage, "workspace", "bot")], []);

  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const sorted = sortGroupsByPinned(groups, new Set(["c", "missing", "a"]));
  assert.deepEqual(sorted.map((group) => group.id), ["a", "c", "b", "d"]);
  assert.deepEqual(groups.map((group) => group.id), ["a", "b", "c", "d"]);
});
