import assert from "node:assert/strict";
import test from "node:test";

import { createGroupHistorySyncWorker } from "../src/group-history-sync-worker.js";

function historyMessage(overrides = {}) {
  return {
    id: 7,
    botId: "bot-1",
    conversationKey: "bot:bot-1:group:group-1",
    direction: "inbound",
    senderName: "张三",
    content: "今天的作业完成了",
    rawPayload: { messageId: "worktool-7", textType: 1, privateField: "never-export" },
    source: "local",
    sourceKey: "",
    createdAt: "2026-08-05T01:00:00.000Z",
    ...overrides
  };
}

function syncJob(overrides = {}) {
  return {
    botId: "bot-1",
    groupId: "group-1",
    conversationKey: "bot:bot-1:group:group-1",
    groupName: "作业群",
    syncedThroughMessageId: 0,
    requestedThroughMessageId: 7,
    status: "processing",
    attempts: 0,
    ...overrides
  };
}

function createDb(overrides = {}) {
  const state = {
    syncedThroughMessageId: 0,
    requestedThroughMessageId: 0,
    status: "idle"
  };
  return {
    state,
    getLatestGroupConversationMessageIdAtOrBefore: () => 7,
    enqueueGroupHistorySync: ({ throughMessageId }) => {
      state.requestedThroughMessageId = Math.max(state.requestedThroughMessageId, throughMessageId);
      state.status = "pending";
      return { ...syncJob(), ...state };
    },
    claimGroupHistorySyncJobs: () => [],
    heartbeatGroupHistorySyncJob: () => ({ ...syncJob(), ...state }),
    listCanonicalGroupMessagesForHistory: () => ({
      messages: [historyMessage()],
      processedThroughMessageId: 7,
      hasMore: false
    }),
    completeGroupHistorySyncBatch: ({ syncedThroughMessageId }) => {
      state.syncedThroughMessageId = syncedThroughMessageId;
      state.status = "idle";
      return { ...syncJob(), ...state };
    },
    failGroupHistorySyncJob: () => {
      state.status = "retry_wait";
      return { ...syncJob(), ...state };
    },
    getGroupHistorySyncState: () => ({ ...syncJob(), ...state }),
    listGroupRoles: () => [{
      id: "role-zhang",
      currentName: "张老师",
      aliases: ["张三"]
    }],
    ...overrides
  };
}

test("wake enqueues the exact persisted cutoff and a tick exports canonical messages with role identity", async () => {
  const enqueued = [];
  const appended = [];
  const completed = [];
  const db = createDb({
    enqueueGroupHistorySync: (input) => {
      enqueued.push(input);
      return syncJob({ requestedThroughMessageId: input.throughMessageId, status: "pending" });
    },
    claimGroupHistorySyncJobs: ({ owner, limit }) => {
      assert.equal(owner, "worker-a");
      assert.equal(limit, 3);
      return [syncJob()];
    },
    listCanonicalGroupMessagesForHistory: (input) => {
      assert.deepEqual(input, {
        botId: "bot-1",
        groupId: "group-1",
        afterMessageId: 0,
        throughMessageId: 7,
        limit: 200
      });
      return {
        messages: [historyMessage()],
        processedThroughMessageId: 7,
        hasMore: false
      };
    },
    completeGroupHistorySyncBatch: (input) => {
      completed.push(input);
      return syncJob({ syncedThroughMessageId: 7, status: "idle" });
    }
  });
  const worker = createGroupHistorySyncWorker({
    db,
    resolveDclawBinding: () => ({ agentApiUrl: "https://dclaw.test/api/open/v1/targets/p/messages", agentApiKey: "secret" }),
    probeCapability: async () => ({ ready: true, status: 200, reason: "" }),
    appendHistory: async (input) => appended.push(input),
    now: () => new Date("2026-08-05T02:00:00.000Z")
  });

  await worker.wake({ botId: "bot-1", groupId: "group-1" });
  const result = await worker.runTick({ owner: "worker-a", limit: 3 });

  assert.deepEqual(enqueued, [{ botId: "bot-1", groupId: "group-1", throughMessageId: 7 }]);
  assert.equal(result.completed, 1);
  assert.equal(appended.length, 1);
  assert.match(appended[0].externalGroupId, /^wt-g-[a-f0-9]{32}$/);
  assert.deepEqual(appended[0].messages, [{
    externalMessageId: "wt-message-7",
    occurredAt: "2026-08-05T01:00:00.000Z",
    senderId: "",
    senderName: "张三",
    participantRoleId: "role-zhang",
    direction: "inbound",
    source: "local",
    messageType: "1",
    content: "今天的作业完成了",
    metadata: { sourceMessageId: "worktool-7", textType: 1 }
  }]);
  assert.equal(completed[0].syncedThroughMessageId, 7);
});

