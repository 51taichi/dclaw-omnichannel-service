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

test("automatic activation scope is documented", () => {
  assert.equal(readme.includes("第一次收到某位客户的私聊消息时发现客户"), true);
  assert.equal(readme.includes("AI 成功回复都会重新锚定"), true);
  assert.equal(readme.includes("每条话术可独立配置间隔和次数"), true);
  assert.equal(readme.includes("节点变化会让旧节点任务失效"), true);
  assert.equal(readme.includes("textType=22"), false);
});
