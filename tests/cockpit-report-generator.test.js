import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleCockpitReport,
  createCockpitReportGenerator,
  validateCockpitReportAnalysis
} from "../src/cockpit-report-generator.js";

const snapshot = {
  id: 7,
  botId: "bot-a",
  periodType: "daily",
  periodStart: "2026-07-29T00:00:00.000Z",
  periodEnd: "2026-07-30T00:00:00.000Z",
  metrics: { newCustomers: 12, successfulInvitations: 3 },
  charts: { funnels: [], tags: [] }
};

test("report document keeps statistics authoritative and accepts evidence-bound analysis", () => {
  const analysis = validateCockpitReportAnalysis({
    executiveSummary: "新增客户稳定，邀约仍有提升空间。",
    problems: [{ title: "邀约转化偏低", evidence: ["metric:successfulInvitations"] }],
    actions: [{ title: "优化首轮邀约话术", evidence: ["metric:newCustomers"] }]
  }, snapshot);
  const document = assembleCockpitReport({ snapshot, analysis });
  assert.deepEqual(document.statistics, snapshot.metrics);
  assert.equal(document.analysis.problems[0].title, "邀约转化偏低");
});

test("analysis rejects invented evidence references", () => {
  assert.throws(() => validateCockpitReportAnalysis({
    executiveSummary: "test",
    problems: [{ title: "bad", evidence: ["customer:secret"] }],
    actions: []
  }, snapshot), /evidence/);
});

test("AI failure still saves a usable statistical report", async () => {
  const saved = [];
  const generator = createCockpitReportGenerator({
    invokeAnalysis: async () => { throw new Error("AI unavailable"); },
    saveReport: async (report) => {
      saved.push(report);
      return { id: 9, ...report };
    }
  });
  const report = await generator.generate({ snapshot });
  assert.equal(report.status, "ready_with_ai_error");
  assert.equal(report.document.statistics.newCustomers, 12);
  assert.match(report.aiError, /AI unavailable/);
  assert.equal(saved.length, 1);
});
