# Manual Reply Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a console-side manual text and emoji reply composer for human-handoff private conversations, with server-side WorkTool sending and durable conversation records.

**Architecture:** Add one bot-scoped manual reply API under flow sessions. The API only works for private conversations in human handoff, sends through WorkTool, and records both `conversation_messages` and `outgoing_messages`. The console renders a disabled AI takeover composer with an animated border and prompt image while AI is active, and a text + emoji composer while human handoff is active.

**Tech Stack:** Node.js ESM, Express 5, `node:sqlite`, WorkTool API helper, vanilla browser JavaScript, CSS animations, `node:test`.

## Global Constraints

- First version supports only private conversation text + emoji replies.
- Do not support image, audio, video, or file replies in this feature.
- AI takeover composer must show `public/console/assets/ai-chatting.png`.
- AI takeover composer must have a restrained animated border without layout shift.
- Remove the old standalone handoff banner text `人工接手中，AI 已暂停回复`.
- Manual reply sends must go through the server so outbound messages are recorded.
- WorkTool send failure must not create outbound conversation records.

---

### Task 1: Add Manual Reply Server Endpoint

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-handoff-boundary.test.js`

**Interfaces:**
- Produces: `POST /api/flow-sessions/:conversationKey/manual-reply`
- Consumes: `sendTextMessage`, `insertConversationMessage`, `insertOutgoingMessage`, `getFlowSession`, `getBotBinding`

- [ ] **Step 1: Write failing server boundary test**

Add assertions to `tests/server-handoff-boundary.test.js`:

```js
test("server exposes manual reply route only for human handoff", () => {
  assert.equal(serverSource.includes('"/api/flow-sessions/:conversationKey/manual-reply"'), true);
  assert.equal(serverSource.includes('handoffStatus !== "human"'), true);
  assert.equal(serverSource.includes('source: "manual_reply"'), true);
  assert.equal(serverSource.includes("sendTextMessage({"), true);
  assert.equal(serverSource.includes("insertConversationMessage({"), true);
  assert.equal(serverSource.includes("insertOutgoingMessage({"), true);
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
npm test -- tests/server-handoff-boundary.test.js
```

Expected: FAIL because the manual reply route is missing.

- [ ] **Step 3: Implement server route**

Add an Express route after the existing handoff route:

```js
app.post(
  "/api/flow-sessions/:conversationKey/manual-reply",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    const content = String(body.content || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    if (!content) throw new Error("content is required");
    if (!isPrivateConversationKey(conversationKey)) throw new Error("manual reply only supports private conversations");
    const session = getFlowSession(conversationKey);
    if (!session || session.botId !== botId) throw new Error("flow session not found");
    if (session.handoffStatus !== "human") throw new Error("manual reply requires human handoff");
    const binding = getBotBinding(botId);
    if (!binding || !binding.enabled) throw new Error("no enabled bot binding");
    const target = privateTargetNameFromConversationKey(conversationKey);
    if (!target) throw new Error("missing manual reply target");
    const result = await sendTextMessage({ robotId: botId, targets: [target], content });
    const messageId = result.data || "";
    const rawPayload = {
      source: "manual_reply",
      messageId,
      worktoolResponse: result
    };
    insertConversationMessage({
      botId,
      conversationKey,
      direction: "outbound",
      senderName: binding.botName || binding.agentName || "人工客服",
      content,
      rawPayload
    });
    insertOutgoingMessage({
      botId,
      agentId: binding.agentId,
      conversationKey,
      messageId,
      targetName: target,
      content,
      worktoolResponse: rawPayload
    });
    logInfo("manual_reply.sent", { botId, conversationKey, targetName: target, messageId });
    res.json({ ok: true, message: { direction: "outbound", senderName: binding.botName || binding.agentName || "人工客服", content, rawPayload, createdAt: new Date().toISOString() } });
  })
);
```

- [ ] **Step 4: Run server tests**

```bash
npm test -- tests/server-handoff-boundary.test.js && node --check src/server.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/server.js tests/server-handoff-boundary.test.js
git commit -m "Add manual reply server endpoint"
```

---

### Task 2: Add Console Manual Reply Composer

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `public/console/assets/ai-chatting.png`
- Test: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: manual reply API from Task 1.
- Produces: `manualReplyComposer`, `manualReplyInput`, emoji insertion, and disabled AI takeover state.

- [ ] **Step 1: Copy AI takeover image asset**

```bash
cp "/Users/moxi/Downloads/Image 19.png" public/console/assets/ai-chatting.png
```

- [ ] **Step 2: Write failing console boundary test**

Add assertions to `tests/console-handoff-boundary.test.js`:

```js
test("console has manual reply composer with AI takeover prompt and emoji tools", () => {
  assert.equal(html.includes('id="manualReplyComposer"'), true);
  assert.equal(html.includes("ai-chatting.png"), true);
  assert.equal(app.includes("sendManualReply"), true);
  assert.equal(app.includes("/manual-reply"), true);
  assert.equal(app.includes("manualReplyEmojis"), true);
  assert.equal(css.includes("@keyframes aiComposerBorderSpin"), true);
  assert.equal(css.includes(".manual-reply-composer.is-ai"), true);
  assert.equal(html.includes("handoffStatusBanner"), false);
});
```

- [ ] **Step 3: Run test and verify failure**

```bash
npm test -- tests/console-handoff-boundary.test.js
```

Expected: FAIL because composer is missing and the old banner still exists.

- [ ] **Step 4: Add composer HTML and remove old banner**

Replace the old `handoffStatusBanner` block with:

```html
<form id="manualReplyComposer" class="manual-reply-composer is-ai">
  <div class="ai-takeover-card">
    <img src="./assets/ai-chatting.png" alt="" aria-hidden="true" />
    <span>AI 正在和客户沟通中，切换人工接手后可手动回复</span>
  </div>
  <div class="manual-reply-box" hidden>
    <textarea id="manualReplyInput" rows="3" placeholder="输入人工回复，支持 emoji"></textarea>
    <div class="manual-reply-tools">
      <div id="manualReplyEmojiBar" class="manual-reply-emoji-bar"></div>
      <button id="manualReplySendButton" class="primary" type="submit">发送</button>
    </div>
  </div>
</form>
```

- [ ] **Step 5: Wire composer JavaScript**

Add refs for `manualReplyComposer`, `manualReplyInput`, `manualReplyEmojiBar`, and `manualReplySendButton`. Add `manualReplyEmojis = ["😊", "👍", "👌", "🙏", "🎉", "❤️", "😂", "🌟"]`.

Implement:

```js
function renderManualReplyComposer(session) {
  const hasSession = Boolean(session);
  const isHuman = session?.handoffStatus === "human";
  els.manualReplyComposer.hidden = !hasSession;
  els.manualReplyComposer.classList.toggle("is-human", isHuman);
  els.manualReplyComposer.classList.toggle("is-ai", hasSession && !isHuman);
  els.manualReplyInput.disabled = !isHuman;
  els.manualReplySendButton.disabled = !isHuman;
  els.manualReplyInput.placeholder = isHuman ? "输入人工回复，支持 emoji" : "AI 正在接管中";
  els.manualReplyEmojiBar.innerHTML = manualReplyEmojis.map((emoji) => `<button type="button" data-manual-emoji="${emoji}">${emoji}</button>`).join("");
  els.manualReplyEmojiBar.querySelectorAll("[data-manual-emoji]").forEach((button) => {
    button.addEventListener("click", () => insertManualReplyEmoji(button.dataset.manualEmoji));
  });
}
```

Implement `insertManualReplyEmoji(emoji)` with cursor insertion, and `sendManualReply(event)` to call:

```js
await request(`/api/flow-sessions/${encodeURIComponent(state.selectedFlowConversationKey)}/manual-reply`, {
  method: "POST",
  body: JSON.stringify({ botId: state.selectedBotId, content })
});
```

Call `renderManualReplyComposer(currentFlowSession)` from `syncHandoffButton` or after loading a session.

- [ ] **Step 6: Add CSS**

Add:

```css
.manual-reply-composer { ... }
.manual-reply-composer.is-ai::before { animation: aiComposerBorderSpin 4s linear infinite; }
@keyframes aiComposerBorderSpin { to { transform: rotate(360deg); } }
.ai-takeover-card img { width: min(220px, 45%); }
.manual-reply-box { ... }
.manual-reply-emoji-bar { ... }
```

- [ ] **Step 7: Run console tests**

```bash
npm test -- tests/console-handoff-boundary.test.js && node --check public/console/app.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css public/console/assets/ai-chatting.png tests/console-handoff-boundary.test.js
git commit -m "Add manual reply composer"
```

---

### Task 3: Final Verification

**Files:**
- No new feature files unless verification reveals issues.

**Interfaces:**
- Verifies Tasks 1 and 2 together.

- [ ] **Step 1: Run full test suite**

```bash
npm test
node --check src/server.js
node --check public/console/app.js
```

Expected: all pass.

- [ ] **Step 2: Inspect git status and push**

```bash
git status --short
git push origin main
```

Expected: clean working tree and successful push.

## Self-Review

- Spec coverage: manual reply API, private-only text + emoji, server-side recording, AI image prompt, animated border, old banner removal, and no auto-refresh are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `manual-reply`, `manualReplyComposer`, `handoffStatus`, `source: "manual_reply"` are consistent across tasks.
