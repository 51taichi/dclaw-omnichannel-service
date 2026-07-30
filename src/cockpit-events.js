const counterByEventType = Object.freeze({
  friend_added: "new_customer",
  successful_invitation: "successful_invitation",
  effective_conversation: "effective_conversation"
});

function normalizedKeyPart(value) {
  return encodeURIComponent(String(value || "").trim());
}

export function cockpitEventKey({
  botId,
  eventType,
  sourceType,
  sourceId
}) {
  return [
    normalizedKeyPart(botId),
    normalizedKeyPart(eventType),
    normalizedKeyPart(sourceType),
    normalizedKeyPart(sourceId)
  ].join(":");
}

export function createCockpitEventRecorder({
  appendEvent,
  incrementCounter,
  logWarn
}) {
  function record(input) {
    try {
      const occurredAt = String(input.occurredAt || new Date().toISOString());
      const result = appendEvent({
        eventKey: cockpitEventKey(input),
        botId: input.botId,
        conversationKey: input.conversationKey || "",
        customerKey: input.customerKey || "",
        eventType: input.eventType,
        occurredAt,
        receivedAt: input.receivedAt || new Date().toISOString(),
        flowVersionId: input.flowVersionId ?? null,
        tagVersionId: input.tagVersionId ?? null,
        payload: input.payload || {},
        sourceRef: {
          type: input.sourceType,
          id: input.sourceId
        }
      });
      const metricKey = counterByEventType[input.eventType];
      if (result?.inserted && metricKey) {
        incrementCounter({
          botId: input.botId,
          localDate: occurredAt.slice(0, 10),
          metricKey,
          amount: 1
        });
      }
    } catch (error) {
      logWarn("cockpit.event.failed", {
        botId: input?.botId || "",
        eventType: input?.eventType || "",
        error
      });
    }
  }

  return { record };
}
