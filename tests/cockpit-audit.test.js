import assert from "node:assert/strict";
import test from "node:test";
import { auditCockpitSnapshot } from "../src/cockpit-audit.js";

function snapshot(overrides = {}) {
  return {
    metrics: {
      newCustomers: 10,
      neverReplied: 2,
      stoppedReplying: 3,
      effectiveConversations: 5,
      customerMessages: 8,
      replyMessages: 12
    },
    charts: {
      nodeDistribution: [
        { nodeId: "one", reached: 6, share: 0.6 },
        { nodeId: "two", reached: 4, share: 0.4 }
      ],
      tags: []
    },
    ...overrides
  };
}

test("valid cockpit snapshot passes all audit checks", () => {
  const audit = auditCockpitSnapshot(snapshot());
  assert.equal(audit.status, "verified");
  assert.equal(audit.checks.every((check) => check.passed), true);
  assert.deepEqual(audit.warnings, []);
});

test("communication outcomes must equal new customers", () => {
  const input = snapshot();
  input.metrics.effectiveConversations = 4;
  const audit = auditCockpitSnapshot(input);
  assert.equal(audit.status, "failed");
  assert.equal(audit.checks.find((check) => check.key === "communication_outcomes")?.passed, false);
});

test("non-empty node shares must total one", () => {
  const input = snapshot();
  input.charts.nodeDistribution[1].share = 0.2;
  const audit = auditCockpitSnapshot(input);
  assert.equal(audit.status, "failed");
  assert.equal(audit.checks.find((check) => check.key === "node_distribution")?.passed, false);
});

test("negative cockpit counts fail validation", () => {
  const input = snapshot();
  input.metrics.replyMessages = -1;
  const audit = auditCockpitSnapshot(input);
  assert.equal(audit.status, "failed");
  assert.match(audit.warnings.join(" "), /replyMessages/);
});
