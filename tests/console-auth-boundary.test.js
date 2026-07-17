import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console header uses the AI sales and customer service platform title", () => {
  assert.equal(html.includes("微信AI销售客服管理中台"), true);
  assert.equal(html.includes("AI销售/客服机器人管理中台"), false);
  assert.equal(html.includes("微信机器人管理控制台"), false);
  assert.equal(html.includes('aria-label="微信"'), true);
  assert.equal(html.includes('aria-label="企业微信"'), true);
  assert.match(html, /class="platform-logo wechat"[\s\S]*src="\.\/assets\/wechat\.png"/);
  assert.match(html, /class="platform-logo wecom"[\s\S]*src="\.\/assets\/compay_wechat\.png"/);
  assert.equal(css.includes(".topbar-platforms"), true);
  assert.equal(css.includes(".platform-logo.wechat"), true);
  assert.equal(css.includes(".platform-logo.wecom"), true);
  assert.match(css, /\.platform-logo\s*\{[\s\S]*width:\s*42px[\s\S]*height:\s*42px[\s\S]*border-radius:\s*12px[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.platform-logo img\s*\{[\s\S]*width:\s*29px[\s\S]*height:\s*29px/);
});

test("console has unified unlock and relock controls", () => {
  assert.equal(html.includes("unlockDialog"), true);
  assert.equal(html.includes("unlockKeyInput"), true);
  assert.equal(html.includes("lockBotButton"), true);
  assert.equal(html.includes('id="icon-unlock"'), true);
  assert.match(html, /id="unlockDialog"[\s\S]*?<use href="#icon-unlock"><\/use>/);
  assert.equal(app.includes("/api/public/bots"), true);
  assert.equal(app.includes("/unlock"), true);
  assert.equal(app.includes("lockCurrentBot"), true);
});

test("console stores bot scoped tokens and sends x-bot-session-token", () => {
  assert.equal(app.includes("worktool_console_bot_sessions"), true);
  assert.equal(app.includes('"x-bot-session-token"'), true);
  assert.equal(app.includes("state.currentRole"), true);
});

test("console header actions do not show the current bot status label", () => {
  assert.equal(html.includes("bindingState"), false);
  assert.equal(html.includes("当前Bot："), false);
  assert.equal(app.includes("bindingState"), false);
  assert.equal(app.includes("当前Bot："), false);
  assert.equal(css.includes(".binding-state"), false);
});

test("console hides config tab for bot role and exposes access-key reset for admin", () => {
  assert.equal(html.includes("accessKeyForm"), true);
  assert.equal(html.includes('data-workspace-tab="agents"'), false);
  assert.equal(html.includes("agentForm"), true);
  assert.equal(html.includes("agentsList"), true);
  assert.match(html, /id="configTab"[\s\S]*id="agentManagementPanel"[\s\S]*id="flowTab"/);
  assert.match(html, /id="agentManagementPanel" class="panel bot-context-panel collapsible-panel"/);
  assert.match(html, /id="agentManagementPanel"[\s\S]*data-collapse-target="agentManagementPanel"/);
  assert.equal(app.includes("syncRoleVisibility"), true);
  assert.equal(app.includes("shouldHideConfigTab"), true);
  assert.equal(app.includes("isAdminWorkspaceTab"), false);
  assert.equal(app.includes('els.workspaceTabBar?.classList.toggle("is-config-hidden", hideConfig)'), true);
  assert.equal(app.includes('document.querySelector(\'[data-workspace-tab="config"]\')?.toggleAttribute("hidden", hideConfig)'), true);
  assert.equal(app.includes('document.querySelector("#configTab")?.toggleAttribute("hidden", hideConfig)'), true);
  assert.equal(app.includes("els.agentManagementPanel.hidden = !hasBot || !isAdmin"), true);
  assert.equal(app.includes('switchWorkspaceTab("sessions", { force: true })'), true);
  assert.equal(app.includes("state.currentRole === \"admin\""), true);
  assert.equal(app.includes("/access-key"), true);
  assert.equal(css.includes(".bot-card.is-locked"), true);
  assert.equal(css.includes('.workspace-tabs.is-config-hidden [data-workspace-tab="config"]'), true);
  assert.equal(css.includes("display: none !important"), true);
});

test("bot binding form selects a saved agent instead of storing agent credentials", () => {
  const botFormStart = html.indexOf('<form id="botForm"');
  const botFormEnd = html.indexOf("</form>", botFormStart);
  const botForm = html.slice(botFormStart, botFormEnd);

  assert.match(botForm, /<select name="agentId" required>/);
  assert.equal(botForm.includes('name="dclawBaseUrl"'), false);
  assert.equal(botForm.includes('name="dclawPublicId"'), false);
  assert.equal(botForm.includes('name="agentApiKey"'), false);
  assert.equal(app.includes("/api/agents"), true);
  assert.equal(app.includes("renderAgents"), true);
  assert.equal(app.includes("renderAgentOptions"), true);
  assert.equal(app.includes("`${agent.agentName} (${agent.agentId})`"), false);
  assert.equal(css.includes("#botForm.form-grid"), true);
  assert.equal(app.includes("data-agent-delete"), true);
  assert.equal(app.includes("deleteAgent(agent)"), true);
  assert.equal(app.includes("删除 Agent 需要管理员密码"), true);
  assert.match(app, /class="danger" data-agent-delete/);
});

test("agent cards hide base url and enabled status tag", () => {
  assert.equal(app.includes('Public ID：${escapeHtml(agent.dclawPublicId || "-")}'), true);
  assert.equal(app.includes("已绑定 Bot：${boundCount}"), true);
  assert.equal(app.includes('escapeHtml(agent.dclawBaseUrl || "-")'), false);
  assert.equal(app.includes('${agent.enabled ? "启用" : "停用"}'), false);
  assert.doesNotMatch(app, /class="pill \$\{agent\.enabled \? "ok" : "off"\}/);
});

test("config saves can request admin password on demand", () => {
  assert.equal(html.includes("unlockKeyLabel"), true);
  assert.equal(app.includes("openAdminKeyDialog"), true);
  assert.equal(app.includes("promptAdminHeaders"), true);
  assert.equal(app.includes("保存 Bot 配置需要管理员密码"), true);
  assert.equal(app.includes("修改 Bot 密钥需要管理员密码"), true);
  assert.equal(app.includes('return { "x-api-key": adminKey }'), true);
  assert.equal(app.includes("ensureAdminBotSession"), true);
  assert.equal(app.includes("acceptUnlockDialog"), true);
  assert.equal(app.includes("state.unlockMode === \"admin\""), true);
});

test("bot cards expose four unlocked quick actions", () => {
  assert.equal(app.includes('data-action="${unlocked ? "tasks" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "sessions" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "push" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "logs" : "unlock"}'), true);
});

test("admin bot cards expose a dangerous delete action with password confirmation", () => {
  assert.equal(app.includes('session?.role === "admin"'), true);
  assert.equal(app.includes('data-action="delete"'), true);
  assert.equal(app.includes('class="danger bot-delete-button"'), true);
  assert.equal(app.includes("<span>删除</span>"), true);
  assert.equal(app.includes('async function deleteBot(bot)'), true);
  assert.equal(app.includes("删除 Bot 需要管理员密码"), true);
  assert.equal(app.includes("确认删除该 Bot 及其所有数据？此操作不可恢复。"), true);
  assert.match(app, /request\(`\/api\/bots\/\$\{encodeURIComponent\(botId\)\}`,\s*\{[\s\S]*method:\s*"DELETE"/);
  assert.match(app, /clearBotSession\(botId\);[\s\S]*resetBotContext\(\);[\s\S]*loadBots\(\)/);
  assert.match(css, /\.bot-delete-button\s*\{[\s\S]*color:\s*var\(--danger\)/);
});

test("locked bot quick actions use lock icons", () => {
  assert.equal(app.includes('icon(unlocked ? "edit" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "users" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "send" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "eye" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "edit" : "link")'), false);
});

test("lock and reset return to unselected config context", () => {
  assert.equal(app.includes("function resetBotContext()"), true);
  assert.equal(app.includes("clearBotSession(botId);"), true);
  assert.equal(app.includes("resetBotContext();"), true);
  assert.equal(app.includes('switchWorkspaceTab("config", { force: true });'), true);
  assert.equal(app.includes("const hideConfig = shouldHideConfigTab();"), true);
});

test("locked bot cards never show using status", () => {
  assert.equal(app.includes('const botStatusText = !unlocked ? "已上锁"'), true);
  assert.equal(app.includes('const botStatusClass = !unlocked ? "off"'), true);
  assert.equal(app.includes("bot-lock-mask"), true);
  assert.equal(app.includes('${icon("lock")}'), true);
  assert.equal(css.includes(".bot-card.is-locked .bot-lock-mask"), true);
  assert.equal(css.includes(".bot-card.is-locked .bot-identity-content"), true);
});

test("locked bot status pill uses dark gray styling", () => {
  assert.match(css, /\.pill\.off\s*\{[\s\S]*color:\s*#4b5563;/);
  assert.match(css, /\.pill\.off\s*\{[\s\S]*background:\s*#e5e7eb;/);
});

test("unselected unlocked bot cards keep their own accent color", () => {
  assert.match(css, /\.bot-card\.is-unlocked\s*\{[\s\S]*?border-left-color: var\(--bot-accent\);/);
  assert.match(css, /\.bot-card\.is-unlocked:not\(\.is-selected\)\s*\{[\s\S]*?background: color-mix\(in srgb, var\(--bot-accent\) 5%, #ffffff\);/);
  assert.match(css, /\.bot-card\.is-unlocked:hover\s*\{[\s\S]*?border-color: color-mix\(in srgb, var\(--bot-accent\) 48%, var\(--line\)\);/);
});

test("admin bot context loads full binding before filling config form", () => {
  const applyStart = app.indexOf("async function applyBotContext");
  const applyEnd = app.indexOf("function openUnlockDialog", applyStart);
  const body = app.slice(applyStart, applyEnd);
  assert.match(body, /const data = await request\("\/api\/bots"\)/);
  assert.match(body, /activeBot = currentBots\.find\(\(item\) => item\.botId === bot\.botId\) \|\| bot/);
  assert.match(body, /fillForm\(activeBot\)/);
  assert.equal(body.indexOf('const data = await request("/api/bots")') < body.indexOf("fillForm(activeBot)"), true);
});

test("bot card quick actions let applyBotContext own form synchronization", () => {
  const renderStart = app.indexOf("function renderBots");
  const renderEnd = app.indexOf("let currentBots", renderStart);
  const body = app.slice(renderStart, renderEnd);
  assert.equal(body.includes("fillForm(bot);"), false);
  assert.match(body, /await applyBotContext\(bot\)/);
});

test("switching bots clears old scoped content before loading the new bot", () => {
  const applyStart = app.indexOf("async function applyBotContext");
  const applyEnd = app.indexOf("function openUnlockDialog", applyStart);
  const body = app.slice(applyStart, applyEnd);

  assert.match(body, /const contextVersion = beginBotContext\(\);/);
  assert.match(body, /clearBotScopedContent\(\);/);
  assert.equal(body.indexOf("clearBotScopedContent();") < body.indexOf("const tasks = ["), true);
  assert.match(body, /loadAddressBookTargets\(\{ contextVersion \}\)/);
  assert.match(body, /loadProactiveTasks\(\{ contextVersion \}\)/);
  assert.match(body, /loadFlowMachine\(\{ contextVersion \}\)/);
  assert.match(body, /loadFlowSessions\(\{ contextVersion \}\)/);
});

test("bot scoped loaders ignore responses from a previous bot selection", () => {
  ["loadAddressBookTargets", "loadDebugReply", "loadLogs", "loadProactiveTasks", "loadFlowMachine", "loadFlowSessions"].forEach((name) => {
    const start = app.indexOf(`async function ${name}`);
    const end = app.indexOf("\nasync function ", start + 1);
    const body = app.slice(start, end === -1 ? undefined : end);
    assert.match(body, /isCurrentBotContext\(botId, contextVersion\)/);
  });
});

test("debug auto-reply configuration is requested and saved for the selected bot", () => {
  const loadStart = app.indexOf("async function loadDebugReply");
  const loadEnd = app.indexOf("async function saveBot", loadStart);
  const loadBody = app.slice(loadStart, loadEnd);
  const saveStart = app.indexOf("async function saveDebugReply");
  const saveEnd = app.indexOf("async function createProactiveTask", saveStart);
  const saveBody = app.slice(saveStart, saveEnd);

  assert.match(loadBody, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/debug-reply/);
  assert.match(loadBody, /isCurrentBotContext\(botId, contextVersion\)/);
  assert.match(saveBody, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/debug-reply/);
  assert.equal(loadBody.includes('"/api/settings/debug-reply"'), false);
  assert.equal(saveBody.includes('"/api/settings/debug-reply"'), false);
});

test("Bot-scoped mutations and drafts cannot cross an in-flight Bot switch", () => {
  const clearStart = app.indexOf("function clearBotScopedContent");
  const clearEnd = app.indexOf("function expandPanel", clearStart);
  const clearBody = app.slice(clearStart, clearEnd);
  assert.match(clearBody, /els\.manualReplyInput\.value = ""/);
  assert.match(clearBody, /els\.proactiveForm\.reset\(\)/);
  assert.match(clearBody, /els\.accessKeyForm\.reset\(\)/);

  [
    "saveAccessKey",
    "saveFlowMachine",
    "toggleSelectedConversationHandoff",
    "sendManualReply",
    "resetSelectedConversation",
    "saveDebugReply",
    "createProactiveTask"
  ].forEach((name) => {
    const start = app.indexOf(`async function ${name}`);
    const end = app.indexOf("\nasync function ", start + 1);
    const body = app.slice(start, end === -1 ? undefined : end);
    assert.match(body, /const botId = state\.selectedBotId/);
    assert.match(body, /const contextVersion = state\.botContextVersion/);
    assert.match(body, /isCurrentBotContext\(botId, contextVersion\)/);
  });
});

test("uploads and task-detail views stay within the Bot that initiated them", () => {
  const uploadBody = app.match(/async function uploadLocalFile\([\s\S]*?\n}\n\n/)[0];
  assert.match(uploadBody, /async function uploadLocalFile\(file, botId\)/);
  assert.match(uploadBody, /\/api\/uploads\?botId=\$\{encodeURIComponent\(botId\)\}/);

  const taskDetailStart = app.indexOf('button.addEventListener("click", async () => {', app.indexOf("function renderProactiveTasks"));
  const taskDetailEnd = app.indexOf("\n    });", taskDetailStart) + 8;
  const taskDetailBody = app.slice(taskDetailStart, taskDetailEnd);
  assert.match(taskDetailBody, /const botId = state\.selectedBotId/);
  assert.match(taskDetailBody, /isCurrentBotContext\(botId, contextVersion\)/);
});
