const originalFetch = globalThis.fetch;
let providerAttempt = 0;

globalThis.fetch = async (resource, options = {}) => {
  const url = String(resource);
  if (url.startsWith("https://agent.example.test/api/open/v1/targets/")) {
    const request = JSON.parse(String(options.body || "{}"));
    const prompt = String(request.message || "");
    const evidenceId = prompt.match(/"customerEvidenceCandidates"[\s\S]*?"id":\s*"([^"]+)"/)?.[1] || "";
    const evidenceText = prompt.match(/"customerEvidenceCandidates"[\s\S]*?"text":\s*"([^"]+)"/)?.[1] || "";
    return new Response(JSON.stringify({
      reply: "我先给您参考，稍后再确认。",
      attachments: [],
      sources: [],
      attentionAlert: {
        required: true,
        reason: "需要人工确认",
        evidenceMessageId: evidenceId,
        evidenceText
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === "https://gate.whapi.cloud/messages/text") {
    providerAttempt += 1;
    if (process.env.ATTENTION_TEST_FAIL_FIRST_SEND === "true" && providerAttempt === 1) {
      return new Response(JSON.stringify({ message: "temporary" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      sent: true,
      message: { id: `attention-provider-${providerAttempt}`, status: "pending" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(resource, options);
};
