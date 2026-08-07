import { pathToFileURL } from "node:url";

import { normalizeWhapiWebhook } from "../src/channels/whapi/mapper.js";
import { reconcileOutboundWebhookMessage } from "../src/outbound-webhook-reconciliation.js";

export const APPROVED_MESSAGE_IDS = Object.freeze([
  "Psq87jVFbilb.xs-wNID1VW9yQ",
  "PsqlbmrN6JN3Z0M-wFwD1VW9yQ",
  "PspJAVWgozw4Nyg-wOAD1VW9yQ"
]);

const approvedMessageIds = new Set(APPROVED_MESSAGE_IDS);

export function parseBackfillArgs(args = []) {
  let botId = "";
  const messageIds = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = String(args[index + 1] || "").trim();
    if (flag === "--bot-id") {
      if (!value) throw new Error("--bot-id requires a value");
      botId = value;
      index += 1;
      continue;
    }
    if (flag === "--message-id") {
      if (!value) throw new Error("--message-id requires a value");
      if (!approvedMessageIds.has(value)) throw new Error(`message ID is not approved: ${value}`);
      messageIds.push(value);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${flag}`);
  }
  if (!botId) throw new Error("--bot-id is required");
  if (!messageIds.length) throw new Error("at least one --message-id is required");
  return { botId, messageIds: [...new Set(messageIds)] };
}

export async function backfillOutboundWebhooks({
  botId,
  messageIds,
  envelopes,
  normalize,
  reconcile,
  updateStatus,
  onResult = null
}) {
  const requested = new Set(messageIds);
  const summary = { inserted: 0, existing: 0, ignored: 0 };
  const ordered = [...envelopes]
    .filter((envelope) => envelope.state === "completed")
    .sort((left, right) => Number(left.id) - Number(right.id));
  const replayEvents = [];

  for (const envelope of ordered) {
    const events = normalize(envelope);
    for (const event of events) {
      const messageId = event?.message?.externalId;
      if (!requested.has(messageId)) continue;
      replayEvents.push(event);
    }
  }

  const found = new Set(replayEvents
    .filter((event) => event.eventType === "message.sent")
    .map((event) => event.message.externalId));
  const missing = [...requested].filter((messageId) => !found.has(messageId));
  if (missing.length) throw new Error(`requested messages not found in completed webhook history: ${missing.join(", ")}`);

  const reconciled = new Set();
  for (const event of replayEvents) {
    const messageId = event.message.externalId;
    if (event.eventType === "message.sent") {
      if (!reconciled.has(messageId)) {
        reconciled.add(messageId);
        const result = await reconcile({ botId, event });
        if (result.outcome === "inserted") summary.inserted += 1;
        else if (["existing_outgoing", "existing_conversation"].includes(result.outcome)) {
          summary.existing += 1;
        } else {
          summary.ignored += 1;
        }
        onResult?.({ messageId, outcome: result.outcome });
      }
      continue;
    }
    if (event.eventType.startsWith("status.")) {
      updateStatus({
        botId,
        provider: event.provider,
        channelAccountId: event.channelAccountId,
        messageId,
        status: event.message.text,
        errorMessage: event.message.text === "failed" ? "provider_rejected" : ""
      });
    }
  }
  return summary;
}

async function main() {
  const { botId, messageIds } = parseBackfillArgs(process.argv.slice(2));
  const db = await import("../src/db.js");
  const binding = db.getBotBinding(botId);
  const summary = await backfillOutboundWebhooks({
    botId,
    messageIds,
    envelopes: db.listChannelWebhookEvents(botId),
    normalize: (envelope) => normalizeWhapiWebhook({
      channelAccountId: envelope.channelAccountId,
      payload: envelope.payload
    }),
    reconcile: ({ event }) => reconcileOutboundWebhookMessage({
      botId,
      event,
      senderName: binding?.botName || binding?.agentName || "机器人",
      persist: db.persistReconciledOutboundMessage
    }),
    updateStatus: db.updateOutgoingMessageChannelStatus,
    onResult: ({ messageId, outcome }) => console.log(`${messageId}: ${outcome}`)
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
