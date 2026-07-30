import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCohortFunnels,
  aggregateOccurrenceMetrics,
  aggregateTagChanges,
  classifyReplyRisk,
  definitionSemanticHash,
  periodBounds
} from "../src/cockpit-domain.js";

const baseFlow = {
  entryNodeId: "node-1",
  nodes: [
    { id: "node-1", name: "开始", goal: "建立联系", nextNodeId: "node-2" },
    { id: "node-2", name: "邀约", goal: "完成邀约", nextNodeId: "" }
  ]
};

test("flow display renames keep semantic hash while business changes rotate it", () => {
  const renamed = {
    ...baseFlow,
    nodes: baseFlow.nodes.map((node) => (
      node.id === "node-1" ? { ...node, name: "首次沟通" } : node
    ))
  };
  const changedGoal = {
    ...baseFlow,
    nodes: baseFlow.nodes.map((node) => (
      node.id === "node-1" ? { ...node, goal: "确认预算" } : node
    ))
  };

  assert.equal(
    definitionSemanticHash("flow", baseFlow),
    definitionSemanticHash("flow", renamed)
  );
  assert.notEqual(
    definitionSemanticHash("flow", baseFlow),
    definitionSemanticHash("flow", changedGoal)
  );
});

test("tag display renames keep semantic hash while rules rotate it", () => {
  const schema = {
    groups: [{
      id: "intent",
      name: "意向",
      tags: [{ id: "high", name: "高意向", condition: "明确希望报名" }]
    }]
  };
  const renamed = {
    groups: [{
      ...schema.groups[0],
      name: "客户意向",
      tags: [{ ...schema.groups[0].tags[0], name: "A级" }]
    }]
  };
  const changed = {
    groups: [{
      ...schema.groups[0],
      tags: [{ ...schema.groups[0].tags[0], condition: "询问过价格" }]
    }]
  };

  assert.equal(
    definitionSemanticHash("tags", schema),
    definitionSemanticHash("tags", renamed)
  );
  assert.notEqual(
    definitionSemanticHash("tags", schema),
    definitionSemanticHash("tags", changed)
  );
});

test("natural periods respect Asia Shanghai calendar boundaries", () => {
  assert.deepEqual(periodBounds({
    type: "daily",
    anchor: "2026-07-30T12:00:00.000Z",
    timezone: "Asia/Shanghai"
  }), {
    start: "2026-07-29T16:00:00.000Z",
    end: "2026-07-30T16:00:00.000Z",
    label: "2026-07-30"
  });
  assert.deepEqual(periodBounds({
    type: "weekly",
    anchor: "2026-07-30T12:00:00.000Z",
    timezone: "Asia/Shanghai"
  }), {
    start: "2026-07-26T16:00:00.000Z",
    end: "2026-08-02T16:00:00.000Z",
    label: "2026-07-27 至 2026-08-02"
  });
});

test("reply risk applies node override and distinguishes never from stopped", () => {
  assert.equal(classifyReplyRisk({
    events: [
      { eventType: "friend_added", occurredAt: "2026-07-29T00:00:00.000Z" },
      { eventType: "bot_message", occurredAt: "2026-07-29T00:01:00.000Z", nodeId: "node-1" }
    ],
    now: "2026-07-30T01:00:00.000Z",
    defaultNoReplyHours: 24,
    nodeNoReplyHours: {}
  }), "never_replied");

  assert.equal(classifyReplyRisk({
    events: [
      { eventType: "customer_message", occurredAt: "2026-07-30T00:00:00.000Z" },
      { eventType: "bot_message", occurredAt: "2026-07-30T01:00:00.000Z", nodeId: "node-2" }
    ],
    now: "2026-07-30T14:00:00.000Z",
    defaultNoReplyHours: 24,
    nodeNoReplyHours: { "node-2": 12 }
  }), "stopped_replying");
});

test("occurrence metrics and cohort funnels use different customer populations", () => {
  const events = [
    { customerKey: "old", eventType: "friend_added", occurredAt: "2026-07-20T00:00:00.000Z" },
    { customerKey: "old", eventType: "successful_invitation", occurredAt: "2026-07-30T05:00:00.000Z" },
    { customerKey: "new", eventType: "friend_added", occurredAt: "2026-07-30T01:00:00.000Z" },
    { customerKey: "new", eventType: "node_reached", nodeId: "node-1", flowVersionId: 1, occurredAt: "2026-07-30T02:00:00.000Z" },
    { customerKey: "new", eventType: "node_reached", nodeId: "node-1", flowVersionId: 1, occurredAt: "2026-07-30T03:00:00.000Z" }
  ];
  const period = {
    start: "2026-07-30T00:00:00.000Z",
    end: "2026-07-31T00:00:00.000Z"
  };

  assert.equal(aggregateOccurrenceMetrics({ events, period }).successfulInvitations, 1);
  assert.deepEqual(aggregateCohortFunnels({ events, period }), [{
    flowVersionId: 1,
    cohortSize: 1,
    nodes: [{ nodeId: "node-1", reached: 1, share: 1 }]
  }]);
});

test("tag changes expose current added removed and net values", () => {
  const result = aggregateTagChanges({
    events: [
      { customerKey: "a", eventType: "tag_added", groupId: "intent", tagId: "high" },
      { customerKey: "b", eventType: "tag_added", groupId: "intent", tagId: "high" },
      { customerKey: "a", eventType: "tag_removed", groupId: "intent", tagId: "high" }
    ]
  });
  assert.deepEqual(result, [{
    groupId: "intent",
    tagId: "high",
    current: 1,
    added: 2,
    removed: 1,
    net: 1
  }]);
});

