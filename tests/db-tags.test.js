import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConversationTagChanges,
  cancelTagActivationTasks,
  claimDueTagActivationTasks,
  getAgentTagSchema,
  listConversationTags,
  listTagActivationTasks,
  markTagActivationTaskFailed,
  markTagActivationTaskSent,
  scheduleTagActivationTask,
  upsertConversation,
  upsertAgentTagSchema,
  upsertSystemDateTag
} from "../src/db.js";
import { dateTagIdFor } from "../src/tags.js";

test("agent tag schemas are stored by agent id", () => {
  const schema = upsertAgentTagSchema({
    agentId: "tag_agent_a",
    schema: {
      dateTag: { enabled: true },
      groups: [{ id: "intent", name: "意向", tags: [{ id: "a", name: "A类", condition: "强意向" }] }]
    }
  });

  assert.equal(schema.agentId, "tag_agent_a");
  assert.equal(getAgentTagSchema("tag_agent_a").config.groups[0].id, "intent");
  assert.equal(getAgentTagSchema("missing_agent"), null);
});

test("conversation tags are isolated by bot agent and conversation", () => {
  applyConversationTagChanges({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三",
    accepted: [{ action: "add", groupId: "intent", tagId: "a", reason: "强意向", oldTagIds: [], newTagIds: ["a"] }],
    nextTags: [{ groupId: "intent", groupName: "意向", tagId: "a", tagName: "A类", reason: "强意向" }],
    source: "agent_decision"
  });

  assert.equal(listConversationTags({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三"
  })[0].tagId, "a");
  assert.deepEqual(listConversationTags({
    botId: "tag_bot_a",
    agentId: "other_agent",
    conversationKey: "tag_bot_a:private:张三"
  }), []);
});

test("private conversations receive one stable Beijing date tag from first persistence", () => {
  const botId = "date_first_seen_bot";
  const agentId = "date_first_seen_agent";
  const conversationKey = `${botId}:private:首次客户`;
  upsertAgentTagSchema({ agentId, schema: { dateTag: { enabled: true }, groups: [] } });

  const first = upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "首次客户", groupName: "首次客户" }
  });
  const expectedDateTagId = dateTagIdFor(first.createdAt);
  assert.deepEqual(
    listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date")
      .map((tag) => tag.tagId),
    [expectedDateTagId]
  );

  const repeated = upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "首次客户", groupName: "首次客户" }
  });
  assert.equal(repeated.createdAt, first.createdAt);
  assert.deepEqual(
    listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date")
      .map((tag) => tag.tagId),
    [expectedDateTagId]
  );
});

test("saving an enabled date tag schema backfills existing private conversations only", () => {
  const scope = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const botId = `date_backfill_bot_${scope}`;
  const agentId = `date_backfill_agent_${scope}`;
  const privateKey = `${botId}:private:历史客户`;
  const groupKey = `${botId}:group:历史群`;
  const privateConversation = upsertConversation({
    botId,
    agentId,
    conversationKey: privateKey,
    message: { roomType: 2, receivedName: "历史客户", groupName: "历史客户" }
  });
  upsertConversation({
    botId,
    agentId,
    conversationKey: groupKey,
    message: { roomType: 1, receivedName: "群成员", groupName: "历史群" }
  });

  assert.deepEqual(listConversationTags({ botId, agentId, conversationKey: privateKey }), []);
  upsertAgentTagSchema({ agentId, schema: { dateTag: { enabled: true }, groups: [] } });

  assert.equal(
    listConversationTags({ botId, agentId, conversationKey: privateKey })
      .find((tag) => tag.tagType === "date")?.tagId,
    dateTagIdFor(privateConversation.createdAt)
  );
  assert.deepEqual(listConversationTags({ botId, agentId, conversationKey: groupKey }), []);
});

test("system date updates replace an old date instead of creating a second date tag", () => {
  const scope = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const botId = `date_replace_bot_${scope}`;
  const agentId = `date_replace_agent_${scope}`;
  const conversationKey = `${botId}:private:重新添加客户`;

  upsertSystemDateTag({ botId, agentId, conversationKey, dateTagId: "20260717" });
  upsertSystemDateTag({ botId, agentId, conversationKey, dateTagId: "20260718" });

  assert.deepEqual(
    listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date")
      .map((tag) => tag.tagId),
    ["20260718"]
  );
});

test("tag activation tasks can be scheduled claimed and finalized", () => {
  const task = scheduleTagActivationTask({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三",
    groupId: "intent",
    tagId: "a",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "还想了解吗", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z",
    attemptNumber: 1,
    messageIndex: 0
  });

  assert.equal(task.status, "pending");
  const claimed = claimDueTagActivationTasks({ nowIso: "2026-07-17T00:00:01.000Z", limit: 5 });
  assert.equal(claimed.some((item) => item.id === task.id), true);
  const sent = markTagActivationTaskSent({ id: task.id, worktoolMessageIds: ["msg_1"] });
  assert.equal(sent.status, "sent");
});

