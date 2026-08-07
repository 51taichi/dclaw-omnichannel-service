const originalFetch = globalThis.fetch;
let mediaMessageCounter = 0;

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
  if (/^https:\/\/gate\.whapi\.cloud\/messages\/(image|video|audio|document)$/.test(url)) {
    const rejected = String(options.body || "").includes("reject.pdf");
    if (rejected) {
      return new Response(JSON.stringify({ sent: false, message: { status: "rejected" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    mediaMessageCounter += 1;
    return new Response(JSON.stringify({
      sent: true,
      message: { id: `manual-provider-media-${mediaMessageCounter}`, status: "pending" }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return originalFetch(resource, options);
};
