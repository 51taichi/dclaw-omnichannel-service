const REQUIRED_EVENTS = Object.freeze([
  ["messages", "post"],
  ["messages", "put"],
  ["messages", "delete"],
  ["statuses", "post"],
  ["statuses", "put"],
  ["groups", "post"],
  ["groups", "put"],
  ["groups", "patch"],
  ["users", "post"],
  ["users", "delete"],
  ["channel", "post"],
  ["channel", "patch"]
]);

export function buildWhapiWebhookUrl({ publicBaseUrl, publicId }) {
  if (typeof publicId !== "string" || publicId.length === 0) {
    throw new Error("publicId is required");
  }
  const base = new URL(publicBaseUrl);
  if (base.protocol !== "https:") {
    throw new Error("Whapi webhook URL must use HTTPS");
  }
  base.search = "";
  base.hash = "";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/webhooks/whapi/${encodeURIComponent(publicId)}`;
  return base.toString();
}

export function buildWhapiWebhookSettings({ url, secret }) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Whapi webhook URL must use HTTPS");
  if (typeof secret !== "string" || secret.length === 0) throw new Error("webhook secret is required");
  return Object.freeze({
    callback_backoff_delay_ms: 3000,
    max_callback_backoff_delay_ms: 900000,
    callback_persist: true,
    media: Object.freeze({
      auto_download: Object.freeze(["image", "audio", "voice", "video", "document", "sticker"])
    }),
    webhooks: Object.freeze([Object.freeze({
      url: parsed.toString(),
      mode: "method",
      headers: Object.freeze({ "X-DClaw-Webhook-Secret": secret }),
      events: Object.freeze(REQUIRED_EVENTS.map(([type, method]) => Object.freeze({ type, method })))
    })])
  });
}
