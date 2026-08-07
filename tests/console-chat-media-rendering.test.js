import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function sourceBefore(startMarker, nextMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `${startMarker} is defined`);
  assert.notEqual(end, -1, `${startMarker} ends before ${nextMarker}`);
  return app.slice(start, end);
}

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  assert.notEqual(start, -1, `${selector} is defined`);
  assert.notEqual(end, -1, `${selector} closes its rule`);
  return css.slice(start, end + 1);
}

function renderMediaMessageBubble(message) {
  const states = sourceBefore("const manualMessageDeliveryStates =", "\n\nfunction renderManualMessageDeliveryStatus");
  const deliverySource = sourceBefore("function renderManualMessageDeliveryStatus(", "\n\nfunction renderChatMessages");
  const contentSource = sourceBefore("function renderChatMessageContent(", "\n\nfunction attachmentTypeLabel");
  const chatSource = sourceBefore("function renderChatMessages(", "\nfunction renderChatLoadingState");
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const renderChatMessageContent = Function(
    "escapeHtml",
    "renderChatSources",
    "renderChatAttachments",
    "resolveInboundImageMessage",
    "resolveInboundFileMessage",
    `${contentSource}; return renderChatMessageContent;`
  )(
    escapeHtml,
    () => "",
    () => "",
    () => null,
    () => null
  );
  const renderManualMessageDeliveryStatus = Function(
    `${states} ${deliverySource}; return renderManualMessageDeliveryStatus;`
  )();
  const chatMessages = {
    innerHTML: "",
    scrollHeight: 0,
    scrollTop: 0,
    querySelectorAll: () => []
  };
  const renderChatMessages = Function(
    "els",
    "escapeHtml",
    "formatDisplayDateTime",
    "renderChatMessageContent",
    "renderManualMessageDeliveryStatus",
    "icon",
    "requestAnimationFrame",
    "setTimeout",
    `${chatSource}; return renderChatMessages;`
  )(
    { chatMessages },
    escapeHtml,
    () => "2026-08-07 13:50",
    renderChatMessageContent,
    renderManualMessageDeliveryStatus,
    () => "",
    () => {},
    () => {}
  );

  renderChatMessages([message]);
  return chatMessages.innerHTML;
}

test("manual delivery status follows media content inside the same bounded chat bubble", () => {
  const html = renderMediaMessageBubble({
    id: "media-1",
    direction: "outbound",
    senderName: "客服",
    createdAt: "2026-08-07T13:50:00.000Z",
    deliveryStatus: "read",
    content: "",
    rawPayload: {
      source: "manual_reply",
      messageType: "media",
      messagePayload: {
        fileType: "image",
        fileUrl: "https://cdn.example.test/manual-image.jpg",
        objectName: "manual-image.jpg"
      }
    }
  });
  const bubbleStart = html.indexOf('<div class="chat-bubble">');
  const mediaStart = html.indexOf('<div class="chat-media">', bubbleStart);
  const mediaEnd = html.indexOf("</div>", mediaStart);
  const status = '<span class="manual-message-delivery-status is-read"><span aria-hidden="true">✓✓</span>已读</span>';
  const statusStart = html.indexOf(status, mediaEnd);
  const bubbleEnd = html.indexOf("</div>", statusStart);

  assert.ok(bubbleStart >= 0, "media message has a chat bubble");
  assert.ok(mediaStart > bubbleStart, "media markup stays inside the chat bubble");
  assert.match(html, /<img class="chat-media-image" src="https:\/\/cdn\.example\.test\/manual-image\.jpg"/);
  assert.ok(mediaEnd > mediaStart, "media container closes");
  assert.ok(statusStart > mediaEnd, "delivery status follows, rather than nests inside or replaces, media content");
  assert.ok(bubbleEnd > statusStart, "delivery status remains inside the chat bubble");
  assert.match(cssRule(".chat-bubble"), /max-width:\s*min\(68%,\s*520px\)/);
  assert.match(cssRule(".chat-media-image"), /max-width:\s*min\(260px,\s*100%\)/);
});