test("failed or partially accepted appends retain the cursor and retry the same idempotent records", async () => {
  let claims = 0;
  let appendAttempts = 0;
  const failures = [];
  const completions = [];
  const db = createDb({
    claimGroupHistorySyncJobs: () => claims++ < 2 ? [syncJob()] : [],
    failGroupHistorySyncJob: (input) => {
      failures.push(input);
      return syncJob({ status: "retry_wait", attempts: 1 });
    },
    completeGroupHistorySyncBatch: (input) => {
      completions.push(input);
      return syncJob({ syncedThroughMessageId: 7, status: "idle" });
    }
  });
  const worker = createGroupHistorySyncWorker({
    db,
    resolveDclawBinding: () => ({ agentApiUrl: "https://dclaw.test/messages", agentApiKey: "secret" }),
    probeCapability: async () => ({ ready: true, status: 200, reason: "" }),
    appendHistory: async ({ messages }) => {
      appendAttempts += 1;
      assert.equal(messages[0].externalMessageId, "wt-message-7");
      if (appendAttempts === 1) throw new Error("connection lost after remote accept");
    },
    now: () => new Date("2026-08-05T02:00:00.000Z")
  });

  const first = await worker.runTick({ owner: "worker-a", limit: 1 });
  const second = await worker.runTick({ owner: "worker-a", limit: 1 });

  assert.equal(first.failed, 1);
  assert.equal(second.completed, 1);
  assert.equal(failures.length, 1);
  assert.equal(completions.length, 1);
  assert.equal(appendAttempts, 2);
});

test("missing bindings and unavailable capabilities fail safely without leaking message bodies to logs", async () => {
  const events = [];
  for (const scenario of [
    { binding: null, capability: null, expected: /binding unavailable/ },
    { binding: { agentApiUrl: "https://dclaw.test/messages" }, capability: { ready: false, status: 403, reason: "forbidden" }, expected: /403/ },
    { binding: { agentApiUrl: "https://dclaw.test/messages" }, capability: { ready: false, status: 404, reason: "unavailable" }, expected: /404/ }
  ]) {
    let failedInput = null;
    const db = createDb({
      claimGroupHistorySyncJobs: () => [syncJob()],
      failGroupHistorySyncJob: (input) => {
        failedInput = input;
        return syncJob({ status: "retry_wait", attempts: 1 });
      }
    });
    const worker = createGroupHistorySyncWorker({
      db,
      resolveDclawBinding: () => scenario.binding,
      probeCapability: async () => scenario.capability,
      appendHistory: async () => assert.fail("append must not run"),
      now: () => new Date("2026-08-05T02:00:00.000Z"),
      logger: {
        info: (event, fields) => events.push({ event, fields }),
        warn: (event, fields) => events.push({ event, fields }),
        error: (event, fields) => events.push({ event, fields })
      }
    });

    await worker.runTick({ owner: "worker-a", limit: 1 });
    assert.match(String(failedInput.error), scenario.expected);
  }

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /今天的作业完成了|privateField|secret/);
  assert.match(serialized, /group_history\.sync\.(?:failed|lag)/);
});

test("lease loss after append never advances the local sync cursor", async () => {
  let failCalled = false;
  const db = createDb({
    claimGroupHistorySyncJobs: () => [syncJob()],
    completeGroupHistorySyncBatch: () => {
      throw new Error("group history sync lease is not owned");
    },
    failGroupHistorySyncJob: () => {
      failCalled = true;
      throw new Error("group history sync lease is not owned");
    }
  });
  const worker = createGroupHistorySyncWorker({
    db,
    resolveDclawBinding: () => ({ agentApiUrl: "https://dclaw.test/messages" }),
    probeCapability: async () => ({ ready: true, status: 200, reason: "" }),
    appendHistory: async () => {},
    now: () => new Date("2026-08-05T02:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });

  const result = await worker.runTick({ owner: "worker-a", limit: 1 });

  assert.equal(result.failed, 1);
  assert.equal(failCalled, true);
  assert.equal(db.state.syncedThroughMessageId, 0);
});

test("ensureSyncedThrough waits until the exact requested cutoff is durably completed", async () => {
  let claimable = false;
  const db = createDb({
    enqueueGroupHistorySync: ({ throughMessageId }) => {
      db.state.requestedThroughMessageId = throughMessageId;
      db.state.status = "pending";
      claimable = true;
      return { ...syncJob(), ...db.state };
    },
    claimGroupHistorySyncJobs: () => {
      if (!claimable) return [];
      claimable = false;
      return [syncJob({ requestedThroughMessageId: 7 })];
    }
  });
  const worker = createGroupHistorySyncWorker({
    db,
    resolveDclawBinding: () => ({ agentApiUrl: "https://dclaw.test/messages" }),
    probeCapability: async () => ({ ready: true, status: 200, reason: "" }),
    appendHistory: async () => {},
    now: () => new Date("2026-08-05T02:00:00.000Z"),
    sleep: async () => {}
  });

  const result = await worker.ensureSyncedThrough({
    botId: "bot-1",
    groupId: "group-1",
    throughMessageId: 7,
    deadlineAt: "2026-08-05T02:01:00.000Z"
  });

  assert.equal(result.ready, true);
  assert.equal(result.syncedThroughMessageId, 7);
});
