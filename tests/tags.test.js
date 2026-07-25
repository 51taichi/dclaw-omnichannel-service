import test from "node:test";
import assert from "node:assert/strict";
import {
  dateTagIdFor,
  normalizeDateTagCutoffTime,
  normalizeTagSchema,
  compactTagRulesForAgent,
  adjudicateTagDecision,
  normalizeTagDecision
} from "../src/tags.js";

test("normalizeDateTagCutoffTime returns a stable HH:mm value", () => {
  assert.equal(normalizeDateTagCutoffTime("20:00"), "20:00");
  assert.equal(normalizeDateTagCutoffTime("7:05"), "07:05");
  assert.equal(normalizeDateTagCutoffTime("24:00"), "00:00");
  assert.equal(normalizeDateTagCutoffTime(""), "00:00");
});

test("dateTagIdFor formats server date tags in Beijing time as yyyymmdd", () => {
  assert.equal(dateTagIdFor("2026-07-17T03:04:05.000Z"), "20260717");
  assert.equal(dateTagIdFor("2026-07-17T16:30:00.000Z"), "20260718");
});

test("dateTagIdFor advances the business date at the configured Beijing cutoff", () => {
  assert.equal(dateTagIdFor("2026-07-25T11:59:00.000Z", "20:00"), "20260725");
  assert.equal(dateTagIdFor("2026-07-25T12:00:00.000Z", "20:00"), "20260726");
  assert.equal(dateTagIdFor("2026-12-31T12:00:00.000Z", "20:00"), "20270101");
  assert.equal(dateTagIdFor("2026-07-25T16:30:00.000Z", "00:00"), "20260726");
});

test("normalizeTagSchema supplies cutoff defaults for legacy date tag settings", () => {
  const schema = normalizeTagSchema({
    dateTag: { enabled: true }
  });

  assert.deepEqual(schema.dateTag, {
    enabled: true,
    cutoffTime: "00:00",
    effectiveAt: ""
  });
});

test("normalizeTagSchema keeps enabled groups and normalizes activation messages", () => {
  const schema = normalizeTagSchema({
    dateTag: { enabled: true },
    groups: [
      {
        id: "intent",
        name: "意向",
        enabled: true,
        exclusive: true,
        oneWay: true,
        tags: [
          {
            id: "c",
            name: "C类",
            condition: "泛泛了解",
            activation: {
              enabled: true,
              polishByAgent: false,
              messages: [{ content: "还在吗", intervalMinutes: 2, maxTimes: 1 }]
            }
          }
        ]
      }
    ]
  });

  assert.equal(schema.dateTag.enabled, true);
  assert.equal(schema.groups[0].id, "intent");
  assert.equal(schema.groups[0].tags[0].activation.messages[0].intervalMinutes, 2);
  assert.equal(schema.groups[0].tags[0].activation.polishByAgent, false);
});

test("compactTagRulesForAgent removes activation payload and includes current tags", () => {
  const schema = normalizeTagSchema({
    groups: [
      {
        id: "intent",
        name: "意向",
        enabled: true,
        exclusive: true,
        oneWay: true,
        tags: [{ id: "b", name: "B类", condition: "询问细节" }]
      }
    ]
  });

  const rules = compactTagRulesForAgent({
    schema,
    currentTags: [{ groupId: "intent", tagId: "b", name: "B类" }]
  });

  assert.equal(rules.groups[0].tags[0].condition, "询问细节");
  assert.equal(rules.groups[0].tags[0].activation, undefined);
  assert.equal(rules.currentTags[0].tagId, "b");
});

test("adjudicateTagDecision allows one-way exclusive upgrade and cancels old tag", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      exclusive: true,
      oneWay: true,
      tags: [
        { id: "c", name: "C类", condition: "了解" },
        { id: "b", name: "B类", condition: "询问" },
        { id: "a", name: "A类", condition: "强意向" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "intent", tagId: "c", name: "C类" }],
    decision: normalizeTagDecision({ add: [{ groupId: "intent", tagId: "b", reason: "询问细节" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId), ["b"]);
  assert.equal(result.accepted[0].action, "replace");
  assert.equal(result.accepted[0].oldTagIds[0], "c");
});

test("adjudicateTagDecision rejects one-way exclusive rollback", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      exclusive: true,
      oneWay: true,
      tags: [
        { id: "c", name: "C类", condition: "了解" },
        { id: "b", name: "B类", condition: "询问" },
        { id: "a", name: "A类", condition: "强意向" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "intent", tagId: "a", name: "A类" }],
    decision: normalizeTagDecision({ add: [{ groupId: "intent", tagId: "b", reason: "回退判断" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId), ["a"]);
  assert.equal(result.rejected[0].reason, "one_way_regression");
});

test("adjudicateTagDecision can ignore one-way rules for manual overrides", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      exclusive: true,
      oneWay: true,
      tags: [
        { id: "c", name: "C类", condition: "了解" },
        { id: "b", name: "B类", condition: "询问" },
        { id: "a", name: "A类", condition: "强意向" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "intent", tagId: "a", name: "A类" }],
    decision: normalizeTagDecision({ add: [{ groupId: "intent", tagId: "b", reason: "人工修正" }] }),
    ignoreOneWay: true
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId), ["b"]);
  assert.equal(result.accepted[0].action, "replace");
  assert.deepEqual(result.accepted[0].oldTagIds, ["a"]);
});

test("adjudicateTagDecision keeps non-exclusive tags together", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "interest",
      name: "兴趣",
      exclusive: false,
      tags: [
        { id: "video", name: "想看视频", condition: "要视频" },
        { id: "price", name: "关注价格", condition: "问价格" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "interest", tagId: "video", name: "想看视频" }],
    decision: normalizeTagDecision({ add: [{ groupId: "interest", tagId: "price", reason: "问价格" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId).sort(), ["price", "video"]);
});
