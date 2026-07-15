import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const env = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

test("activation worker config is documented", () => {
  assert.equal(env.includes("ACTIVATION_WORKER_BATCH_SIZE=20"), true);
  assert.equal(env.includes("ACTIVATION_SEND_DELAY_MS=500"), true);
  assert.equal(readme.includes("节点激活"), true);
});

test("activation tasks are visible in logs", () => {
  assert.equal(db.includes('"flow-activation-tasks"'), true);
  assert.equal(html.includes('value="flow-activation-tasks"'), true);
});

test("new friend activation trigger is documented", () => {
  assert.equal(readme.includes("新增好友后"), true);
  assert.equal(readme.includes("textType=22"), true);
  assert.equal(readme.includes("type=105"), true);
});
