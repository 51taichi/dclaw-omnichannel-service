const COUNT_METRICS = [
  "newCustomers",
  "effectiveConversations",
  "customerMessages",
  "replyMessages",
  "neverReplied",
  "stoppedReplying",
  "waiting",
  "handoffs"
];

function finiteNonNegative(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0;
}

export function auditCockpitSnapshot(snapshot = {}) {
  const metrics = snapshot.metrics || {};
  const nodes = Array.isArray(snapshot.charts?.nodeDistribution)
    ? snapshot.charts.nodeDistribution
    : [];
  const warnings = [];

  const invalidMetrics = COUNT_METRICS.filter((key) => !finiteNonNegative(metrics[key]));
  if (invalidMetrics.length) {
    warnings.push(`指标不能为负数或非数字：${invalidMetrics.join(", ")}`);
  }

  const newCustomers = Number(metrics.newCustomers || 0);
  const outcomeTotal = Number(metrics.neverReplied || 0)
    + Number(metrics.stoppedReplying || 0)
    + Number(metrics.effectiveConversations || 0);
  const communicationPassed = finiteNonNegative(outcomeTotal)
    && outcomeTotal === newCustomers;
  if (!communicationPassed) {
    warnings.push(`沟通结果合计 ${outcomeTotal} 与新增客户 ${newCustomers} 不一致`);
  }

  const nodeShares = nodes.map((node) => Number(node.share || 0));
  const nodeShareTotal = nodeShares.reduce((sum, share) => sum + share, 0);
  const nodePassed = nodes.length === 0 || (
    nodes.every((node, index) => finiteNonNegative(node.reached) && finiteNonNegative(nodeShares[index]))
    && Math.abs(nodeShareTotal - 1) <= 0.002
  );
  if (!nodePassed) {
    warnings.push(`任务节点占比合计 ${(nodeShareTotal * 100).toFixed(1)}%，应为 100%`);
  }

  const checks = [
    { key: "non_negative_metrics", passed: invalidMetrics.length === 0 },
    { key: "communication_outcomes", passed: communicationPassed },
    { key: "node_distribution", passed: nodePassed }
  ];
  return {
    status: checks.every((check) => check.passed) ? "verified" : "failed",
    checks,
    warnings
  };
}
