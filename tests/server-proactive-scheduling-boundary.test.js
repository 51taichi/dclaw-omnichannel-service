import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("proactive create route persists scheduledAt and validates Beijing time", () => {
  assert.match(source, /scheduledAt/);
  assert.match(source, /createProactiveTask\(\{[\s\S]*scheduledAt/);
  assert.match(source, /Asia\/Shanghai|北京时间|UTC\+8/);
  assert.match(source, /scheduledAt.*Date|Date.*scheduledAt/);
});

test("server exposes Bot-scoped proactive tag selection route", () => {
  assert.match(source, /\/api\/proactive\/targets\/tags/);
  assert.match(source, /listProactiveTargetTags/);
  assert.match(source, /assertBotAccess/);
});

test("server exposes Bot-scoped proactive task cancellation route", () => {
  assert.match(source, /\/api\/proactive\/tasks\/:taskId\/cancel/);
  assert.match(source, /cancelProactiveTask/);
  assert.match(source, /listProactiveTaskTargets/);
});

test("proactive target route forwards tag filters without changing pagination", () => {
  assert.match(source, /tagFilters/);
  assert.match(source, /listProactiveAddressBookTargetsPage\(\{[\s\S]*tagFilters/);
  assert.match(source, /pageSize: Number\(req\.query\.pageSize/);
});

test("proactive worker supplies current time when claiming due targets", () => {
  assert.match(source, /claimNextProactiveTarget\(\{\s*nowIso:/);
});
