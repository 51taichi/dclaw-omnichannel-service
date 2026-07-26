import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTagEvaluation,
  validateTagAuditContract
} from "../src/tag-audit.js";

const evidenceCandidates = [{
  id: "1013",
  text: "如果请假会扣钱吗"
}];

const tagContext = {
  groups: [{
    id: "intent",
    exclusive: true,
    oneWay: true,
    tags: [{ id: "c" }, { id: "b" }]
  }],
  currentTags: [{ groupId: "intent", tagId: "c" }]
};

function positiveB() {
  return {
    groupId: "intent",
    tagId: "b",
    matched: true,
    reason: "提出咨询问题",
    evidenceMessageId: "1013",
    evidenceText: "如果请假会扣钱吗"
  };
}

test("normalizes tag evaluation aliases without coercing matched", () => {
  assert.deepEqual(normalizeTagEvaluation([{
    group_id: " intent ",
    tag_id: " b ",
    matched: true,
    reason: " 提出问题 ",
    evidence_message_id: " 1013 ",
    evidence_text: " 如果请假会扣钱吗 "
  }]), [{
    groupId: "intent",
    tagId: "b",
    matched: true,
    reason: "提出问题",
    evidenceMessageId: "1013",
    evidenceText: "如果请假会扣钱吗"
  }]);
});

test("complete audit requires B to be added when C is active", () => {
  const result = validateTagAuditContract({
    evaluation: [
      { groupId: "intent", tagId: "c", matched: false, reason: "未回答问题" },
      positiveB()
    ],
    decision: {
      add: [{
        groupId: "intent",
        tagId: "b",
        reason: "提出咨询问题",
        evidenceMessageId: "1013",
        evidenceText: "如果请假会扣钱吗"
      }],
      remove: []
    },
    tagContext,
    evidenceCandidates
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.evaluations[1].matched, true);
});

test("rejects missing, duplicate, and unknown tag evaluations", () => {
  const missing = validateTagAuditContract({
    evaluation: [{ groupId: "intent", tagId: "c", matched: false, reason: "未命中" }],
    decision: { add: [], remove: [] },
    tagContext,
    evidenceCandidates
  });
  assert.match(missing.errors[0].message, /tag 'intent:b' was not evaluated/);

  const invalid = validateTagAuditContract({
    evaluation: [
      { groupId: "intent", tagId: "c", matched: false, reason: "未命中" },
      { groupId: "intent", tagId: "c", matched: false, reason: "重复" },
      { groupId: "other", tagId: "x", matched: false, reason: "未知" },
      positiveB()
    ],
    decision: { add: [{ groupId: "intent", tagId: "b" }], remove: [] },
    tagContext,
    evidenceCandidates
  });
  assert.ok(invalid.errors.some((error) => /evaluated more than once/.test(error.message)));
  assert.ok(invalid.errors.some((error) => /is not configured/.test(error.message)));
});

test("rejects non-boolean matches and mismatched positive evidence", () => {
  const result = validateTagAuditContract({
    evaluation: [
      { groupId: "intent", tagId: "c", matched: "false", reason: "未命中" },
      {
        ...positiveB(),
        evidenceMessageId: "999",
        evidenceText: "改写后的客户原话"
      }
    ],
    decision: { add: [{ groupId: "intent", tagId: "b" }], remove: [] },
    tagContext,
    evidenceCandidates
  });

  assert.ok(result.errors.some((error) => error.path === "tagEvaluation[0].matched"));
  assert.ok(result.errors.some((error) => /not in tagEvidenceCandidates/.test(error.message)));
});

test("negative evaluations cannot claim evidence", () => {
  const result = validateTagAuditContract({
    evaluation: [
      {
        groupId: "intent",
        tagId: "c",
        matched: false,
        reason: "未命中",
        evidenceMessageId: "1013",
        evidenceText: "如果请假会扣钱吗"
      },
      { groupId: "intent", tagId: "b", matched: false, reason: "未命中" }
    ],
    decision: { add: [], remove: [] },
    tagContext,
    evidenceCandidates
  });

  assert.ok(result.errors.some((error) => /must be empty when matched=false/.test(error.message)));
});

test("rejects an empty decision when an exclusive winner should advance", () => {
  const result = validateTagAuditContract({
    evaluation: [
      { groupId: "intent", tagId: "c", matched: true, reason: "基础意向", ...evidenceCandidates[0], evidenceMessageId: "1013", evidenceText: evidenceCandidates[0].text },
      positiveB()
    ],
    decision: { add: [], remove: [] },
    tagContext,
    evidenceCandidates
  });

  assert.ok(result.errors.some((error) => /matched tag 'intent:b' must appear in tagDecision.add/.test(error.message)));
});

test("one-way groups do not require a lower matched tag to replace the current tag", () => {
  const result = validateTagAuditContract({
    evaluation: [
      {
        groupId: "intent",
        tagId: "c",
        matched: true,
        reason: "基础意向",
        evidenceMessageId: "1013",
        evidenceText: evidenceCandidates[0].text
      },
      { groupId: "intent", tagId: "b", matched: false, reason: "未命中" }
    ],
    decision: { add: [], remove: [] },
    tagContext: {
      ...tagContext,
      currentTags: [{ groupId: "intent", tagId: "b" }]
    },
    evidenceCandidates
  });

  assert.deepEqual(result.errors, []);
});

test("non-exclusive matched tags require additions unless already active", () => {
  const context = {
    groups: [{
      id: "interest",
      exclusive: false,
      oneWay: false,
      tags: [{ id: "math" }, { id: "english" }]
    }],
    currentTags: [{ groupId: "interest", tagId: "math" }]
  };
  const evaluation = [
    {
      groupId: "interest",
      tagId: "math",
      matched: true,
      reason: "咨询数学",
      evidenceMessageId: "1013",
      evidenceText: evidenceCandidates[0].text
    },
    {
      groupId: "interest",
      tagId: "english",
      matched: true,
      reason: "咨询英语",
      evidenceMessageId: "1013",
      evidenceText: evidenceCandidates[0].text
    }
  ];

  const missing = validateTagAuditContract({
    evaluation,
    decision: { add: [], remove: [] },
    tagContext: context,
    evidenceCandidates
  });
  assert.ok(missing.errors.some((error) => /interest:english/.test(error.message)));

  const complete = validateTagAuditContract({
    evaluation,
    decision: { add: [{ groupId: "interest", tagId: "english" }], remove: [] },
    tagContext: context,
    evidenceCandidates
  });
  assert.deepEqual(complete.errors, []);
});

test("tag decisions cannot add an unknown or negatively evaluated tag", () => {
  const result = validateTagAuditContract({
    evaluation: [
      { groupId: "intent", tagId: "c", matched: false, reason: "未命中" },
      { groupId: "intent", tagId: "b", matched: false, reason: "未命中" }
    ],
    decision: {
      add: [
        { groupId: "intent", tagId: "b" },
        { groupId: "unknown", tagId: "x" }
      ],
      remove: []
    },
    tagContext,
    evidenceCandidates
  });

  assert.ok(result.errors.some((error) => /does not have a positive evaluation/.test(error.message)));
  assert.ok(result.errors.some((error) => /is not configured/.test(error.message)));
});
