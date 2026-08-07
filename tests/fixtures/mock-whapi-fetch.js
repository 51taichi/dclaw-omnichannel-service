const originalFetch = globalThis.fetch;

globalThis.fetch = async (resource, options = {}) => {
  const url = String(resource);
  if (url === "https://gate.whapi.cloud/messages/text") {
    const body = JSON.parse(String(options.body || "{}"));
    const rejected = body.body === "provider rejects this message";
    return new Response(JSON.stringify(rejected
      ? { sent: false, message: { status: "rejected" } }
      : { sent: true, message: { id: "manual-provider-message-1", status: "pending" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return originalFetch(resource, options);
};
