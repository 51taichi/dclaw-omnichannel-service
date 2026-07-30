import assert from "node:assert/strict";
import test from "node:test";
import { createCockpitDeliveryService, formatCockpitReportSummary } from "../src/cockpit-delivery.js";

const report = {
  id: 3,
  reportType: "daily",
  periodStart: "2026-07-29T00:00:00.000Z",
  summary: {
    executiveSummary: "邀约率需要关注。",
    metrics: { newCustomers: 9, customerMessages: 18, replyMessages: 16, neverReplied: 3 }
  }
};

test("delivery summary is compact and contains no customer-level details", () => {
  const text = formatCockpitReportSummary(report, { reportUrl: "https://example.test/r/3" });
  assert.match(text, /新增客户 9｜客户消息 18｜回复消息 16｜从未回复 3/);
  assert.doesNotMatch(text, /成功邀约/);
  assert.match(text, /完整报告/);
  assert.doesNotMatch(text, /手机号|customerKey|conversationKey/);
});

test("delivery service sends one text per claimed recipient", async () => {
  const sent = [];
  const service = createCockpitDeliveryService({
    claimDeliveries: () => [{ id: 1, reportId: 3, botId: "bot-a", recipient: "alice" }],
    getReport: () => report,
    sendText: async (input) => { sent.push(input); return { ok: true }; },
    finishDelivery: () => {},
    publicBaseUrl: "https://example.test"
  });
  const result = await service.sendDue({ now: "2026-07-30T09:00:00.000Z" });
  assert.equal(result.sent, 1);
  assert.deepEqual(sent[0].targets, ["alice"]);
});
