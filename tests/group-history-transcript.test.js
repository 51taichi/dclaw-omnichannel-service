import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompactGroupTranscript,
  estimateGroupAnalysisRequestChars,
  packTranscriptChunks
} from "../src/group-history-transcript.js";

const roles = [{
  id: "role-parent",
  currentName: "张三",
  identityType: "客户",
  description: "家长"
}];

test("builds stable participant and chronological message codes with exact evidence lookup", () => {
  const built = buildCompactGroupTranscript({
    roles,
    groupBackground: "课程服务群",
    messages: [{
      id: 42,
      occurredAt: "2026-08-05T01:30:00.000Z",
      senderName: "张三",
      participantRoleId: "role-parent",
      messageType: "text",
      content: "作业已提交"
    }]
  });

  assert.match(built.header, /P1｜张三｜客户｜家长/);
  assert.equal(built.lines[0], "M001｜2026-08-05 09:30:00｜P1｜text｜作业已提交");
  assert.equal(built.evidenceMap.M001, 42);
  assert.deepEqual(built.messageIds, [42]);
});

test("escapes transcript separators and newlines and preserves empty non-text records", () => {
  const built = buildCompactGroupTranscript({
    roles: [],
    messages: [
      {
        externalMessageId: "wt-message-9",
        occurredAt: "2026-08-05T01:30:00.000Z",
        senderName: "李｜四",
        messageType: "text",
        content: "第一行\n第二｜行"
      },
      {
        externalMessageId: "wt-message-10",
        occurredAt: "2026-08-05T01:31:00.000Z",
        senderName: "李｜四",
        messageType: "image",
        content: ""
      }
    ]
  });

  assert.match(built.header, /李\\｜四/);
  assert.match(built.lines[0], /第一行\\n第二\\｜行$/);
  assert.match(built.lines[1], /\[image\]$/);
  assert.deepEqual(built.messageIds, [9, 10]);
});

test("packs deterministic bounded chunks with complete non-overlapping message coverage", () => {
  const built = buildCompactGroupTranscript({
    roles,
    groupBackground: "背景",
    messages: Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      occurredAt: new Date(Date.UTC(2026, 7, 5, 1, index)).toISOString(),
      senderName: "张三",
      participantRoleId: "role-parent",
      messageType: "text",
      content: `第${index + 1}条${"内容".repeat(40)}`
    }))
  });
  const first = packTranscriptChunks(built, { maxRequestChars: 900 });
  const second = packTranscriptChunks(built, { maxRequestChars: 900 });

  assert.deepEqual(second, first);
  assert.ok(first.length > 1);
  assert.deepEqual(first.flatMap((chunk) => chunk.messageIds), built.messageIds);
  assert.equal(new Set(first.flatMap((chunk) => chunk.messageIds)).size, built.messageIds.length);
  assert.equal(first.every((chunk) => chunk.text.length <= 900), true);
  assert.ok(estimateGroupAnalysisRequestChars({
    systemContext: "规则",
    taskContext: "任务",
    transcript: first[0].text
  }) < 12000);
});

test("supports non-default message code offsets for target-time delta history", () => {
  const built = buildCompactGroupTranscript({
    roles,
    startCode: 43,
    messages: [{
      id: 88,
      occurredAt: "2026-08-05T12:00:00.000Z",
      senderName: "张三",
      messageType: "text",
      content: "刚刚提交"
    }]
  });
  assert.match(built.lines[0], /^M043｜/);
  assert.equal(built.evidenceMap.M043, 88);
});
