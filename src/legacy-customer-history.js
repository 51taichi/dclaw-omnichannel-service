import { buildLegacyHistoryContext, createKeyedSingleFlight } from "./legacy-history.js";

function uniqueNames(names) {
  return [...new Set(
    names.map((name) => String(name || "").trim()).filter(Boolean)
  )];
}

function importedCustomerTitle(message) {
  const raw = message?.rawPayload || {};
  return String(
    message?.title
    || raw.title
    || raw.titleList
    || raw.row?.titleList
    || ""
  ).trim();
}

function normalizeCustomerMessages(messages, fallbackTitle) {
  return (messages || []).map((message) => ({
    ...message,
    senderName: message.senderName || message.title || fallbackTitle
  }));
}

function normalizeCachedApiMessages(messages) {
  return (messages || []).map((message) => ({
    ...message,
    sourceKey: [
      message.messageId || "",
      Number(message.commandIndex || 0),
      message.targetName || ""
    ].join(":"),
    direction: "outbound",
    senderName: message.targetName || ""
  }));
}

export function createLegacyCustomerHistoryService({
  listCustomerHistory,
  createLegacyFlowSession,
  updateLegacyHistorySync,
  insertImportedConversationMessages,
  listImportedConversationMessages,
  listConversationMessages,
  listCachedApiMessages,
  listLegacyFlowSessionTargets,
  yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve)),
  backfillBatchSize = 25,
  onEvent = () => {}
}) {
  const singleFlight = createKeyedSingleFlight();

  async function performPrepare({ botId, conversationKey, title, machine }) {
    const startedAt = Date.now();
    createLegacyFlowSession({ botId, conversationKey, machine });
    onEvent("start", { botId, conversationKey, title });

    try {
      const history = await listCustomerHistory({ robotId: botId, title });
      const aliases = uniqueNames([title, ...(history.titles || [])]);
      const customerMessages = normalizeCustomerMessages(history.messages, title);
      insertImportedConversationMessages({
        botId,
        conversationKey,
        source: "worktool_customer_history",
        messages: customerMessages
      });

      const cachedApiMessages = normalizeCachedApiMessages(
        listCachedApiMessages({ botId, targetNames: aliases })
      );
      if (cachedApiMessages.length) {
        insertImportedConversationMessages({
          botId,
          conversationKey,
          source: "worktool_api_history",
          messages: cachedApiMessages
        });
      }

      const importedCustomerCount = listImportedConversationMessages({
        botId,
        conversationKey
      }).filter((message) => message.source === "worktool_customer_history").length;
      const status = importedCustomerCount > 0 ? "success" : "empty";
      updateLegacyHistorySync({
        botId,
        conversationKey,
        status,
        importedCount: importedCustomerCount
      });
      const result = {
        status,
        aliases,
        importedCustomerCount,
        rawCount: Number(history.rawCount || 0),
        durationMs: Date.now() - startedAt
      };
      onEvent(status, { botId, conversationKey, title, ...result });
      return result;
    } catch (error) {
      const errorMessage = String(error?.message || error || "legacy history sync failed");
      updateLegacyHistorySync({
        botId,
        conversationKey,
        status: "failed",
        importedCount: 0,
        errorMessage
      });
      const result = {
        status: "failed",
        aliases: uniqueNames([title]),
        importedCustomerCount: 0,
        rawCount: 0,
        durationMs: Date.now() - startedAt,
        errorMessage
      };
      onEvent("failed", { botId, conversationKey, title, ...result });
      return result;
    }
  }

  function buildStoredLegacyContext({ botId, conversationKey }) {
    const imported = listImportedConversationMessages({ botId, conversationKey });
    const localMessages = listConversationMessages({ botId, conversationKey })
      .filter((message) => message.source === "local");
    return buildLegacyHistoryContext({
      customerMessages: imported.filter(
        (message) => message.source === "worktool_customer_history"
      ),
      localMessages,
      cachedApiMessages: imported.filter(
        (message) => message.source === "worktool_api_history"
      )
    });
  }

  async function backfillCachedHistoryForBot({ botId }) {
    const targets = listLegacyFlowSessionTargets({ botId });
    let importedCount = 0;
    const normalizedBatchSize = Math.max(1, Number(backfillBatchSize) || 25);
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const imported = listImportedConversationMessages({
        botId,
        conversationKey: target.conversationKey
      });
      const aliases = uniqueNames([
        target.receivedName,
        ...imported
          .filter((message) => message.source === "worktool_customer_history")
          .map(importedCustomerTitle)
      ]);
      const cached = normalizeCachedApiMessages(
        listCachedApiMessages({ botId, targetNames: aliases })
      );
      if (cached.length) {
        importedCount += insertImportedConversationMessages({
          botId,
          conversationKey: target.conversationKey,
          source: "worktool_api_history",
          messages: cached
        });
      }
      if ((index + 1) % normalizedBatchSize === 0 && index + 1 < targets.length) {
        await yieldToEventLoop();
      }
    }
    return { conversationCount: targets.length, importedCount };
  }

  return {
    prepareLegacyCustomer(input) {
      return singleFlight.run(input.conversationKey, () => performPrepare(input));
    },
    buildStoredLegacyContext,
    backfillCachedHistoryForBot
  };
}
