import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBoundedCustomerHistoryText,
  normalizeHistoryAnalysisConfig
} from "../src/history-analysis.js";

function inbound(content, createdAt, overrides = {}) {
  return {
    direction: "inbound",
    source: "worktool_customer_history",
    content,
    createdAt,
    ...overrides
  };
}

test("normalizes the per-Bot history character budget", () => {
  assert.deepEqual(normalizeHistoryAnalysisConfig({}), {
    historyCustomerTextMaxChars: 4000
  });
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: 50 })
      .historyCustomerTextMaxChars,
    1000
  );
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: 9000 })
      .historyCustomerTextMaxChars,
    6000
  );
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: 4250.4 })
      .historyCustomerTextMaxChars,
    4300
  );
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: "" })
      .historyCustomerTextMaxChars,
    4000
  );
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: null })
      .historyCustomerTextMaxChars,
    4000
  );
  for (const invalidValue of [false, true, [4250], { value: 4250 }]) {
    assert.equal(
      normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: invalidValue })
        .historyCustomerTextMaxChars,
      4000
    );
  }
});

test("selects newest customer messages but renders them chronologically", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 7,
    messages: [
      inbound("第一条", "2026-07-01T00:00:00.000Z"),
      inbound("第二条", "2026-07-02T00:00:00.000Z"),
      inbound("第三条", "2026-07-03T00:00:00.000Z")
    ]
  });

  assert.equal(result.text, "第二条\n第三条");
  assert.equal(result.selectedCount, 2);
  assert.equal(result.omittedCount, 1);
  assert.equal(result.selectedChars, 7);
  assert.equal(result.importedCustomerCount, 3);
  assert.equal(result.earliestCustomerAt, "2026-07-01T00:00:00.000Z");
});

test("stops instead of skipping or truncating the first message that exceeds the remaining budget", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 6,
    messages: [
      inbound("更早", "2026-07-01T00:00:00.000Z"),
      inbound("太长太长太长", "2026-07-02T00:00:00.000Z"),
      inbound("最新", "2026-07-03T00:00:00.000Z")
    ]
  });

  assert.equal(result.text, "最新");
  assert.equal(result.selectedCount, 1);
  assert.equal(result.omittedCount, 2);
});

test("keeps customer media placeholders and excludes outbound or unrelated rows", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 100,
    messages: [
      inbound("[图片消息]", "2026-07-01T00:00:00.000Z"),
      inbound("机器人回复", "2026-07-02T00:00:00.000Z", { direction: "outbound" }),
      inbound("本地消息", "2026-07-03T00:00:00.000Z", { source: "local" }),
      inbound("   ", "2026-07-04T00:00:00.000Z")
    ]
  });

  assert.equal(result.text, "[图片消息]");
  assert.equal(result.importedCustomerCount, 1);
  assert.equal(result.omittedCount, 0);
});

test("counts emoji as one Unicode code point", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 3,
    messages: [
      inbound("旧", "2026-07-01T00:00:00.000Z"),
      inbound("😀好", "2026-07-02T00:00:00.000Z")
    ]
  });

  assert.equal(result.text, "😀好");
  assert.equal(result.selectedChars, 2);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.omittedCount, 1);
});

test("ignores invalid timestamps when determining the earliest customer date", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 100,
    messages: [
      inbound("无效时间", "not-a-date"),
      inbound("有效时间", "2026-07-02T00:00:00.000Z")
    ]
  });

  assert.equal(result.earliestCustomerAt, "2026-07-02T00:00:00.000Z");
});
