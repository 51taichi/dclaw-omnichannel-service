import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const agentRoot = new URL("../agents/xzj-business-manager-agent/", import.meta.url);
const customerReplyFlow = fs.readFileSync(new URL("skills/customer_reply_flow/SKILL.md", agentRoot), "utf8");
const experienceKnowledge = fs.readFileSync(new URL("skills/customer_experience_knowledge/SKILL.md", agentRoot), "utf8");

test("agent must query experience resources when customers ask for media and enterprise knowledge has no resource", () => {
  assert.match(customerReplyFlow, /资源索取意图/);
  assert.match(customerReplyFlow, /企业智库没有明确资源链接/);
  assert.match(customerReplyFlow, /必须继续查询客服经验库/);
  assert.match(customerReplyFlow, /不得直接回复.*没有.*资料/);
  assert.match(experienceKnowledge, /工厂视频/);
  assert.match(experienceKnowledge, /显式资源链接优先级/);
});

test("agent must force experience routing for trust objections and resource requests", () => {
  assert.match(customerReplyFlow, /经验库强制参与场景/);
  assert.match(customerReplyFlow, /没听过、不熟、靠谱吗、真的假的、小品牌/);
  assert.match(customerReplyFlow, /必须同时查询客服经验库/);
  assert.match(customerReplyFlow, /企业智库负责事实边界，客服经验库负责表达策略和资源线索/);
  assert.match(experienceKnowledge, /品牌信任异议/);
  assert.match(experienceKnowledge, /资源索取/);
});

test("agent template requires sources only for actually used references", () => {
  assert.match(customerReplyFlow, /sources/);
  assert.match(customerReplyFlow, /只记录实际命中、实际参考、实际用于生成回复的来源/);
  assert.match(customerReplyFlow, /未命中/);
  assert.match(customerReplyFlow, /不要写入 sources/);
});
