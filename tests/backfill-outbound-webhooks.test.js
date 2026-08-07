import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_MESSAGE_IDS,
  backfillOutboundWebhooks,
  parseBackfillArgs
} from "../scripts/backfill-outbound-webhooks.js";
import { normalizeWhapiWebhook } from "../src/channels/whapi/mapper.js";

const approvedIds = [...APPROVED_MESSAGE_IDS];

function messageEnvelope({ id, messageId, body, timestamp }) {
  return {
    id,
    provider: "whapi",
    botId: "whatsapp-sales-01",
    channelAccountId: "HULKBR-KVR3C",
    eventKind: "messages.post",
    payload: {
      channel_id: "HULKBR-KVR3C",
      event: { type: "messages", method: "post" },
      messages: [{
        id: messageId,
        from_me: true,
        type: "link_preview",
        timestamp,
        source: "api",
        chat_id: "16464068041@s.whatsapp.net",
        from: "19542049430",
        status: "pending",
        link_preview: { body, url: "janoshik.com", title: "Just a moment..." }
      }]
    }
  };
}

function statusEnvelope({ id, messageId, status, timestamp }) {
  return {
    id,
    provider: "whapi",
    botId: "whatsapp-sales-01",
    channelAccountId: "HULKBR-KVR3C",
    eventKind: "statuses.post",
    payload: {
      channel_id: "HULKBR-KVR3C",
      event: { type: "statuses", method: "post" },
      statuses: [{
        id: messageId,
        status,
        recipient_id: "16464068041@s.whatsapp.net",
        timestamp
      }]
    }
  };
}

test("backfill arguments require the production Bot and only confirmed message IDs", () => {
  assert.deepEqual(parseBackfillArgs([
    "--bot-id", "whatsapp-sales-01",
    "--message-id", approvedIds[0],
    "--message-id", approvedIds[1]
  ]), {
    botId: "whatsapp-sales-01",
    messageIds: [approvedIds[0], approvedIds[1]]
  });
  assert.throws(() => parseBackfillArgs(["--message-id", approvedIds[0]]), /--bot-id/);
  assert.throws(() => parseBackfillArgs(["--bot-id", "whatsapp-sales-01"]), /--message-id/);
  assert.throws(() => parseBackfillArgs([
    "--bot-id", "whatsapp-sales-01",
    "--message-id", "not-approved"
  ]), /not approved/);
});

test("backfill replays confirmed messages before their statuses and is idempotent", async () => {
  const stored = new Set();
  const calls = [];
  const envelopes = [
    statusEnvelope({ id: 124, messageId: approvedIds[2], status: "read", timestamp: 1786111957 }),
    messageEnvelope({ id: 120, messageId: approvedIds[1], body: "JANOSHIK 报告", timestamp: 1786111925 }),
    messageEnvelope({ id: 119, messageId: "unapproved-id", body: "不应回填", timestamp: 1786111904 }),
    statusEnvelope({ id: 122, messageId: approvedIds[1], status: "read", timestamp: 1786111926 }),
    messageEnvelope({ id: 123, messageId: approvedIds[2], body: "验证密匙", timestamp: 1786111955 }),
    messageEnvelope({ id: 55, messageId: approvedIds[0], body: "价格表", timestamp: 1786093006 })
  ];
  const reconcile = ({ event }) => {
    const id = event.message.externalId;
    calls.push(`message:${id}`);
    if (stored.has(id)) return { outcome: "existing_outgoing" };
    stored.add(id);
    return { outcome: "inserted" };
  };
  const updateStatus = ({ messageId, status }) => calls.push(`status:${messageId}:${status}`);
  const input = {
    botId: "whatsapp-sales-01",
    messageIds: approvedIds,
    envelopes,
    normalize: (envelope) => normalizeWhapiWebhook({
      channelAccountId: envelope.channelAccountId,
      payload: envelope.payload
    }),
    reconcile,
    updateStatus
  };

  assert.deepEqual(await backfillOutboundWebhooks(input), {
    inserted: 3,
    existing: 0,
    ignored: 0
  });
  assert.ok(calls.indexOf(`message:${approvedIds[1]}`) < calls.indexOf(`status:${approvedIds[1]}:read`));
  assert.ok(calls.indexOf(`message:${approvedIds[2]}`) < calls.indexOf(`status:${approvedIds[2]}:read`));
  assert.doesNotMatch(calls.join("\n"), /unapproved-id/);

  calls.length = 0;
  assert.deepEqual(await backfillOutboundWebhooks(input), {
    inserted: 0,
    existing: 3,
    ignored: 0
  });
});

test("backfill fails when an explicitly requested message is absent from webhook history", async () => {
  await assert.rejects(
    backfillOutboundWebhooks({
      botId: "whatsapp-sales-01",
      messageIds: [approvedIds[0]],
      envelopes: [],
      normalize: () => [],
      reconcile: () => assert.fail("missing messages must not reconcile"),
      updateStatus: () => {}
    }),
    new RegExp(approvedIds[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});
