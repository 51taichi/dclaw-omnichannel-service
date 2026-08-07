import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} is defined`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `${selector} closes its rule`);
  return css.slice(start, end + 1);
}

function sourceBlock(startMarker) {
  const start = app.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} is defined`);
  const open = app.indexOf("{", start);
  assert.notEqual(open, -1, `${startMarker} opens a block`);
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  assert.fail(`${startMarker} closes its block`);
}

function deliveryStatusRenderer() {
  const states = sourceBlock("const manualMessageDeliveryStates =");
  const rendererStart = app.indexOf("function renderManualMessageDeliveryStatus(");
  const rendererEnd = app.indexOf("\n}\n\nfunction renderChatMessages", rendererStart);
  assert.notEqual(rendererStart, -1, "renderManualMessageDeliveryStatus is defined");
  assert.notEqual(rendererEnd, -1, "renderManualMessageDeliveryStatus closes before chat rendering");
  const renderer = app.slice(rendererStart, rendererEnd + 2);
  return Function(`${states}); ${renderer}; return renderManualMessageDeliveryStatus;`)();
}

test("manual WhatsApp replies render the fixed delivery-status whitelist", () => {
  const render = deliveryStatusRenderer();
  const message = {
    direction: "outbound",
    rawPayload: { source: "manual_reply" }
  };
  const expectedLabels = {
    pending: "发送中",
    sent: "已发送",
    delivered: "已送达",
    read: "已读",
    played: "已播放",
    failed: "发送失败"
  };
  const expectedStates = {
    pending: { mark: "", tone: "pending" },
    sent: { mark: "✓", tone: "sent" },
    delivered: { mark: "✓✓", tone: "delivered" },
    read: { mark: "✓✓", tone: "read" },
    played: { mark: "", tone: "read" },
    failed: { mark: "!", tone: "failed" }
  };

  for (const [status, label] of Object.entries(expectedLabels)) {
    const html = render({ ...message, deliveryStatus: status.toUpperCase() });
    assert.equal(
      html,
      `<span class="manual-message-delivery-status is-${expectedStates[status].tone}"><span aria-hidden="true">${expectedStates[status].mark}</span>${label}</span>`
    );
  }
});

test("delivery status is rendered only for outbound manual replies and ignores unknown values", () => {
  const render = deliveryStatusRenderer();

  assert.equal(render({ direction: "inbound", rawPayload: { source: "manual_reply" }, deliveryStatus: "read" }), "");
  assert.equal(render({ direction: "outbound", rawPayload: { source: "ai_reply" }, deliveryStatus: "read" }), "");
  assert.equal(render({ direction: "outbound", rawPayload: { source: "manual_reply" }, deliveryStatus: "unexpected" }), "");
  assert.equal(render({ direction: "outbound", rawPayload: { source: "manual_reply" } }), "");

  const chatRendererStart = app.indexOf("function renderChatMessages(");
  const chatRendererEnd = app.indexOf("\nfunction renderChatLoadingState", chatRendererStart);
  assert.notEqual(chatRendererStart, -1, "renderChatMessages is defined");
  assert.notEqual(chatRendererEnd, -1, "renderChatMessages closes before its next renderer");
  const chatRenderer = app.slice(chatRendererStart, chatRendererEnd);
  assert.match(chatRenderer, /renderManualMessageDeliveryStatus\(message\)/);
});

test("delivery-status presentation is compact and does not add status polling", () => {
  const statusRule = cssRule(".manual-message-delivery-status");
  const readRule = cssRule(".manual-message-delivery-status.is-read");
  const failedRule = cssRule(".manual-message-delivery-status.is-failed");

  assert.match(statusRule, /justify-content:\s*flex-end/);
  assert.match(statusRule, /font-size:\s*10px/);
  assert.match(readRule, /color:\s*#2187d7/);
  assert.match(failedRule, /color:\s*color-mix\(in srgb, var\(--danger\)/);
  assert.equal((app.match(/\bsetInterval\(/g) || []).length, 2);
  assert.doesNotMatch(app, /delivery[-A-Za-z_]*status[^\n]*\brequest\(/i);
  assert.doesNotMatch(app, /new\s+EventSource\s*\(/);
  assert.doesNotMatch(app, /new\s+WebSocket\s*\(/);
});
