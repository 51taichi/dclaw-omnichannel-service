import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console header uses the AI sales and customer service platform title", () => {
  assert.match(html, /<title>微信AI销售客服管理中台<\/title>/);
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
  assert.equal(html.includes('id="icon-key"'), true);
  assert.match(html, /id="unlockDialog"[\s\S]*?<use href="#icon-unlock"><\/use>/);
  assert.match(html, /id="unlockKeyLabel" class="field-label"[\s\S]*?<use href="#icon-key"><\/use>[\s\S]*?密钥/);
  assert.equal(app.includes('fieldLabelIcon("key", "密钥")'), true);
  assert.equal(app.includes('fieldLabelIcon("key", "管理员密码")'), true);
  assert.equal(app.includes("window.WorkspaceContext.loadBots()"), true);
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
  assert.match(css, /\.current-bot-actions button\[hidden\]\s*\{[^}]*display:\s*none !important/);
});

test("console hides config tab for bot role and exposes access-key reset for admin", () => {
  assert.equal(html.includes("accessKeyForm"), true);
  assert.equal(html.includes('data-workspace-tab="agents"'), false);
  assert.equal(html.includes("agentForm"), false);
  assert.equal(html.includes("agentsList"), false);
  assert.equal(app.includes("syncRoleVisibility"), true);
  assert.equal(app.includes("shouldHideConfigTab"), true);
  assert.equal(app.includes("isAdminWorkspaceTab"), false);
  assert.equal(app.includes('els.workspaceTabBar?.classList.toggle("is-config-hidden", hideConfig)'), true);
  assert.equal(app.includes('document.querySelector(\'[data-workspace-tab="config"]\')?.toggleAttribute("hidden", hideConfig)'), true);
  assert.equal(app.includes('document.querySelector("#configTab")?.toggleAttribute("hidden", hideConfig)'), false);
  assert.equal(app.includes("agentManagementPanel"), false);
  assert.equal(app.includes('switchWorkspaceTab("sessions", { force: true })'), true);
  assert.equal(app.includes("state.currentRole === \"admin\""), true);
  assert.equal(app.includes("/access-key"), true);
  assert.equal(css.includes(".bot-card.is-locked"), true);
  assert.equal(css.includes('.workspace-tabs.is-config-hidden [data-workspace-tab="config"]'), true);
  assert.equal(css.includes("display: none !important"), true);
});