test("cancelTagActivationTasks cancels pending tag work", () => {
  const task = scheduleTagActivationTask({
    botId: "tag_bot_b",
    agentId: "tag_agent_b",
    conversationKey: "tag_bot_b:private:李四",
    groupId: "intent",
    tagId: "b",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "继续了解吗", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });

  cancelTagActivationTasks({
    botId: "tag_bot_b",
    agentId: "tag_agent_b",
    conversationKey: "tag_bot_b:private:李四",
    groupId: "intent",
    tagId: "b",
    reason: "tag_removed"
  });

  assert.equal(listTagActivationTasks({
    botId: "tag_bot_b",
    agentId: "tag_agent_b",
    conversationKey: "tag_bot_b:private:李四"
  }).find((item) => item.id === task.id).status, "canceled");
});

test("tag activation task listing is isolated by bot agent and conversation", () => {
  const conversationKey = "shared:private:王五";
  const first = scheduleTagActivationTask({
    botId: "tag_scope_bot_a",
    agentId: "tag_scope_agent_a",
    conversationKey,
    groupId: "intent",
    tagId: "a",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "A", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });
  const otherAgent = scheduleTagActivationTask({
    botId: "tag_scope_bot_a",
    agentId: "tag_scope_agent_b",
    conversationKey,
    groupId: "intent",
    tagId: "b",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "B", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });
  const otherBot = scheduleTagActivationTask({
    botId: "tag_scope_bot_b",
    agentId: "tag_scope_agent_a",
    conversationKey,
    groupId: "intent",
    tagId: "c",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "C", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });

  const scoped = listTagActivationTasks({
    botId: "tag_scope_bot_a",
    agentId: "tag_scope_agent_a",
    conversationKey
  });

  assert.equal(scoped.some((item) => item.id === first.id), true);
  assert.equal(scoped.some((item) => item.id === otherAgent.id), false);
  assert.equal(scoped.some((item) => item.id === otherBot.id), false);
});

test("tag activation task listing requires full scope", () => {
  assert.throws(
    () => listTagActivationTasks({ conversationKey: "shared:private:王五" }),
    /botId, agentId, and conversationKey/
  );
});

test("saving tag schema cancels obsolete pending work without touching valid or sent tasks", () => {
  const botId = "tag_schema_cleanup_bot";
  const agentId = "tag_schema_cleanup_agent";
  const conversationKey = `${botId}:private:标签保存客户`;

  upsertAgentTagSchema({
    agentId,
    schema: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [
          {
            id: "a",
            name: "A类",
            condition: "高意向",
            activation: {
              enabled: true,
              polishByAgent: false,
              messages: [{ content: "A follow", intervalMinutes: 10, maxTimes: 1 }]
            }
          },
          {
            id: "b",
            name: "B类",
            condition: "中意向",
            activation: {
              enabled: true,
              polishByAgent: false,
              messages: [{ content: "B follow", intervalMinutes: 10, maxTimes: 1 }]
            }
          }
        ]
      }]
    }
  });

  const validTask = scheduleTagActivationTask({
    botId,
    agentId,
    conversationKey,
    groupId: "intent",
    tagId: "a",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "A follow", intervalMinutes: 10, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:10:00.000Z"
  });
  const obsoleteTask = scheduleTagActivationTask({
    botId,
    agentId,
    conversationKey,
    groupId: "intent",
    tagId: "b",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "B follow", intervalMinutes: 10, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:10:00.000Z"
  });
  const sentTask = scheduleTagActivationTask({
    botId,
    agentId,
    conversationKey,
    groupId: "intent",
    tagId: "b",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "B sent", intervalMinutes: 10, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });
  claimDueTagActivationTasks({ nowIso: "2026-07-17T00:00:01.000Z", limit: 10 });
  markTagActivationTaskSent({ id: sentTask.id, worktoolMessageIds: ["already_sent"] });

  upsertAgentTagSchema({
    agentId,
    schema: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [
          {
            id: "a",
            name: "A类",
            condition: "高意向",
            activation: {
              enabled: true,
              polishByAgent: false,
              messages: [{ content: "A follow", intervalMinutes: 10, maxTimes: 1 }]
            }
          },
          {
            id: "b",
            name: "B类",
            condition: "中意向",
            activation: {
              enabled: false,
              messages: [{ content: "B follow", intervalMinutes: 10, maxTimes: 1 }]
            }
          }
        ]
      }]
    }
  });

  const tasks = listTagActivationTasks({ botId, agentId, conversationKey });
  assert.equal(tasks.find((task) => task.id === validTask.id).status, "pending");
  assert.equal(tasks.find((task) => task.id === obsoleteTask.id).status, "canceled");
  assert.equal(tasks.find((task) => task.id === obsoleteTask.id).cancelReason, "tag_schema_saved");
  assert.equal(tasks.find((task) => task.id === sentTask.id).status, "sent");
});
