import { recordAttentionAlertOccurrence } from "./db.js";

export function applyAgentAttentionAlert({
  botId,
  binding,
  conversationKey,
  conversationEpoch,
  customerName = "",
  agentReply,
  evidenceCandidates = [],
  recordOccurrence = recordAttentionAlertOccurrence
}) {
  const decision = agentReply?.attentionAlert;
  if (decision?.required !== true) return null;
  const evidenceId = String(decision.evidenceMessageId || "").trim();
  const evidence = evidenceCandidates.find((candidate) =>
    String(candidate?.id || "").trim() === evidenceId
    && String(candidate?.text || "").trim() === String(decision.evidenceText || "").trim()
  );
  const conversationMessageId = Number(evidence?.conversationMessageId);
  if (!evidence || !Number.isInteger(conversationMessageId) || conversationMessageId <= 0) {
    throw new Error("attention alert evidence is invalid");
  }
  return recordOccurrence({
    botId,
    agentId: binding.agentId,
    conversationKey,
    conversationEpoch,
    customerName,
    reason: decision.reason,
    evidenceMessageId: conversationMessageId,
    evidenceText: evidence.text
  });
}