test("workspace tabs adapt to visible tab count without a fixed container width", () => {
  assert.match(css, /\.workspace-tabs\s*\{[\s\S]*display:\s*inline-flex[\s\S]*width:\s*fit-content[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*auto/);
  assert.doesNotMatch(css, /\.workspace-tabs\s*\{[\s\S]*width:\s*min\(760px,\s*100%\)/);
  assert.match(css, /\.workspace-tabs button\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*min-width:\s*108px[\s\S]*padding:\s*0 16px/);
});

test("workspace shows a mascot prompt with no active tab until a Bot is unlocked", () => {
  assert.match(
    html,
    /id="workspaceEmptyState"[\s\S]*src="\.\/assets\/sorry\.png"[\s\S]*请您先解锁任意一Bot/
  );
  assert.doesNotMatch(
    html,
    /class="active"\s+data-workspace-tab="config"[^>]*aria-selected="true"/
  );
  assert.match(
    app,
    /function syncWorkspaceSelectionState\(hasBotContext\)[\s\S]*els\.workspaceEmptyState\.hidden = hasBotContext/
  );
  assert.match(
    app,
    /if \(!hasBotContext\)\s*\{[\s\S]*button\.classList\.remove\("active"\)[\s\S]*button\.setAttribute\("aria-selected", "false"\)[\s\S]*panel\.hidden = true/
  );
  assert.match(css, /\.workspace-empty-state\s*\{[\s\S]*place-items:\s*center/);
  assert.match(css, /\.workspace-empty-card\s*\{[\s\S]*grid-template-columns:\s*72px max-content/);
});

test("workspace tab strip follows the selected Bot accent and connects to its content panel", () => {
  assert.match(css, /\.workspace-head\s*\{[\s\S]*position:\s*relative[\s\S]*z-index:\s*2/);
  assert.match(css, /\.workspace-tabs button\s*\{[\s\S]*position:\s*relative/);
  assert.match(css, /@media \(min-width:\s*761px\)\s*\{[\s\S]*\.workspace-tabs\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.workspace-tabs\s*\{[\s\S]*--workspace-tab-link:\s*var\(--accent\)[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/);
  assert.match(css, /\.workspace-tabs\.is-bound\s*\{[\s\S]*--workspace-tab-link:\s*var\(--bot-accent\)/);
  assert.match(css, /\.workspace-tabs::after\s*\{[\s\S]*content:\s*""[\s\S]*top:\s*100%[\s\S]*height:\s*15px[\s\S]*border-width:\s*0 0 3px[\s\S]*background:\s*transparent/);
  assert.match(css, /\.workspace-tabs button\.active\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*var\(--danger\),\s*var\(--orange\)\)[^}]*color:\s*#ffffff/);
  assert.match(css, /\.workspace-tabs\.is-bound button\.active\s*\{[^}]*var\(--bot-accent\)[^}]*color:\s*#ffffff/);
  assert.match(css, /\.bot-context-panel\.is-bound \.segmented button\.active\s*\{[^}]*var\(--bot-accent\)[^}]*color:\s*#fff/);
  assert.match(css, /html\.has-bot-context \.current-bot-actions #lockBotButton\s*\{[^}]*var\(--bot-accent\)[^}]*color:\s*#ffffff/);
  assert.match(app, /document\.documentElement\.classList\.toggle\("has-bot-context", Boolean\(bot\)\)/);
  assert.match(app, /document\.documentElement\.style\.setProperty\("--bot-accent", accent\)/);
  assert.match(app, /document\.documentElement\.style\.removeProperty\("--bot-accent"\)/);
  assert.doesNotMatch(css, /\.workspace-tabs button\.active::before\s*\{/);
  assert.match(css, /\.workspace-tabs button\.active::after\s*\{[^}]*content:\s*""[^}]*top:\s*100%[^}]*height:\s*20px[^}]*border-left:\s*2px solid var\(--workspace-tab-link\)[^}]*border-right:\s*2px solid var\(--workspace-tab-link\)[^}]*background:\s*transparent/);
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
  assert.equal(app.includes("renderAgentOptions"), true);
  assert.equal(app.includes("`${agent.agentName} (${agent.agentId})`"), false);
  assert.equal(css.includes("#botForm.form-grid"), true);
  assert.equal(app.includes("data-agent-delete"), false);
  assert.equal(app.includes("deleteAgent(agent)"), false);
});

test("admin Bot context reloads Agent data with the selected Bot session", () => {
  assert.match(
    app,
    /if \(state\.currentRole === "admin"\) \{[\s\S]*await loadAgents\(\);[\s\S]*fillForm\(activeBot\);/
  );
  const loadAgentsStart = app.indexOf("async function loadAgents");
  const loadAgentsEnd = app.indexOf("async function loadDebugReply", loadAgentsStart);
  const loadAgentsBody = app.slice(loadAgentsStart, loadAgentsEnd);
  assert.doesNotMatch(loadAgentsBody, /botId:\s*""/);
});

test("startup toggles render as switch components instead of plain checkboxes", () => {
  assert.match(html, /class="toggle switch-toggle action-toggle"[\s\S]*name="enabled" type="checkbox" checked[\s\S]*class="switch-slider"/);
  assert.match(html, /id="debugReplyForm"[\s\S]*class="toggle switch-toggle"[\s\S]*name="enabled" type="checkbox"[\s\S]*class="switch-slider"/);
  assert.match(html, /id="flowMachineForm"[\s\S]*class="toggle switch-toggle"[\s\S]*name="enabled" type="checkbox"[\s\S]*class="switch-slider"/);
  assert.match(app, /id="dateTagEnabled" type="checkbox"[\s\S]*class="switch-slider"/);
  assert.match(css, /\.switch-toggle/);
  assert.match(css, /\.switch-toggle input\[type="checkbox"\]/);
  assert.match(css, /\.switch-slider/);
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

test("bot cards expose quick actions in workspace tab order", () => {
  assert.equal(app.includes("showConfigQuickAction"), false);
  assert.equal(app.includes('data-action="config"'), false);
  assert.equal(app.includes('aria-label="Bot 配置"'), false);
  assert.match(app, /data-action="\$\{unlocked \? "sessions" : "unlock"\}[\s\S]*data-action="\$\{unlocked \? "tasks" : "unlock"\}[\s\S]*data-action="\$\{unlocked \? "tags" : "unlock"\}[\s\S]*data-action="\$\{unlocked \? "push" : "unlock"\}[\s\S]*data-action="\$\{unlocked \? "logs" : "unlock"\}/);
  assert.equal(app.includes('aria-label="${unlocked ? "标签维护" : "解锁"}'), true);
  assert.equal(app.includes('icon(unlocked ? "tag" : "lock")'), true);
  assert.equal(app.includes('actionTarget.dataset.action === "tags"'), true);
  assert.equal(app.includes('document.querySelector("#tagsTab")'), true);
});

test("bot cards use compact spacing without wasting vertical card space", () => {
  assert.match(css, /\.bot-card\s*\{[^}]*gap:\s*4px;[^}]*padding:\s*7px 8px 8px;/);
  assert.match(css, /\.bot-main\s*\{[^}]*gap:\s*8px;[^}]*min-height:\s*42px;/);
  assert.match(css, /\.bot-identity\s*\{[^}]*min-height:\s*42px;/);
  assert.match(css, /\.bot-identity-content\s*\{[^}]*grid-template-columns:\s*36px minmax\(0,\s*1fr\);[^}]*gap:\s*8px;/);
  assert.match(css, /\.bot-avatar\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/);
  assert.match(css, /\.icon-button,\s*\n\.bot-actions button\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;/);
  assert.doesNotMatch(css, /\.bot-card\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*9px;/);
});

test("admin bot cards expose a dangerous delete action with password confirmation", () => {
  assert.equal(app.includes('session?.role === "admin"'), true);
  assert.equal(app.includes('data-action="delete"'), true);
  assert.equal(app.includes('class="danger bot-delete-button"'), true);
  assert.equal(app.includes("<span>删除</span>"), false);
  assert.equal(app.includes('async function deleteBot(bot)'), true);
  assert.equal(app.includes("删除 Bot 需要管理员密码"), true);
  assert.equal(app.includes("确认删除该 Bot 及其所有数据？此操作不可恢复。"), true);
  assert.match(app, /request\(`\/api\/bots\/\$\{encodeURIComponent\(botId\)\}`,\s*\{[\s\S]*method:\s*"DELETE"/);
  assert.match(app, /clearBotSession\(botId\);[\s\S]*resetBotContext\(\);[\s\S]*loadBots\(\)/);
  assert.match(css, /\.bot-card button\.bot-delete-button\s*\{[^}]*width:\s*30px[^}]*background:\s*linear-gradient\(90deg,\s*var\(--danger\),\s*var\(--orange\)\)[^}]*color:\s*#ffffff/);
  assert.doesNotMatch(css, /\.bot-card button\.bot-delete-button\s*\{[^}]*var\(--bot-accent\)/);
});

test("semantic primary and danger actions keep system colors outside Bot theming", () => {
  assert.match(css, /button\.primary\s*\{[^}]*linear-gradient\(90deg,\s*var\(--accent\),\s*#2847f0 54%,\s*var\(--cyan\)\)/);
  assert.match(css, /button\.danger\s*\{[^}]*linear-gradient\(90deg,\s*var\(--danger\),\s*var\(--orange\)\)/);
  assert.doesNotMatch(css, /button\.(?:primary|danger)\s*\{[^}]*var\(--bot-accent\)/);
});

test("bot delete action anchors left while quick actions stay right", () => {
  assert.match(css, /\.bot-actions\s*\{[^}]*justify-content:\s*flex-end;/);
  assert.match(css, /\.bot-delete-button\s*\{[^}]*margin-right:\s*auto;/);
});

test("locked bot quick actions use lock icons", () => {
  assert.equal(app.includes('icon(unlocked ? "edit" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "users" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "send" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "eye" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "tag" : "lock")'), true);
  assert.equal(app.includes('icon(unlocked ? "edit" : "link")'), false);
});

test("lock and reset return to an unselected workspace", () => {
  assert.equal(app.includes("function resetBotContext()"), true);
  assert.equal(app.includes("clearBotSession(botId);"), true);
  assert.equal(app.includes("resetBotContext();"), true);
  const resetStart = app.indexOf("function resetBotContext()");
  const resetEnd = app.indexOf("function renderAgentOptions", resetStart);
  const resetBody = app.slice(resetStart, resetEnd);
  assert.equal(resetBody.includes('switchWorkspaceTab("config", { force: true });'), false);
  assert.match(resetBody, /setBindingState\(null\)/);
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

test("admin bot context reloads only scoped Bots before filling config form", () => {
  const applyStart = app.indexOf("async function applyBotContext");
  const applyEnd = app.indexOf("function openUnlockDialog", applyStart);
  const body = app.slice(applyStart, applyEnd);
  assert.match(body, /const data = await window\.WorkspaceContext\.loadBots\(\)/);
  assert.match(body, /activeBot = currentBots\.find\(\(item\) => item\.botId === bot\.botId\) \|\| bot/);
  assert.match(body, /fillForm\(activeBot\)/);
  assert.equal(body.indexOf("const data = await window.WorkspaceContext.loadBots()") < body.indexOf("fillForm(activeBot)"), true);
});

test("bot card quick actions let applyBotContext own form synchronization", () => {
  const renderStart = app.indexOf("function renderBots");
  const renderEnd = app.indexOf("let currentBots", renderStart);
  const body = app.slice(renderStart, renderEnd);
  assert.equal(body.includes("fillForm(bot);"), false);
  assert.match(body, /await applyBotContext\(bot(?:,\s*\{[\s\S]*?\})?\)/);
});

test("switching from a Bot session to an admin Bot opens config after context synchronization", () => {
  const renderStart = app.indexOf("function renderBots");
  const renderEnd = app.indexOf("let currentBots", renderStart);
  const body = app.slice(renderStart, renderEnd);
  const openStart = body.indexOf('if (actionTarget.dataset.action === "open")');
  const openEnd = body.indexOf('if (actionTarget.dataset.action === "push")', openStart);
  const openAction = body.slice(openStart, openEnd);
  const applyStart = app.indexOf("async function applyBotContext");
  const applyEnd = app.indexOf("function openUnlockDialog", applyStart);
  const applyBody = app.slice(applyStart, applyEnd);

  assert.match(openAction, /await applyBotContext\(bot,\s*\{\s*tabName:\s*getBotSession\(botId\)\?\.role === "admin" \? "config" : ""\s*\}\)/);
  assert.doesNotMatch(openAction, /switchWorkspaceTab\("config"\)/);
  assert.match(applyBody, /setBindingState\(bot\);[\s\S]*if \(tabName\) switchWorkspaceTab\(tabName\);/);
  assert.equal(applyBody.indexOf("setBindingState(bot);") < applyBody.indexOf("switchWorkspaceTab(tabName)"), true);
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

test("tag alert streaming follows the authenticated Bot lifecycle", () => {
  const applyStart = app.indexOf("async function applyBotContext");
  const applyEnd = app.indexOf("function openUnlockDialog", applyStart);
  const applyBody = app.slice(applyStart, applyEnd);
  const clearStart = app.indexOf("function clearBotScopedContent");
  const clearEnd = app.indexOf("function expandPanel", clearStart);
  const clearBody = app.slice(clearStart, clearEnd);

  assert.match(clearBody, /disconnectTagAlerts\(\)/);
  assert.match(applyBody, /connectTagAlerts\(bot\.botId\)/);
  assert.equal(
    applyBody.indexOf("clearBotScopedContent();") <
      applyBody.indexOf("connectTagAlerts(bot.botId)"),
    true
  );
  assert.match(app, /tagAlertClient\.connect\(\{[\s\S]*botId,[\s\S]*headers:\s*headers\(\{\}, botId\)/);
  assert.match(app, /tagAlertClient\.disconnect\(\)/);
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
