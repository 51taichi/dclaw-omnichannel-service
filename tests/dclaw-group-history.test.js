import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDclawGroupHistory,
  buildDclawGroupHistoryId,
  buildDclawGroupHistoryUrl,
  listDclawGroupHistory,
  probeDclawGroupHistoryCapability
} from "../src/dclaw-group-history.js";

const binding = {
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
  agentApiKey: "test-key"
};

test("builds stable ASCII group history identities and target URLs", () => {
  const first = buildDclawGroupHistoryId({ botId: "bot 中文", groupId: "群/AAA" });
  const repeated = buildDclawGroupHistoryId({ botId: "bot 中文", groupId: "群/AAA" });
  const other = buildDclawGroupHistoryId({ botId: "bot 中文", groupId: "群/BBB" });

  assert.equal(repeated, first);
  assert.match(first, /^wt-g-[a-f0-9]{32}$/);
  assert.notEqual(other, first);
  assert.equal(
    buildDclawGroupHistoryUrl(binding, "群/AAA"),
    "https://dclaw.example.test/api/open/v1/targets/demo/group-histories/%E7%BE%A4%2FAAA/messages"
  );
});

test("appends history with authorization and maps immutable fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ history_id: "history-1", inserted: 1, duplicates: 0 });
  };

  const result = await appendDclawGroupHistory({
    binding,
    externalGroupId: "wtg-abc",
    messages: [{
      externalMessageId: "wt-message-7",
      occurredAt: "2026-08-05T01:00:00.000Z",
      senderId: "user-7",
      senderName: "张三",
      participantRoleId: "role-7",
      direction: "inbound",
      source: "worktool_local",
      messageType: "text",
      content: "完成了",
      metadata: { fileName: "", rawPayload: { private: true } }
    }],
    fetchImpl,
    maxAttempts: 1
  });

  assert.deepEqual(result, {
    historyId: "history-1",
    inserted: 1,
    duplicates: 0,
    batches: 1
  });
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(calls[0].body.messages[0], {
    external_message_id: "wt-message-7",
    occurred_at: "2026-08-05T01:00:00.000Z",
    sender_id: "user-7",
    sender_name: "张三",
    participant_role_id: "role-7",
    direction: "inbound",
    source: "worktool_local",
    message_type: "text",
    content: "完成了",
    metadata: { fileName: "" }
  });
});

test("splits append batches by record count and serialized bytes", async () => {
  const batchSizes = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    batchSizes.push({
      count: body.messages.length,
      bytes: Buffer.byteLength(options.body, "utf8")
    });
    return Response.json({
      history_id: "history-1",
      inserted: body.messages.length,
      duplicates: 0
    });
  };
  const messages = Array.from({ length: 205 }, (_, index) => ({
    externalMessageId: `wt-message-${index + 1}`,
    occurredAt: "2026-08-05T01:00:00.000Z",
    senderName: "张三",
    direction: "inbound",
    source: "worktool_local",
    messageType: "text",
    content: index < 170 ? "文".repeat(6_000) : "完成了"
  }));

  const result = await appendDclawGroupHistory({
    binding,
    externalGroupId: "wtg-abc",
    messages,
    fetchImpl,
    maxAttempts: 1
  });

  assert.equal(result.inserted, 205);
  assert.ok(batchSizes.length >= 2);
  assert.ok(batchSizes.every((batch) => batch.count <= 200));
  assert.ok(batchSizes.every((batch) => batch.bytes <= 1_000_000));
});

test("lists a bounded history page and maps snake case response", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.method, "GET");
    return Response.json({
      messages: [{
        external_message_id: "wt-message-7",
        occurred_at: "2026-08-05T01:00:00Z",
        sender_id: "user-7",
        sender_name: "张三",
        participant_role_id: "role-7",
        direction: "inbound",
        source: "worktool_local",
        message_type: "text",
        content: "完成了",
        metadata: { fileName: "" }
      }],
      next_cursor: "cursor-2",
      has_more: true
    });
  };

  const page = await listDclawGroupHistory({
    binding,
    externalGroupId: "wtg-abc",
    from: "2026-08-01T00:00:00.000Z",
    until: "2026-08-05T02:00:00.000Z",
    after: "cursor-1",
    limit: 20,
    fetchImpl,
    maxAttempts: 1
  });

  assert.match(requestedUrl, /from=2026-08-01T00%3A00%3A00.000Z/);
  assert.match(requestedUrl, /until=2026-08-05T02%3A00%3A00.000Z/);
  assert.match(requestedUrl, /after=cursor-1/);
  assert.match(requestedUrl, /limit=20/);
  assert.deepEqual(page, {
    messages: [{
      externalMessageId: "wt-message-7",
      occurredAt: "2026-08-05T01:00:00Z",
      senderId: "user-7",
      senderName: "张三",
      participantRoleId: "role-7",
      direction: "inbound",
      source: "worktool_local",
      messageType: "text",
      content: "完成了",
      metadata: { fileName: "" }
    }],
    nextCursor: "cursor-2",
    hasMore: true
  });
});

test("reports capability authorization and route availability distinctly", async () => {
  for (const [status, reason] of [[401, "unauthorized"], [403, "forbidden"], [404, "unavailable"]]) {
    const result = await probeDclawGroupHistoryCapability({
      binding,
      fetchImpl: async () => new Response("no", { status }),
      maxAttempts: 1
    });
    assert.deepEqual(result, { ready: false, status, reason });
  }
  const ready = await probeDclawGroupHistoryCapability({
    binding,
    fetchImpl: async () => Response.json({ messages: [], next_cursor: null, has_more: false }),
    maxAttempts: 1
  });
  assert.deepEqual(ready, { ready: true, status: 200, reason: "" });
});

test("retries retryable gateway failures but not invalid responses", async () => {
  let attempts = 0;
  const recovered = await probeDclawGroupHistoryCapability({
    binding,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("bad gateway", { status: 502 });
      return Response.json({ messages: [], next_cursor: null, has_more: false });
    },
    maxAttempts: 2
  });
  assert.equal(recovered.ready, true);
  assert.equal(attempts, 2);

  await assert.rejects(
    listDclawGroupHistory({
      binding,
      externalGroupId: "wtg-abc",
      fetchImpl: async () => Response.json({ messages: "invalid" }),
      maxAttempts: 2
    }),
    /messages must be an array/
  );
});

test("retries the TypeError emitted by fetch transport failures", async () => {
  let attempts = 0;
  const result = await probeDclawGroupHistoryCapability({
    binding,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return Response.json({ messages: [], next_cursor: null, has_more: false });
    },
    maxAttempts: 2
  });

  assert.equal(result.ready, true);
  assert.equal(attempts, 2);
});
