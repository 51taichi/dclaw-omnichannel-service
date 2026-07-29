export function buildAgentResponseValidationOptions(request) {
  const tagContext = request?.metadata?.tagRules || null;
  return {
    requireFlowDecision: Boolean(request?.metadata?.flow)
      && request?.metadata?.eventType !== "handoff_transcript_message",
    requireReplyContent: Boolean(request?.metadata?.requireReplyContent),
    forbidGroupContextDisclosure: Boolean(request?.metadata?.groupContext),
    allowTagDecision: Boolean(tagContext),
    flow: request?.metadata?.flow || null,
    tagContext,
    tagEvidenceCandidates: request?.metadata?.tagEvidenceCandidates || []
  };
}
