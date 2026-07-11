const state = {
  apiKey: localStorage.getItem("worktool_console_api_key") || "",
  selectedBotId: "",
  selectedFlowConversationKey: "",
  currentRole: "",
  botSessions: JSON.parse(localStorage.getItem("worktool_console_bot_sessions") || "{}"),
  pendingUnlockBotId: ""
};

const DEFAULT_FILE_URL = "https://worktool.deepmega.cn/console";

const els = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  refreshButton: document.querySelector("#refreshButton"),
  lockBotButton: document.querySelector("#lockBotButton"),
  unlockDialog: document.querySelector("#unlockDialog"),
  unlockBotName: document.querySelector("#unlockBotName"),
  unlockKeyInput: document.querySelector("#unlockKeyInput"),
  unlockCancelButton: document.querySelector("#unlockCancelButton"),
  unlockAcceptButton: document.querySelector("#unlockAcceptButton"),
  botBindingPanel: document.querySelector("#botBindingPanel"),
  accessKeyPanel: document.querySelector("#accessKeyPanel"),
  accessKeyForm: document.querySelector("#accessKeyForm"),
  proactivePanel: document.querySelector("#proactivePanel"),
  workspaceTabBar: document.querySelector(".workspace-tabs"),
  workspaceTabs: document.querySelectorAll("[data-workspace-tab]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),
  workspaceLockPanel: document.querySelector("#workspaceLockPanel"),
  bindingState: document.querySelector("#bindingState"),
  botForm: document.querySelector("#botForm"),
  debugReplyForm: document.querySelector("#debugReplyForm"),
  flowMachineForm: document.querySelector("#flowMachineForm"),
  addFlowNodeButton: document.querySelector("#addFlowNodeButton"),
  applyFlowJsonButton: document.querySelector("#applyFlowJsonButton"),
  flowNodeList: document.querySelector("#flowNodeList"),
  loadDefaultFlowButton: document.querySelector("#loadDefaultFlowButton"),
  exportFlowButton: document.querySelector("#exportFlowButton"),
  refreshFlowSessionsButton: document.querySelector("#refreshFlowSessionsButton"),
  flowSessionList: document.querySelector("#flowSessionList"),
  flowSessionDateFrom: document.querySelector("#flowSessionDateFrom"),
  flowSessionDateTo: document.querySelector("#flowSessionDateTo"),
  flowSessionAssetFilter: document.querySelector("#flowSessionAssetFilter"),
  flowSessionNodeFilter: document.querySelector("#flowSessionNodeFilter"),
  chatTitle: document.querySelector("#chatTitle"),
  chatStatusBadge: document.querySelector("#chatStatusBadge"),
  chatMessages: document.querySelector("#chatMessages"),
  flowEventsOutput: document.querySelector("#flowEventsOutput"),
  assetsButton: document.querySelector("#assetsButton"),
  assetsCount: document.querySelector("#assetsCount"),
  assetsPanel: document.querySelector("#assetsPanel"),
  handoffStatusBanner: document.querySelector("#handoffStatusBanner"),
  resetConversationButton: document.querySelector("#resetConversationButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmCancelButton: document.querySelector("#confirmCancelButton"),
  confirmAcceptButton: document.querySelector("#confirmAcceptButton"),
  proactiveForm: document.querySelector("#proactiveForm"),
  messageTypeInput: document.querySelector('select[name="messageType"]'),
  messageFields: document.querySelectorAll("[data-message-field]"),
  taskDateFrom: document.querySelector("#taskDateFrom"),
  taskDateTo: document.querySelector("#taskDateTo"),
  refreshProactiveButton: document.querySelector("#refreshProactiveButton"),
  loadTargetsButton: document.querySelector("#loadTargetsButton"),
  selectPrivateTargetsButton: document.querySelector("#selectPrivateTargetsButton"),
  selectGroupTargetsButton: document.querySelector("#selectGroupTargetsButton"),
  clearTargetsButton: document.querySelector("#clearTargetsButton"),
  targetSearchInput: document.querySelector("#targetSearchInput"),
  targetList: document.querySelector("#targetList"),
  selectedTargets: document.querySelector("#selectedTargets"),
  resetFormButton: document.querySelector("#resetFormButton"),
  botsTable: document.querySelector("#botsTable"),
  botCount: document.querySelector("#botCount"),
  proactiveTasksTable: document.querySelector("#proactiveTasksTable"),
  logType: document.querySelector("#logType"),
  loadLogsButton: document.querySelector("#loadLogsButton"),
  logsOutput: document.querySelector("#logsOutput"),
  toast: document.querySelector("#toast"),
  botContextPanels: document.querySelectorAll(".bot-context-panel"),
  collapseButtons: document.querySelectorAll("[data-collapse-target]")
};

if (els.apiKeyInput) els.apiKeyInput.value = state.apiKey;
const today = formatLocalDate();
els.taskDateFrom.value = today;
els.taskDateTo.value = today;

function headers(extra = {}) {
  const result = {
    "Content-Type": "application/json",
    ...extra
  };
  const session = getSelectedBotSession();
  if (session?.token) {
    result["x-bot-session-token"] = session.token;
  } else if (state.apiKey) {
    result["x-api-key"] = state.apiKey;
  }
  return result;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function formatLocalDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function saveBotSessions() {
  localStorage.setItem("worktool_console_bot_sessions", JSON.stringify(state.botSessions));
}

function getBotSession(botId) {
  const session = state.botSessions[botId];
  if (!session) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    delete state.botSessions[botId];
    saveBotSessions();
    return null;
  }
  return session;
}

function getSelectedBotSession() {
  return state.selectedBotId ? getBotSession(state.selectedBotId) : null;
}

function setBotSession(botId, session) {
  state.botSessions[botId] = session;
  saveBotSessions();
}

function clearBotSession(botId) {
  delete state.botSessions[botId];
  saveBotSessions();
}

function isBotUnlocked(botId) {
  return Boolean(getBotSession(botId));
}

function isWorkspaceLocked() {
  return Boolean(state.selectedBotId && !state.currentRole);
}

function syncRoleVisibility() {
  const isAdmin = state.currentRole === "admin";
  const hasBot = Boolean(state.selectedBotId);
  const workspaceLocked = isWorkspaceLocked();
  const hideConfig = hasBot && !isAdmin;
  document.body.classList.toggle("is-admin-role", isAdmin);
  document.body.classList.toggle("is-bot-role", state.currentRole === "bot");
  document.body.classList.toggle("is-workspace-locked", workspaceLocked);
  document.querySelector('[data-workspace-tab="config"]')?.toggleAttribute("hidden", hideConfig);
  document.querySelector("#configTab")?.toggleAttribute("hidden", hideConfig);
  els.resetFormButton.hidden = !hasBot;
  if (els.accessKeyPanel) els.accessKeyPanel.hidden = !isAdmin;
  if (els.lockBotButton) els.lockBotButton.hidden = !hasBot || workspaceLocked;
  if (els.workspaceLockPanel) els.workspaceLockPanel.hidden = !workspaceLocked;
  if (workspaceLocked) {
    els.tabPanels.forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove("active");
    });
  } else if (hideConfig && document.querySelector('[data-workspace-tab="config"]')?.classList.contains("active")) {
    switchWorkspaceTab("sessions", { force: true });
  }
}

function dateToLocalIsoStart(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toISOString();
}

function dateToLocalIsoNextDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function fileNameFromUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return "";
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: headers(options.headers || {})
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data;
}

async function uploadLocalFile(file) {
  const payload = new FormData();
  payload.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      ...(getSelectedBotSession()?.token
        ? { "x-bot-session-token": getSelectedBotSession().token }
        : { "x-api-key": state.apiKey })
    },
    body: payload
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data.file;
}

function formData() {
  const data = new FormData(els.botForm);
  return {
    botId: String(data.get("botId") || "").trim(),
    botName: String(data.get("botName") || "").trim(),
    agentId: String(data.get("agentId") || "").trim(),
    agentName: String(data.get("agentName") || "").trim(),
    dclawBaseUrl: String(data.get("dclawBaseUrl") || "").trim(),
    dclawPublicId: String(data.get("dclawPublicId") || "").trim(),
    agentApiKey: String(data.get("agentApiKey") || "").trim(),
    enabled: data.get("enabled") === "on"
  };
}

const botAccentPalette = [
  "#2a30d8",
  "#18c5cf",
  "#ff5a12",
  "#ef2625"
];

function hashString(value) {
  return Array.from(String(value || "")).reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
    0
  );
}

function getBotAccent(bot) {
  const value = bot?.botId || bot?.dclawPublicId || bot?.botName || "";
  return botAccentPalette[hashString(value) % botAccentPalette.length];
}

function botDisplayName(botId) {
  const bot = currentBots.find((item) => item.botId === botId);
  return bot?.botName || bot?.dclawPublicId || bot?.agentName || botId || "-";
}

function switchWorkspaceTab(tabName, { scrollTo = null, force = false } = {}) {
  if (!force && isWorkspaceLocked()) {
    toast("内容区域已上锁，请先解锁当前 Bot");
    return;
  }
  if (!force && tabName !== "config" && !state.selectedBotId) {
    toast("请先选择或保存一个 Bot");
    return;
  }
  if (!force && tabName === "config" && state.selectedBotId && state.currentRole !== "admin") {
    toast("当前 Bot 未以管理员身份解锁");
    return;
  }
  els.workspaceTabs.forEach((button) => {
    const active = button.dataset.workspaceTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.tabPanels.forEach((panel) => {
    const active = panel.dataset.tabPanel === tabName;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  if (scrollTo) {
    requestAnimationFrame(() => scrollTo.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function updateWorkspaceTabAccess(hasBotContext) {
  const workspaceLocked = isWorkspaceLocked();
  els.workspaceTabs.forEach((button) => {
    const locked =
      workspaceLocked ||
      (button.dataset.workspaceTab !== "config" && !hasBotContext) ||
      (button.dataset.workspaceTab === "config" && hasBotContext && state.currentRole !== "admin");
    button.disabled = locked;
    button.setAttribute("aria-disabled", String(locked));
  });
  if (
    !workspaceLocked &&
    !hasBotContext &&
    !document.querySelector('[data-workspace-tab="config"]')?.classList.contains("active")
  ) {
    switchWorkspaceTab("config", { force: true });
  }
}

function tabForPanel(panel) {
  return panel?.closest("[data-tab-panel]")?.dataset.tabPanel || "";
}

function setBindingState(bot = null) {
  state.selectedBotId = bot?.botId || "";
  state.currentRole = bot ? getBotSession(bot.botId)?.role || "" : "";
  const accent = bot ? getBotAccent(bot) : "";
  updateWorkspaceTabAccess(Boolean(bot));
  syncRoleVisibility();
  els.workspaceTabBar?.classList.toggle("is-bound", Boolean(bot));
  els.workspaceTabBar?.style.setProperty("--bot-accent", accent);
  els.bindingState?.classList.toggle("is-bound", Boolean(bot));
  els.bindingState?.style.setProperty("--bot-accent", accent);
  els.botContextPanels.forEach((panel) => {
    panel.classList.toggle("is-bound", Boolean(bot));
    panel.style.setProperty("--bot-accent", accent);
  });
  els.bindingState.textContent = bot
    ? `当前Bot：${bot.botName || bot.dclawPublicId || "当前 Bot"} · ${state.currentRole === "admin" ? "管理员" : state.currentRole ? "已解锁" : "已上锁"}`
    : "新增模式";
  renderBots(currentBots);
}

function expandPanel(panel) {
  if (!panel) return;
  panel.classList.remove("is-collapsed");
  const button = panel.querySelector("[data-collapse-target]");
  if (button) button.setAttribute("aria-expanded", "true");
}

async function applyBotContext(bot, { scrollTo = null } = {}) {
  if (!isBotUnlocked(bot?.botId)) {
    openUnlockDialog(bot);
    return;
  }
  setBindingState(bot);
  if (bot?.botId) {
    selectedTargets.clear();
    if (state.currentRole === "admin") {
      fillForm(bot);
      await loadDebugReply();
    }
    const tasks = [
      loadAddressBookTargets(),
      loadProactiveTasks(),
      loadFlowMachine(),
      loadFlowSessions()
    ];
    await Promise.all(tasks);
    if (els.logsOutput.textContent.trim()) {
      await loadLogs();
    }
  }
  if (scrollTo) {
    const tabName = tabForPanel(scrollTo);
    if (tabName) switchWorkspaceTab(tabName);
    expandPanel(scrollTo);
    scrollTo.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (!scrollTo && state.currentRole !== "admin") {
    switchWorkspaceTab("sessions", { force: true });
  }
}

function openUnlockDialog(bot) {
  if (!bot?.botId) return;
  state.pendingUnlockBotId = bot.botId;
  els.unlockBotName.textContent = `解锁 ${bot.botName || bot.agentName || bot.botId}`;
  els.unlockKeyInput.value = "";
  els.unlockDialog.hidden = false;
  requestAnimationFrame(() => els.unlockKeyInput.focus());
}

function closeUnlockDialog() {
  state.pendingUnlockBotId = "";
  els.unlockDialog.hidden = true;
}

async function unlockPendingBot() {
  const botId = state.pendingUnlockBotId;
  const key = els.unlockKeyInput.value.trim();
  if (!botId || !key) {
    toast("请输入密钥");
    return;
  }
  const data = await request(`/api/bots/${encodeURIComponent(botId)}/unlock`, {
    method: "POST",
    body: JSON.stringify({ key })
  });
  setBotSession(botId, {
    token: data.token,
    role: data.role,
    expiresAt: data.expiresAt
  });
  closeUnlockDialog();
  toast(data.role === "admin" ? "已用管理员身份解锁" : "Bot 已解锁");
  await loadBots();
  const bot = currentBots.find((item) => item.botId === botId) || data.bot;
  if (data.role === "admin" && data.bot) {
    Object.assign(bot, data.bot);
  }
  await applyBotContext(bot, { scrollTo: data.role === "admin" ? null : document.querySelector("#flowSessionsPanel") });
}

async function lockCurrentBot() {
  const botId = state.selectedBotId;
  if (!botId) return;
  try {
    await request(`/api/bots/${encodeURIComponent(botId)}/lock`, { method: "POST" });
  } catch {}
  clearBotSession(botId);
  resetBotContext();
  toast("已上锁");
}

function resetBotContext() {
  state.selectedFlowConversationKey = "";
  selectedTargets.clear();
  addressBookTargets = [];
  currentFlowMachine = null;
  currentFlowSessions = [];
  currentFlowSession = null;
  syncHandoffButton(null);
  renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
  els.chatTitle.textContent = "请选择一个私聊会话";
  els.chatMessages.innerHTML = "";
  els.botForm.reset();
  els.botForm.enabled.checked = true;
  setBindingState(null);
  renderSelectedTargets();
  renderTargetList();
  renderBots(currentBots);
  switchWorkspaceTab("config", { force: true });
}

function fillForm(bot) {
  els.botForm.botId.value = bot.botId || "";
  els.botForm.botName.value = bot.botName || "";
  els.botForm.agentId.value = bot.agentId || "";
  els.botForm.agentName.value = bot.agentName || "";
  els.botForm.dclawBaseUrl.value = bot.dclawBaseUrl || "";
  els.botForm.dclawPublicId.value = bot.dclawPublicId || bot.agentId || "";
  els.botForm.agentApiKey.value = bot.agentApiKey || "";
  els.botForm.enabled.checked = Boolean(bot.enabled);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderBots(bots) {
  els.botCount.textContent = `${bots.length} 个`;
  if (!bots.length) {
    els.botsTable.innerHTML = `<div class="empty-state">暂无 Bot 绑定</div>`;
    return;
  }

  els.botsTable.innerHTML = bots
    .map((bot) => {
      const safeBot = encodeURIComponent(bot.botId);
      const title = bot.botName || bot.dclawPublicId || "未命名 Bot";
      const isSelected = bot.botId === state.selectedBotId;
      const unlocked = isBotUnlocked(bot.botId);
      const session = getBotSession(bot.botId);
      const botStatusText = !unlocked ? "已上锁" : isSelected ? (session?.role === "admin" ? "管理员" : "使用中") : "已解锁";
      const botStatusClass = !unlocked ? "off" : isSelected ? "selected" : "ok";
      const accent = getBotAccent(bot);
      return `
        <article class="bot-card ${bot.enabled ? "is-online" : "is-offline"} ${unlocked ? "is-unlocked" : "is-locked"} ${isSelected ? "is-selected" : ""}" data-action="${unlocked ? "open" : "unlock"}" data-bot="${safeBot}" style="--bot-accent: ${escapeHtml(accent)}">
          <div class="bot-main">
            <img class="bot-avatar" src="./assets/bot-avatar.png" alt="" aria-hidden="true" />
            <span class="bot-summary">
              <span class="bot-title-row">
                <strong>${escapeHtml(title)}</strong>
                <span class="pill ${botStatusClass}">${botStatusText}</span>
              </span>
              <span class="bot-agent">${escapeHtml(bot.agentName || bot.agentId || "未绑定 Agent")}</span>
            </span>
          </div>
          <div class="row-actions bot-actions">
            <button class="secondary icon-button" data-action="${unlocked ? "tasks" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "任务配置" : "解锁"}" title="${unlocked ? "任务配置" : "解锁"}">${icon(unlocked ? "edit" : "link")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "sessions" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "客户会话" : "解锁"}" title="${unlocked ? "客户会话" : "解锁"}">${icon(unlocked ? "users" : "link")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "push" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "推送消息" : "解锁"}" title="${unlocked ? "推送消息" : "解锁"}">${icon(unlocked ? "send" : "link")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "logs" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "运行日志" : "解锁"}" title="${unlocked ? "运行日志" : "解锁"}">${icon(unlocked ? "eye" : "link")}</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.botsTable.querySelectorAll("[data-action]").forEach((item) => {
    item.addEventListener("click", async (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;
      const botId = decodeURIComponent(actionTarget.dataset.bot);
      const bot = currentBots.find((item) => item.botId === botId);
      if (actionTarget.dataset.action === "unlock") {
        event.stopPropagation();
        openUnlockDialog(bot);
        return;
      }
      if (actionTarget.dataset.action === "open") {
        if (getBotSession(botId)?.role === "admin") {
          switchWorkspaceTab("config");
          fillForm(bot);
        }
        applyBotContext(bot).catch((error) => toast(error.message));
        return;
      }
      if (actionTarget.dataset.action === "push") {
        event.stopPropagation();
        fillForm(bot);
        await applyBotContext(bot, { scrollTo: els.proactivePanel });
      }
      if (actionTarget.dataset.action === "tasks") {
        event.stopPropagation();
        fillForm(bot);
        await applyBotContext(bot, { scrollTo: document.querySelector("#flowMachinePanel") });
      }
      if (actionTarget.dataset.action === "sessions") {
        event.stopPropagation();
        fillForm(bot);
        await applyBotContext(bot, { scrollTo: document.querySelector("#flowSessionsPanel") });
      }
      if (actionTarget.dataset.action === "logs") {
        event.stopPropagation();
        fillForm(bot);
        await applyBotContext(bot, { scrollTo: document.querySelector("#logsPanel") });
      }
    });
  });
}

let currentBots = [];
let targetFilter = "all";
let addressBookTargets = [];
let currentFlowMachine = null;
let currentFlowSessions = [];
let flowDraftNodes = [];
let currentConversationAssets = { fields: [], totalCount: 0, collectedCount: 0 };
let currentFlowSession = null;
const collapsedFlowNodes = new Set();
const selectedTargets = new Map();

function targetKey(target) {
  return `${target.targetType}:${target.targetName}`;
}

function targetTypeLabel(type) {
  return type === "group" ? "群组" : "私聊";
}

function targetTypeIcon(type) {
  return type === "group" ? "群" : "私";
}

function getSelectedTargets() {
  return Array.from(selectedTargets.values());
}

function targetsByType(type) {
  return addressBookTargets.filter((target) => target.targetType === type);
}

function areTargetsByTypeSelected(type) {
  const targets = targetsByType(type);
  return targets.length > 0 && targets.every((target) => selectedTargets.has(targetKey(target)));
}

function updateBulkActionButtons() {
  const privateSelected = areTargetsByTypeSelected("private");
  const groupSelected = areTargetsByTypeSelected("group");
  els.selectPrivateTargetsButton.classList.toggle("selected", privateSelected);
  els.selectGroupTargetsButton.classList.toggle("selected", groupSelected);
  els.selectPrivateTargetsButton.setAttribute("aria-pressed", String(privateSelected));
  els.selectGroupTargetsButton.setAttribute("aria-pressed", String(groupSelected));
  els.selectPrivateTargetsButton.textContent = privateSelected ? "取消私聊" : "全选私聊";
  els.selectGroupTargetsButton.textContent = groupSelected ? "取消群组" : "全选群组";
}

function toggleTargetsByType(type) {
  const targets = targetsByType(type);
  const allSelected = areTargetsByTypeSelected(type);
  targets.forEach((target) => {
    const key = targetKey(target);
    if (allSelected) {
      selectedTargets.delete(key);
    } else {
      selectedTargets.set(key, target);
    }
  });
  renderSelectedTargets();
  renderTargetList();
  if (!targets.length) {
    toast(`暂无${targetTypeLabel(type)}目标`);
    return;
  }
  toast(`${allSelected ? "已取消" : "已选择"} ${targets.length} 个${targetTypeLabel(type)}目标`);
}

function clearSelectedTargets() {
  selectedTargets.clear();
  renderSelectedTargets();
  renderTargetList();
}

function renderSelectedTargets() {
  const targets = getSelectedTargets();
  els.selectedTargets.innerHTML = targets.length
    ? targets
        .map((target) => {
          const key = escapeHtml(targetKey(target));
          return `
            <button class="target-chip" data-remove-target="${key}" type="button">
              <span>${escapeHtml(target.displayName || target.targetName)}</span>
              <small>${escapeHtml(targetTypeLabel(target.targetType))}</small>
              ${icon("reset")}
            </button>
          `;
        })
        .join("")
    : `<span class="muted">请选择要推送的客户或群组</span>`;

  els.selectedTargets.querySelectorAll("[data-remove-target]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTargets.delete(button.dataset.removeTarget);
      renderSelectedTargets();
      renderTargetList();
    });
  });
}

function renderTargetList() {
  const query = els.targetSearchInput.value.trim().toLowerCase();
  const targets = addressBookTargets.filter((target) => {
    if (targetFilter !== "all" && target.targetType !== targetFilter) return false;
    if (!query) return true;
    return `${target.targetName} ${target.displayName || ""}`.toLowerCase().includes(query);
  });

  els.targetList.innerHTML = targets.length
    ? targets
        .map((target) => {
          const key = targetKey(target);
          const checked = selectedTargets.has(key);
          return `
            <button class="target-card ${checked ? "selected" : ""}" data-target-key="${escapeHtml(key)}" type="button">
              <span class="target-avatar ${target.targetType === "group" ? "group" : "private"}">${escapeHtml(targetTypeIcon(target.targetType))}</span>
              <span class="target-main">
                <strong>${escapeHtml(target.displayName || target.targetName)}</strong>
              </span>
              <span class="target-check">${checked ? "已选" : "选择"}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-targets">暂无目标，请先同步名单，或等待客户/群聊产生回调后自动沉淀。</div>`;

  els.targetList.querySelectorAll("[data-target-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = addressBookTargets.find((item) => targetKey(item) === button.dataset.targetKey);
      if (!target) return;
      if (selectedTargets.has(button.dataset.targetKey)) {
        selectedTargets.delete(button.dataset.targetKey);
      } else {
        selectedTargets.set(button.dataset.targetKey, target);
      }
      renderSelectedTargets();
      renderTargetList();
    });
  });
  updateBulkActionButtons();
}

async function loadAddressBookTargets() {
  const botId = state.selectedBotId;
  if (!botId) {
    toast("请先选择 Bot");
    return;
  }
  const params = new URLSearchParams({ botId, limit: "300" });
  const data = await request(`/api/proactive/targets?${params.toString()}`);
  addressBookTargets = data.targets || [];
  for (const key of Array.from(selectedTargets.keys())) {
    if (!addressBookTargets.some((target) => targetKey(target) === key)) {
      selectedTargets.delete(key);
    }
  }
  renderSelectedTargets();
  renderTargetList();
  updateBulkActionButtons();
}

async function loadBots() {
  const data = await request("/api/public/bots");
  currentBots = data.bots || [];
  if (state.selectedBotId && !currentBots.some((bot) => bot.botId === state.selectedBotId)) {
    setBindingState(null);
    return;
  }
  if (!state.selectedBotId) {
    updateWorkspaceTabAccess(false);
  }
  renderBots(currentBots);
}

async function loadDebugReply() {
  if (state.currentRole !== "admin") return;
  const data = await request("/api/settings/debug-reply");
  const config = data.config || {};
  els.debugReplyForm.enabled.checked = Boolean(config.enabled);
  els.debugReplyForm.trigger.value = config.trigger || "ping";
  els.debugReplyForm.reply.value = config.reply || "pong";
}

async function saveBot(event) {
  event.preventDefault();
  if (state.currentRole !== "admin") {
    toast("需要管理员身份");
    return;
  }
  const bot = formData();
  if (!bot.botId || !bot.agentId || !bot.dclawBaseUrl || !bot.dclawPublicId) {
    toast("请填写 Bot ID、Agent ID、DClaw Base URL 和 Public ID");
    return;
  }
  await request(`/api/bots/${encodeURIComponent(bot.botId)}`, {
    method: "PUT",
    body: JSON.stringify(bot)
  });
  toast("绑定已保存");
  const data = await request("/api/bots");
  currentBots = data.bots || [];
  renderBots(currentBots);
  const savedBot = currentBots.find((item) => item.botId === bot.botId);
  if (savedBot) await applyBotContext(savedBot);
}

async function saveAccessKey(event) {
  event.preventDefault();
  if (!state.selectedBotId || state.currentRole !== "admin") {
    toast("需要管理员身份");
    return;
  }
  const accessKey = String(new FormData(els.accessKeyForm).get("accessKey") || "").trim();
  if (!accessKey) {
    toast("请输入新的 Bot 密钥");
    return;
  }
  await request(`/api/bots/${encodeURIComponent(state.selectedBotId)}/access-key`, {
    method: "PUT",
    body: JSON.stringify({ accessKey })
  });
  els.accessKeyForm.reset();
  toast("Bot 密钥已修改");
  await loadBots();
}

async function bindCallback(botId, type) {
  if (state.currentRole !== "admin") {
    toast("需要管理员身份");
    return;
  }
  await request(`/api/config/${encodeURIComponent(botId)}/${type}`, {
    method: "POST",
    body: JSON.stringify({})
  });
  toast(type === "message-callback" ? "消息回调已绑定" : "指令回调已绑定");
}

async function loadLogs() {
  const type = els.logType.value;
  const params = new URLSearchParams({ limit: "40" });
  if (state.selectedBotId) params.set("botId", state.selectedBotId);
  const data = await request(`/api/logs/${encodeURIComponent(type)}?${params.toString()}`);
  els.logsOutput.textContent = JSON.stringify(data.logs || [], null, 2);
}

function flowNodeLabel(nodeId) {
  const node = currentFlowMachine?.config?.nodes?.find((item) => item.id === nodeId);
  return node ? `${node.name} (${node.id})` : nodeId || "-";
}

function flowNodeName(nodeId) {
  const node = currentFlowMachine?.config?.nodes?.find((item) => item.id === nodeId);
  return node?.name || nodeId || "-";
}

function splitList(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function defaultActivationConfig() {
  return {
    enabled: false,
    intervalMinutes: 30,
    maxTimes: 1,
    polishByAgent: true,
    messages: []
  };
}

function normalizeActivationDraft(value = {}) {
  const defaults = defaultActivationConfig();
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const messages = Array.isArray(source.messages)
    ? source.messages.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    enabled: Boolean(source.enabled),
    intervalMinutes: Math.max(1, Number(source.intervalMinutes || defaults.intervalMinutes)),
    maxTimes: Math.max(1, Number(source.maxTimes || defaults.maxTimes)),
    polishByAgent: source.polishByAgent !== false,
    messages
  };
}

function activationDraftForEditor(value = {}) {
  const normalized = normalizeActivationDraft(value);
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...normalized,
    messages: Array.isArray(source.messages)
      ? source.messages.map((item) => String(item || ""))
      : []
  };
}

function flowNodeCollapseKey(node, index) {
  return String(node?.id || `index_${index}`);
}

function nextFlowNodeId(start = flowDraftNodes.length + 1) {
  let index = Math.max(1, start);
  const used = new Set(flowDraftNodes.map((node) => String(node.id || "")));
  while (used.has(`node_${index}`)) index += 1;
  return `node_${index}`;
}

function createBlankFlowNode(index = flowDraftNodes.length + 1) {
  return {
    id: nextFlowNodeId(index),
    name: `节点 ${index}`,
    goal: "",
    completionCriteria: "",
    collectFields: [],
    conversationTips: [],
    activation: defaultActivationConfig(),
    nextNodeId: "",
    transitions: []
  };
}

function setFlowEditorFromConfig(config = {}) {
  els.flowMachineForm.flowName.value = config.name || "";
  els.flowMachineForm.flowVersion.value = config.version || "1.0.0";
  const usedNodeIds = new Set();
  const assignNodeId = (preferredId, fallbackIndex) => {
    const base = String(preferredId || `node_${fallbackIndex}`).trim() || `node_${fallbackIndex}`;
    let candidate = base;
    let suffix = 2;
    while (usedNodeIds.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedNodeIds.add(candidate);
    return candidate;
  };
  flowDraftNodes = Array.isArray(config.nodes) && config.nodes.length
    ? config.nodes.map((node, index) => ({
        id: assignNodeId(node.id, index + 1),
        name: node.name || "",
        goal: node.goal || "",
        completionCriteria: node.completionCriteria || "",
        collectFields: Array.isArray(node.collectFields) ? node.collectFields : [],
        conversationTips: Array.isArray(node.conversationTips) ? node.conversationTips : [],
        activation: normalizeActivationDraft(node.activation || defaultActivationConfig()),
        nextNodeId: node.nextNodeId || "",
        transitions: Array.isArray(node.transitions) ? node.transitions : []
      }))
    : [createBlankFlowNode(1)];
  collapsedFlowNodes.clear();
  flowDraftNodes.forEach((node, index) => collapsedFlowNodes.add(flowNodeCollapseKey(node, index)));
  renderFlowNodeEditor(flowDraftNodes[0]?.id || "");
  syncFlowJsonTextarea();
}

function buildFlowConfigFromEditor() {
  const nodes = flowDraftNodes.map((node, index) => ({
    id: String(node.id || `node_${index + 1}`).trim(),
    name: String(node.name || `节点 ${index + 1}`).trim(),
    goal: String(node.goal || "").trim(),
    completionCriteria: String(node.completionCriteria || "").trim(),
    collectFields: Array.isArray(node.collectFields) ? node.collectFields : [],
    conversationTips: Array.isArray(node.conversationTips) ? node.conversationTips : [],
    activation: normalizeActivationDraft(node.activation),
    nextNodeId: String(node.nextNodeId || "").trim(),
    transitions: Array.isArray(node.transitions) ? node.transitions : []
  }));
  return {
    name: String(els.flowMachineForm.flowName.value || "客服状态机").trim(),
    version: String(els.flowMachineForm.flowVersion.value || "1.0.0").trim(),
    entryNodeId: nodes[0]?.id || "",
    nodes
  };
}

function syncFlowJsonTextarea() {
  els.flowMachineForm.config.value = JSON.stringify(buildFlowConfigFromEditor(), null, 2);
}

function updateDraftNodeFromInput(input) {
  const card = input.closest("[data-flow-node-index]");
  if (!card) return;
  const index = Number(card.dataset.flowNodeIndex);
  const node = flowDraftNodes[index];
  if (!node) return;
  const field = input.dataset.flowNodeField;
  if (field === "collectFields" || field === "conversationTips") {
    node[field] = splitList(input.value);
  } else {
    node[field] = input.value;
  }
  syncFlowJsonTextarea();
}

function updateDraftNodeActivationFromInput(input) {
  const card = input.closest("[data-flow-node-index]");
  if (!card) return;
  const index = Number(card.dataset.flowNodeIndex);
  const node = flowDraftNodes[index];
  if (!node) return;
  const activation = normalizeActivationDraft(node.activation);
  const field = input.dataset.flowNodeActivationField;
  if (field === "enabled" || field === "polishByAgent") {
    activation[field] = input.checked;
  } else if (field === "intervalMinutes" || field === "maxTimes") {
    activation[field] = Math.max(1, Number(input.value || activation[field] || 1));
  }
  node.activation = {
    ...activation,
    messages: activationDraftForEditor(node.activation).messages
  };
  if (field === "enabled") {
    input.closest(".activation-editor")?.classList.toggle("is-active", Boolean(input.checked));
  }
  syncFlowJsonTextarea();
}

function updateDraftNodeActivationMessage(input) {
  const card = input.closest("[data-flow-node-index]");
  if (!card) return;
  const nodeIndex = Number(card.dataset.flowNodeIndex);
  const messageIndex = Number(input.dataset.activationMessageIndex);
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  activation.messages[messageIndex] = input.value;
  node.activation = activation;
  syncFlowJsonTextarea();
}

function addActivationMessage(index) {
  const node = flowDraftNodes[index];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  activation.messages = [...activation.messages, ""];
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  requestAnimationFrame(() => {
    const card = els.flowNodeList.querySelector(`[data-flow-node-index="${index}"]`);
    const inputs = card?.querySelectorAll("[data-activation-message-index]");
    inputs?.[inputs.length - 1]?.focus();
  });
}

function removeActivationMessage(nodeIndex, messageIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  activation.messages.splice(messageIndex, 1);
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function splitPastedActivationMessages(event, nodeIndex, messageIndex) {
  const text = event.clipboardData?.getData("text") || "";
  const lines = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (lines.length <= 1) return;
  event.preventDefault();
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  activation.messages.splice(messageIndex, 1, ...lines);
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

const flowNodeFieldDefinitions = [
  { field: "name", label: "节点名称", icon: "edit", type: "input", placeholder: "收集基础信息" },
  { field: "goal", label: "节点目标", icon: "terminal", type: "textarea", placeholder: "这个阶段要让 AI 完成什么" },
  { field: "completionCriteria", label: "完成条件", icon: "info", type: "textarea", placeholder: "什么情况下可以进入下一节点" },
  { field: "collectFields", label: "收集字段", icon: "briefcase", type: "textarea", placeholder: "每行一个，例如：手机号", list: true },
  { field: "conversationTips", label: "交流技巧", icon: "users", type: "textarea", placeholder: "每行一个，例如：先回应再追问", list: true },
  { field: "nextNodeId", label: "完成后进入", icon: "link", type: "select" }
];

const flowNodeQuickFields = flowNodeFieldDefinitions.filter((definition) => definition.field !== "name" && definition.field !== "nextNodeId");

function flowNodeFieldLabel(field, label) {
  const definition = flowNodeFieldDefinitions.find((item) => item.field === field);
  return `<span class="field-label">${definition ? icon(definition.icon) : ""}${escapeHtml(label)}</span>`;
}

function flowNodeFieldValue(node, field) {
  const value = node?.[field];
  if (Array.isArray(value)) return joinLines(value);
  return String(value || "");
}

function flowNodeFieldFilled(node, definition) {
  if (definition.field === "nextNodeId") return Boolean(node?.nextNodeId);
  return Boolean(flowNodeFieldValue(node, definition.field).trim());
}

function flowNodeFieldSummary(node, definition) {
  if (definition.field === "nextNodeId") {
    const next = flowDraftNodes.find((item) => item.id === node?.nextNodeId);
    return next ? next.name || next.id : "不自动跳转";
  }
  const value = flowNodeFieldValue(node, definition.field).replace(/\s+/g, " ").trim();
  return value || "未填写";
}

function renderFlowNodeQuickFields(node, index) {
  return `
    <div class="flow-node-quick-fields" aria-label="节点字段快捷编辑">
      ${flowNodeQuickFields
        .map((definition) => {
          const filled = flowNodeFieldFilled(node, definition);
          const summary = flowNodeFieldSummary(node, definition);
          return `
            <button class="flow-node-field-pill ${filled ? "is-filled" : "is-empty"}" data-flow-node-quick-field="${definition.field}" data-flow-node-index="${index}" type="button" title="${escapeHtml(`${definition.label}：${summary}`)}" aria-label="编辑${escapeHtml(definition.label)}">
              ${icon(definition.icon)}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function applyFlowNodeFieldValue(node, definition, value) {
  node[definition.field] = definition.list ? splitList(value) : value;
}

function getFlowNodeQuickEditor() {
  let dialog = document.querySelector("#flowNodeQuickEditor");
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.id = "flowNodeQuickEditor";
  dialog.className = "modal-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="confirm-dialog flow-node-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="flowNodeQuickTitle">
      <div class="confirm-icon">
        <svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg>
      </div>
      <div class="confirm-copy">
        <strong id="flowNodeQuickTitle">编辑节点字段</strong>
        <div class="flow-node-quick-control"></div>
      </div>
      <div class="confirm-actions">
        <button class="secondary" data-flow-node-quick-cancel="" type="button">
          <svg class="icon" aria-hidden="true"><use href="#icon-chevron"></use></svg>
          取消
        </button>
        <button class="primary" data-flow-node-quick-save="" type="button">
          <svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg>
          保存
        </button>
      </div>
    </div>
  `;
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-flow-node-quick-cancel]")) {
      closeFlowNodeQuickEditor();
    }
  });
  dialog.querySelector("[data-flow-node-quick-save]").addEventListener("click", saveFlowNodeQuickEditor);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFlowNodeQuickEditor();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveFlowNodeQuickEditor();
  });
  return dialog;
}

function closeFlowNodeQuickEditor() {
  const dialog = document.querySelector("#flowNodeQuickEditor");
  if (!dialog) return;
  dialog.hidden = true;
  delete dialog.dataset.nodeIndex;
  delete dialog.dataset.field;
}

function openFlowNodeQuickEditor(index, field) {
  const node = flowDraftNodes[index];
  const definition = flowNodeFieldDefinitions.find((item) => item.field === field);
  if (!node || !definition) return;
  const dialog = getFlowNodeQuickEditor();
  dialog.dataset.nodeIndex = String(index);
  dialog.dataset.field = field;
  dialog.querySelector("#flowNodeQuickTitle").textContent = `编辑${definition.label}`;
  const control = dialog.querySelector(".flow-node-quick-control");
  const value = flowNodeFieldValue(node, field);
  if (definition.type === "select") {
    const options = [
      `<option value="">不自动跳转</option>`,
      ...flowDraftNodes
        .filter((item) => item.id !== node.id)
        .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === node.nextNodeId ? "selected" : ""}>${escapeHtml(item.name || item.id)}</option>`)
    ].join("");
    control.innerHTML = `
      <label>
        <span class="field-label">${escapeHtml(definition.label)}</span>
        <select data-flow-node-quick-input>${options}</select>
      </label>
    `;
  } else if (definition.type === "textarea") {
    control.innerHTML = `
      <label class="wide">
        <span class="field-label">${escapeHtml(definition.label)}</span>
        <textarea data-flow-node-quick-input rows="5" placeholder="${escapeHtml(definition.placeholder || "")}">${escapeHtml(value)}</textarea>
      </label>
    `;
  } else {
    control.innerHTML = `
      <label>
        <span class="field-label">${escapeHtml(definition.label)}</span>
        <input data-flow-node-quick-input value="${escapeHtml(value)}" placeholder="${escapeHtml(definition.placeholder || "")}" />
      </label>
    `;
  }
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.querySelector("[data-flow-node-quick-input]")?.focus());
}

function saveFlowNodeQuickEditor() {
  const dialog = document.querySelector("#flowNodeQuickEditor");
  if (!dialog || dialog.hidden) return;
  const index = Number(dialog.dataset.nodeIndex);
  const definition = flowNodeFieldDefinitions.find((item) => item.field === dialog.dataset.field);
  const node = flowDraftNodes[index];
  const input = dialog.querySelector("[data-flow-node-quick-input]");
  if (!node || !definition || !input) return;
  applyFlowNodeFieldValue(node, definition, input.value);
  closeFlowNodeQuickEditor();
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function renderFlowNodeEditor(entryNodeId = "") {
  const validEntry = flowDraftNodes.some((node) => node.id === entryNodeId)
    ? entryNodeId
    : flowDraftNodes[0]?.id || "";
  els.flowMachineForm.entryNodeId.innerHTML = flowDraftNodes
    .map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name || node.id)}</option>`)
    .join("");
  els.flowMachineForm.entryNodeId.value = validEntry;

  els.flowNodeList.innerHTML = flowDraftNodes
    .map((node, index) => {
      const collapseKey = flowNodeCollapseKey(node, index);
      const isCollapsed = collapsedFlowNodes.has(collapseKey);
      const nodeOptions = [
        `<option value="">不自动跳转</option>`,
        ...flowDraftNodes
          .filter((item) => item.id !== node.id)
          .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === node.nextNodeId ? "selected" : ""}>${escapeHtml(item.name || item.id)}</option>`)
      ].join("");
      const activation = activationDraftForEditor(node.activation || defaultActivationConfig());
      const activationEnabled = activation.enabled;
      const activationIntervalMinutes = activation.intervalMinutes;
      const activationMaxTimes = activation.maxTimes;
      const activationPolishByAgent = activation.polishByAgent;
      const activationMessages = activation.messages.length ? activation.messages : [""];
      return `
        <article class="flow-node-card ${isCollapsed ? "is-collapsed" : ""}" data-flow-node-index="${index}" data-flow-node-collapse-key="${escapeHtml(collapseKey)}">
          <div class="flow-node-card-head">
            <button class="flow-node-title" data-edit-flow-node-name="${index}" type="button" title="双击编辑节点名称" aria-label="双击编辑节点名称：${escapeHtml(node.name || `节点 ${index + 1}`)}">
              <span class="flow-node-title-icon">${icon("link")}</span>
              <strong>${escapeHtml(node.name || `节点 ${index + 1}`)}</strong>
            </button>
            ${renderFlowNodeQuickFields(node, index)}
            <div class="flow-node-actions">
              <label class="flow-node-next-field">
                ${flowNodeFieldLabel("nextNodeId", "完成后进入")}
                <select data-flow-node-field="nextNodeId">${nodeOptions}</select>
              </label>
              <button class="danger icon-button" data-remove-flow-node="${index}" type="button" aria-label="删除任务节点" title="删除任务节点">${icon("reset")}</button>
              <button class="collapse-button" data-toggle-flow-node="${index}" type="button" aria-label="${isCollapsed ? "展开任务节点" : "收起任务节点"}" aria-expanded="${String(!isCollapsed)}">
                <svg class="icon" aria-hidden="true"><use href="#icon-chevron"></use></svg>
              </button>
            </div>
          </div>
          <div class="flow-node-grid">
            <label>
              ${flowNodeFieldLabel("goal", "节点目标")}
              <textarea data-flow-node-field="goal" rows="2" placeholder="这个阶段要让 AI 完成什么">${escapeHtml(node.goal)}</textarea>
            </label>
            <label>
              ${flowNodeFieldLabel("completionCriteria", "完成条件")}
              <textarea data-flow-node-field="completionCriteria" rows="2" placeholder="什么情况下可以进入下一节点">${escapeHtml(node.completionCriteria)}</textarea>
            </label>
            <label>
              ${flowNodeFieldLabel("collectFields", "收集字段")}
              <textarea data-flow-node-field="collectFields" rows="3" placeholder="每行一个，例如：手机号">${escapeHtml(joinLines(node.collectFields))}</textarea>
            </label>
            <label>
              ${flowNodeFieldLabel("conversationTips", "交流技巧")}
              <textarea data-flow-node-field="conversationTips" rows="3" placeholder="每行一个，例如：先回应再追问">${escapeHtml(joinLines(node.conversationTips))}</textarea>
            </label>
          </div>
          <section class="activation-editor ${activationEnabled ? "is-active" : ""}" aria-label="客户激活设置">
            <div class="activation-toolbar">
              <label class="toggle activation-toggle">
                <input data-flow-node-activation-field="enabled" type="checkbox" ${activationEnabled ? "checked" : ""} />
                <span>${icon("send")}启用客户激活</span>
              </label>
              <label class="toggle activation-toggle">
                <input data-flow-node-activation-field="polishByAgent" type="checkbox" ${activationPolishByAgent ? "checked" : ""} />
                <span>${icon("terminal")}Agent 美化话术</span>
              </label>
              <label>
                <span class="field-label">${icon("clock")}激活间隔（分钟）</span>
                <input data-flow-node-activation-field="intervalMinutes" type="number" min="1" value="${escapeHtml(activationIntervalMinutes)}" />
              </label>
              <label>
                <span class="field-label">${icon("refresh")}激活次数</span>
                <input data-flow-node-activation-field="maxTimes" type="number" min="1" value="${escapeHtml(activationMaxTimes)}" />
              </label>
              <button class="secondary icon-button activation-add-button" data-add-activation-message="${index}" type="button" aria-label="新增话术" title="新增话术">
                ${icon("plus")}
              </button>
            </div>
            <div class="activation-messages">
              ${activationMessages
                .map((message, messageIndex) => `
                  <div class="activation-message-row">
                    <textarea data-activation-message-index="${messageIndex}" rows="2" placeholder="激活话术，例如：再提醒您一下，看到后回我一句就行">${escapeHtml(message)}</textarea>
                    <button class="danger icon-button" data-remove-activation-message="${index}:${messageIndex}" type="button" aria-label="删除激活话术" title="删除激活话术">${icon("reset")}</button>
                  </div>
                `)
                .join("")}
            </div>
          </section>
        </article>
      `;
    })
    .join("");

  els.flowNodeList.querySelectorAll("[data-flow-node-field]").forEach((input) => {
    input.addEventListener("input", () => updateDraftNodeFromInput(input));
    input.addEventListener("change", () => {
      updateDraftNodeFromInput(input);
      if (input.dataset.flowNodeField === "name") {
        renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
      }
    });
  });
  els.flowNodeList.querySelectorAll("[data-edit-flow-node-name]").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFlowNodeQuickEditor(Number(button.dataset.editFlowNodeName), "name");
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openFlowNodeQuickEditor(Number(button.dataset.editFlowNodeName), "name");
    });
  });
  els.flowNodeList.querySelectorAll("[data-flow-node-quick-field]").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFlowNodeQuickEditor(Number(button.dataset.flowNodeIndex), button.dataset.flowNodeQuickField);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openFlowNodeQuickEditor(Number(button.dataset.flowNodeIndex), button.dataset.flowNodeQuickField);
    });
  });
  els.flowNodeList.querySelectorAll("[data-flow-node-activation-field]").forEach((input) => {
    input.addEventListener("input", () => updateDraftNodeActivationFromInput(input));
    input.addEventListener("change", () => updateDraftNodeActivationFromInput(input));
  });
  els.flowNodeList.querySelectorAll("[data-activation-message-index]").forEach((input) => {
    input.addEventListener("input", () => updateDraftNodeActivationMessage(input));
    input.addEventListener("paste", (event) => {
      const card = input.closest("[data-flow-node-index]");
      splitPastedActivationMessages(
        event,
        Number(card?.dataset.flowNodeIndex),
        Number(input.dataset.activationMessageIndex)
      );
    });
  });
  els.flowNodeList.querySelectorAll("[data-add-activation-message]").forEach((button) => {
    button.addEventListener("click", () => addActivationMessage(Number(button.dataset.addActivationMessage)));
  });
  els.flowNodeList.querySelectorAll("[data-remove-activation-message]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeIndex, messageIndex] = button.dataset.removeActivationMessage.split(":").map(Number);
      removeActivationMessage(nodeIndex, messageIndex);
    });
  });
  els.flowNodeList.querySelectorAll("[data-remove-flow-node]").forEach((button) => {
    button.addEventListener("click", () => {
      if (flowDraftNodes.length <= 1) {
        toast("至少保留一个节点");
        return;
      }
      flowDraftNodes.splice(Number(button.dataset.removeFlowNode), 1);
      collapsedFlowNodes.delete(button.closest("[data-flow-node-collapse-key]")?.dataset.flowNodeCollapseKey || "");
      renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
      syncFlowJsonTextarea();
    });
  });
  els.flowNodeList.querySelectorAll("[data-toggle-flow-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest("[data-flow-node-collapse-key]");
      const collapseKey = card?.dataset.flowNodeCollapseKey || "";
      if (!collapseKey) return;
      if (collapsedFlowNodes.has(collapseKey)) {
        collapsedFlowNodes.delete(collapseKey);
      } else {
        collapsedFlowNodes.add(collapseKey);
      }
      renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
    });
  });
}

async function loadFlowMachine({ useDefault = false } = {}) {
  if (!state.selectedBotId) return;
  const data = await request(
    `/api/flow-machines/${encodeURIComponent(state.selectedBotId)}${useDefault ? "?default=1" : ""}`
  );
  currentFlowMachine = data.machine || null;
  if (currentFlowMachine?.config) {
    els.flowMachineForm.enabled.checked = Boolean(currentFlowMachine.enabled);
    setFlowEditorFromConfig(currentFlowMachine.config);
  } else {
    els.flowMachineForm.enabled.checked = false;
    setFlowEditorFromConfig({});
  }
  renderFlowSessionNodeFilter();
}

async function saveFlowMachine(event) {
  event.preventDefault();
  if (!state.selectedBotId) {
    toast("请先选择 Bot");
    return;
  }
  const config = buildFlowConfigFromEditor();
  const data = await request(`/api/flow-machines/${encodeURIComponent(state.selectedBotId)}`, {
    method: "PUT",
    body: JSON.stringify({
      enabled: els.flowMachineForm.enabled.checked,
      config
    })
  });
  currentFlowMachine = data.machine;
  setFlowEditorFromConfig(currentFlowMachine.config);
  toast("状态机已保存");
  await loadFlowSessions();
}

async function loadDefaultFlowMachine() {
  if (!state.selectedBotId) {
    toast("请先选择 Bot");
    return;
  }
  await loadFlowMachine({ useDefault: true });
  toast("模板已载入，确认后请保存");
}

function addFlowNode() {
  const node = createBlankFlowNode(flowDraftNodes.length + 1);
  flowDraftNodes.push(node);
  collapsedFlowNodes.add(flowNodeCollapseKey(node, flowDraftNodes.length - 1));
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function applyFlowJsonToEditor() {
  try {
    const config = JSON.parse(els.flowMachineForm.config.value);
    setFlowEditorFromConfig(config);
    toast("JSON 已导入到表单");
  } catch {
    toast("状态机 JSON 格式不正确");
  }
}

function exportFlowMachine() {
  const config = buildFlowConfigFromEditor();
  if (!config.nodes.length) {
    toast("当前没有可导出的状态机");
    return;
  }
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.name || "flow-machine"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadFlowSessions() {
  if (!state.selectedBotId) return;
  const params = new URLSearchParams({ botId: state.selectedBotId, limit: "100" });
  const data = await request(`/api/flow-sessions?${params.toString()}`);
  currentFlowSessions = data.sessions || [];
  renderFlowSessionNodeFilter();
  renderFlowSessions();
}

function sortFlowSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const aHuman = a.handoffStatus === "human" ? 1 : 0;
    const bHuman = b.handoffStatus === "human" ? 1 : 0;
    if (aHuman !== bHuman) return bHuman - aHuman;
    return Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || 0)
      - Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || 0);
  });
}

function getVisibleFlowSessions() {
  const from = els.flowSessionDateFrom.value ? Date.parse(`${els.flowSessionDateFrom.value}T00:00:00`) : null;
  const to = els.flowSessionDateTo.value ? Date.parse(`${els.flowSessionDateTo.value}T23:59:59`) : null;
  const assetFilter = els.flowSessionAssetFilter.value;
  const nodeFilter = els.flowSessionNodeFilter.value;

  return sortFlowSessions(currentFlowSessions.filter((session) => {
    const sessionTime = Date.parse(session.lastMessageAt || session.updatedAt || session.createdAt || 0);
    if (from && (!Number.isFinite(sessionTime) || sessionTime < from)) return false;
    if (to && (!Number.isFinite(sessionTime) || sessionTime > to)) return false;
    if (nodeFilter !== "all" && session.currentNodeId !== nodeFilter) return false;

    const assets = session.assets || {};
    const totalCount = Number(assets.totalCount || 0);
    const collectedCount = Number(assets.collectedCount || 0);
    if (assetFilter === "pending" && !(totalCount > 0 && collectedCount < totalCount)) return false;
    if (assetFilter === "complete" && !(totalCount > 0 && collectedCount >= totalCount)) return false;
    return true;
  }));
}

function renderFlowSessionNodeFilter() {
  const current = els.flowSessionNodeFilter.value || "all";
  const nodes = currentFlowMachine?.config?.nodes || [];
  els.flowSessionNodeFilter.innerHTML = [
    `<option value="all">全部</option>`,
    ...nodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name || node.id)}</option>`)
  ].join("");
  els.flowSessionNodeFilter.value = nodes.some((node) => node.id === current) ? current : "all";
}

function sessionStatusMeta(session) {
  const isHandoff = session?.handoffStatus === "human";
  return {
    className: isHandoff ? "is-human" : "is-ai",
    label: isHandoff ? "人工接手中" : "AI接待中"
  };
}

function renderFlowSessions() {
  const visibleSessions = getVisibleFlowSessions();
  els.flowSessionList.innerHTML = visibleSessions.length
    ? visibleSessions
        .map((session) => {
          const active = session.conversationKey === state.selectedFlowConversationKey;
          const name = session.receivedName || session.conversationKey;
          const status = flowNodeName(session.currentNodeId);
          const assets = session.assets || {};
          const assetSummary = assets.totalCount
            ? `${assets.collectedCount || 0}/${assets.totalCount}`
            : "0/0";
          const lastMessageAt = session.lastMessageAt || "暂无";
          const isHandoff = session.handoffStatus === "human";
          const taskTooltip = `当前任务：${status}`;
          const assetTooltip = `资产：${assetSummary}`;
          const timeTooltip = `最近消息：${lastMessageAt}`;
          const statusMeta = sessionStatusMeta(session);
          return `
            <button class="flow-session-card ${active ? "selected" : ""} ${isHandoff ? "is-handoff" : ""}" data-flow-session="${escapeHtml(session.conversationKey)}" type="button">
              <img class="flow-session-avatar" src="./assets/ddeer.png" alt="" aria-hidden="true" />
              <span class="flow-session-main">
                <span class="flow-session-name-row">
                  <strong>${escapeHtml(name)}</strong>
                  <em class="flow-session-status ${escapeHtml(statusMeta.className)}" title="${escapeHtml(statusMeta.label)}">${escapeHtml(statusMeta.label)}</em>
                </span>
                <span class="flow-session-tools">
                  <small class="flow-session-icons">
                    <span class="session-icon" title="${escapeHtml(taskTooltip)}" data-tooltip="${escapeHtml(taskTooltip)}" aria-label="${escapeHtml(taskTooltip)}">${icon("edit")}</span>
                    <span class="session-icon" title="${escapeHtml(assetTooltip)}" data-tooltip="${escapeHtml(assetTooltip)}" aria-label="${escapeHtml(assetTooltip)}">${icon("briefcase")}</span>
                    <span class="session-icon" title="${escapeHtml(timeTooltip)}" data-tooltip="${escapeHtml(timeTooltip)}" aria-label="${escapeHtml(timeTooltip)}">${icon("clock")}</span>
                  </small>
                  <span class="handoff-button ${isHandoff ? "is-active" : ""}" data-flow-handoff="${escapeHtml(session.conversationKey)}" title="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}" aria-label="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}">
                    ${icon(isHandoff ? "refresh" : "users")}
                  </span>
                </span>
              </span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state">${currentFlowSessions.length ? "没有符合筛选条件的会话。" : "暂无私聊状态机会话。启用状态机后，新的私聊会自动出现在这里。"}</div>`;

  els.flowSessionList.querySelectorAll("[data-flow-session]").forEach((button) => {
    button.addEventListener("click", () =>
      openFlowSession(button.dataset.flowSession).catch((error) => toast(error.message))
    );
  });
  els.flowSessionList.querySelectorAll("[data-flow-handoff]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedConversationHandoff(button.dataset.flowHandoff).catch((error) => toast(error.message));
    });
  });
}

function renderConversationAssets(assets = { fields: [], totalCount: 0, collectedCount: 0 }) {
  const fields = Array.isArray(assets.fields) ? assets.fields : [];
  const totalCount = Number(assets.totalCount || fields.length);
  const collectedCount = Number(assets.collectedCount || fields.filter((field) => field.collected).length);
  currentConversationAssets = { fields, totalCount, collectedCount };

  els.assetsButton.hidden = totalCount <= 0;
  els.assetsButton.disabled = totalCount <= 0;
  els.assetsCount.textContent = `${collectedCount}/${totalCount}`;
  if (totalCount <= 0) {
    els.assetsPanel.hidden = true;
    els.assetsPanel.innerHTML = "";
    return;
  }
  els.assetsPanel.hidden = true;

  els.assetsPanel.innerHTML = `
    <div class="assets-panel-head">
      <strong>会话资产</strong>
      <span>${collectedCount}/${totalCount} 已收集</span>
    </div>
    <div class="asset-list">
      ${fields
        .map((field) => `
          <div class="asset-row ${field.collected ? "is-collected" : "is-empty"}">
            <span>${escapeHtml(field.label || field.key)}</span>
            <strong>${field.collected ? escapeHtml(field.value) : "未收集"}</strong>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function syncHandoffButton(session = currentFlowSession) {
  currentFlowSession = session || null;
  const hasSession = Boolean(currentFlowSession && state.selectedFlowConversationKey);
  els.handoffStatusBanner.hidden = !hasSession || currentFlowSession.handoffStatus !== "human";
  if (!hasSession) {
    if (els.chatStatusBadge) els.chatStatusBadge.hidden = true;
    return;
  }

  const isHandoff = currentFlowSession.handoffStatus === "human";
  const statusMeta = sessionStatusMeta(currentFlowSession);
  if (els.chatStatusBadge) {
    els.chatStatusBadge.hidden = false;
    els.chatStatusBadge.textContent = statusMeta.label;
    els.chatStatusBadge.classList.toggle("is-ai", !isHandoff);
    els.chatStatusBadge.classList.toggle("is-human", isHandoff);
  }
  els.handoffStatusBanner.classList.toggle("is-active", isHandoff);
}

function renderChatMessageContent(message) {
  const mediaPayload = message.rawPayload?.messagePayload;
  const mediaType = String(message.rawPayload?.messageType || "");
  if (mediaType === "media" && mediaPayload?.fileUrl) {
    const fileType = String(mediaPayload.fileType || "image");
    const label = {
      image: "图片",
      file: "文件",
      video: "视频",
      audio: "音频"
    }[fileType] || "媒体";
    const caption = mediaPayload.extraText || message.content || "";
    const media = fileType === "image"
      ? `<img class="chat-media-image" src="${escapeHtml(mediaPayload.fileUrl)}" alt="${escapeHtml(mediaPayload.objectName || label)}" />`
      : `<a class="chat-media-link" href="${escapeHtml(mediaPayload.fileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(mediaPayload.objectName || label)}</a>`;
    return `
      <div class="chat-media">
        ${media}
        ${caption ? `<div class="chat-text">${escapeHtml(caption)}</div>` : ""}
      </div>
    `;
  }
  return `<div class="chat-text">${escapeHtml(message.content)}</div>`;
}

async function openFlowSession(conversationKey) {
  state.selectedFlowConversationKey = conversationKey;
  const session = currentFlowSessions.find((item) => item.conversationKey === conversationKey);
  renderFlowSessions();
  els.chatTitle.textContent = session?.receivedName || conversationKey;
  const params = new URLSearchParams({ limit: "300", botId: state.selectedBotId });
  const data = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}?${params.toString()}`);
  currentFlowSession = data.session || session || null;
  syncHandoffButton(currentFlowSession);
  renderConversationAssets(data.assets || session?.assets || { fields: [], totalCount: 0, collectedCount: 0 });
  renderChatMessages(data.messages || []);
  els.flowEventsOutput.textContent = JSON.stringify(data.events || [], null, 2);
}

async function toggleSelectedConversationHandoff(conversationKey = state.selectedFlowConversationKey) {
  const targetSession = currentFlowSessions.find((session) => session.conversationKey === conversationKey)
    || (conversationKey === state.selectedFlowConversationKey ? currentFlowSession : null);
  if (!state.selectedBotId || !conversationKey || !targetSession) {
    toast("请先选择会话");
    return;
  }
  const nextStatus = targetSession.handoffStatus === "human" ? "ai" : "human";
  const data = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/handoff`, {
    method: "PUT",
    body: JSON.stringify({
      botId: state.selectedBotId,
      handoffStatus: nextStatus,
      reason: nextStatus === "human" ? "控制台人工接手" : "控制台恢复 AI"
    })
  });
  currentFlowSessions = currentFlowSessions.map((session) =>
    session.conversationKey === data.session.conversationKey
      ? { ...session, ...data.session }
      : session
  );
  if (conversationKey === state.selectedFlowConversationKey) {
    currentFlowSession = {
      ...(currentFlowSession || {}),
      ...data.session
    };
    syncHandoffButton(currentFlowSession);
  }
  renderFlowSessions();
  toast(nextStatus === "human" ? "已切换为人工接手" : "已恢复 AI 接手");
}

function renderChatMessages(messages) {
  els.chatMessages.innerHTML = messages.length
    ? messages
        .map((message) => {
          const outbound = message.direction === "outbound";
          const avatar = outbound ? "./assets/bot-avatar.png" : "./assets/ddeer.png";
          const sender = message.senderName || (outbound ? "机器人" : "客户");
          return `
          <div class="chat-bubble-row ${outbound ? "outbound" : "inbound"}">
            ${outbound ? "" : `<img class="chat-avatar" src="${avatar}" alt="" aria-hidden="true" />`}
            <div class="chat-bubble">
              <div class="chat-meta">
                <small>${escapeHtml(sender)}</small>
                <time>${escapeHtml(message.createdAt || "")}</time>
              </div>
              ${renderChatMessageContent(message)}
            </div>
            ${outbound ? `<img class="chat-avatar" src="${avatar}" alt="" aria-hidden="true" />` : ""}
          </div>
        `;
        })
        .join("")
    : `<div class="empty-state">暂无会话记录</div>`;
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function resetSelectedConversation() {
  if (!state.selectedBotId || !state.selectedFlowConversationKey) {
    toast("请先选择会话");
    return;
  }
  await request(`/api/flow-sessions/${encodeURIComponent(state.selectedFlowConversationKey)}/reset`, {
    method: "POST",
    body: JSON.stringify({
      botId: state.selectedBotId,
      reason: "控制台清空会话"
    })
  });
  toast("会话已清空");
  await loadFlowSessions();
  await openFlowSession(state.selectedFlowConversationKey);
}

function openConfirmDialog() {
  if (!state.selectedBotId || !state.selectedFlowConversationKey) {
    toast("请先选择会话");
    return;
  }
  els.confirmDialog.hidden = false;
}

function closeConfirmDialog() {
  els.confirmDialog.hidden = true;
}

function toggleAssetsPanel() {
  if (!currentConversationAssets.totalCount) return;
  els.assetsPanel.hidden = !els.assetsPanel.hidden;
}

async function saveDebugReply(event) {
  event.preventDefault();
  await request("/api/settings/debug-reply", {
    method: "PUT",
    body: JSON.stringify({
      enabled: els.debugReplyForm.enabled.checked,
      trigger: els.debugReplyForm.trigger.value,
      reply: els.debugReplyForm.reply.value
    })
  });
  toast("调试自动回复已保存");
}

async function createProactiveTask(event) {
  event.preventDefault();
  const data = new FormData(els.proactiveForm);
  const messageType = String(data.get("messageType") || "text");
  const payload = {
    botId: state.selectedBotId,
    title: String(data.get("title") || "").trim(),
    messageType,
    content: String(data.get("content") || "").trim(),
    targets: getSelectedTargets()
  };

  if (messageType === "media") {
    payload.fileType = String(data.get("fileType") || "image");
    payload.fileUrl = String(data.get("fileUrl") || "").trim();
    payload.objectName = fileNameFromUrl(payload.fileUrl);
    payload.extraText = String(data.get("extraText") || "").trim();
    const localFile = els.proactiveForm.uploadFile.files?.[0];
    if (localFile) {
      toast("正在上传文件...");
      const uploaded = await uploadLocalFile(localFile);
      payload.fileUrl = uploaded.url;
      payload.objectName = uploaded.originalName || uploaded.filename || localFile.name;
    }
  }

  if (!payload.botId) {
    toast("请先选择 Bot");
    return;
  }
  if (!payload.targets.length) {
    toast("请选择目标列表");
    return;
  }
  if (messageType === "text" && !payload.content) {
    toast("请填写推送内容");
    return;
  }
  if (messageType === "media" && !payload.fileUrl) {
    toast("请填写文件 URL");
    return;
  }

  toast("正在创建并发送...");
  const result = await request("/api/proactive/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  toast(`主动任务已创建：#${result.task.id}`);
  selectedTargets.clear();
  renderSelectedTargets();
  renderTargetList();
  els.proactiveForm.title.value = "";
  els.proactiveForm.content.value = "";
  els.proactiveForm.fileUrl.value = DEFAULT_FILE_URL;
  els.proactiveForm.extraText.value = "";
  els.proactiveForm.uploadFile.value = "";
  await loadProactiveTasks();
}

function syncMessageTypeFields() {
  const type = els.messageTypeInput.value || "text";
  els.messageFields.forEach((field) => {
    const active = field.dataset.messageField === type;
    field.hidden = !active;
    field.querySelectorAll("textarea, input, select").forEach((input) => {
      if (input.name === "content") input.required = type === "text";
      if (input.name === "fileUrl") input.required = type === "media";
    });
  });
}

async function loadProactiveTasks() {
  if (!state.selectedBotId) {
    renderProactiveTasks([]);
    return;
  }
  const params = new URLSearchParams({ limit: "20" });
  params.set("botId", state.selectedBotId);
  const dateFrom = dateToLocalIsoStart(els.taskDateFrom.value);
  const dateTo = dateToLocalIsoNextDay(els.taskDateTo.value || els.taskDateFrom.value);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const data = await request(`/api/proactive/tasks?${params.toString()}`);
  renderProactiveTasks(data.tasks || []);
}

function renderProactiveTasks(tasks) {
  if (!tasks.length) {
    els.proactiveTasksTable.innerHTML = `<tr><td class="empty-state" colspan="6">暂无当前 Bot 的主动推送任务</td></tr>`;
    return;
  }
  els.proactiveTasksTable.innerHTML = tasks
    .map((task) => {
      const progress = `${task.sentCount || 0}/${task.totalCount || 0}`;
      const failed = task.failedCount ? `，失败 ${task.failedCount}` : "";
      const content = task.content || "";
      const typeLabel = {
        text: "文本",
        media: "媒体"
      }[task.messageType || "text"] || "文本";
      return `
        <tr>
          <td class="task-content-cell">
            <small class="message-type-badge">${escapeHtml(typeLabel)}</small>
            <span class="task-content-text" title="${escapeHtml(content)}">${escapeHtml(content)}</span>
          </td>
          <td class="muted">${escapeHtml(botDisplayName(task.botId))}</td>
          <td><span class="pill ${task.status === "sent" ? "ok" : task.status === "failed" ? "bad" : "off"}">${escapeHtml(task.status)}</span></td>
          <td>${escapeHtml(progress + failed)}</td>
          <td class="muted">${escapeHtml(task.updatedAt || task.createdAt || "")}</td>
          <td><button class="secondary" data-task="${task.id}" type="button">${icon("info")}详情</button></td>
        </tr>
      `;
    })
    .join("");

  els.proactiveTasksTable.querySelectorAll("button[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      const data = await request(`/api/proactive/tasks/${encodeURIComponent(button.dataset.task)}`);
      els.logsOutput.textContent = JSON.stringify(data, null, 2);
      toast(`已加载任务 #${button.dataset.task}`);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.saveKeyButton?.addEventListener("click", () => {
  state.apiKey = els.apiKeyInput?.value.trim() || "";
  localStorage.setItem("worktool_console_api_key", state.apiKey);
  toast("管理密钥已保存");
});

els.refreshButton?.addEventListener("click", () => loadBots().catch((error) => toast(error.message)));
els.lockBotButton.addEventListener("click", () => lockCurrentBot().catch((error) => toast(error.message)));
els.unlockCancelButton.addEventListener("click", closeUnlockDialog);
els.unlockDialog.addEventListener("click", (event) => {
  if (event.target === els.unlockDialog) closeUnlockDialog();
});
els.unlockKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    unlockPendingBot().catch((error) => toast(error.message));
  }
});
els.unlockAcceptButton.addEventListener("click", () =>
  unlockPendingBot().catch((error) => toast(error.message))
);
els.botForm.addEventListener("submit", (event) => saveBot(event).catch((error) => toast(error.message)));
els.accessKeyForm.addEventListener("submit", (event) =>
  saveAccessKey(event).catch((error) => toast(error.message))
);
els.debugReplyForm.addEventListener("submit", (event) =>
  saveDebugReply(event).catch((error) => toast(error.message))
);
els.flowMachineForm.addEventListener("submit", (event) =>
  saveFlowMachine(event).catch((error) => toast(error.message))
);
els.addFlowNodeButton.addEventListener("click", addFlowNode);
els.applyFlowJsonButton.addEventListener("click", applyFlowJsonToEditor);
els.flowMachineForm.entryNodeId.addEventListener("change", syncFlowJsonTextarea);
els.loadDefaultFlowButton.addEventListener("click", () =>
  loadDefaultFlowMachine().catch((error) => toast(error.message))
);
els.exportFlowButton.addEventListener("click", exportFlowMachine);
els.refreshFlowSessionsButton.addEventListener("click", () =>
  Promise.all([loadFlowMachine(), loadFlowSessions()]).catch((error) => toast(error.message))
);
[
  els.flowSessionDateFrom,
  els.flowSessionDateTo,
  els.flowSessionAssetFilter,
  els.flowSessionNodeFilter
].forEach((control) => {
  control.addEventListener("change", renderFlowSessions);
});
els.resetConversationButton.addEventListener("click", openConfirmDialog);
els.confirmCancelButton.addEventListener("click", closeConfirmDialog);
els.confirmDialog.addEventListener("click", (event) => {
  if (event.target === els.confirmDialog) closeConfirmDialog();
});
els.confirmAcceptButton.addEventListener("click", () =>
  resetSelectedConversation()
    .then(closeConfirmDialog)
    .catch((error) => toast(error.message))
);
els.assetsButton.addEventListener("click", toggleAssetsPanel);
els.proactiveForm.addEventListener("submit", (event) =>
  createProactiveTask(event).catch((error) => toast(error.message))
);
els.messageTypeInput.addEventListener("change", syncMessageTypeFields);
els.taskDateFrom.addEventListener("change", () =>
  loadProactiveTasks().catch((error) => toast(error.message))
);
els.taskDateTo.addEventListener("change", () =>
  loadProactiveTasks().catch((error) => toast(error.message))
);
els.targetSearchInput.addEventListener("input", () => renderTargetList());
els.loadTargetsButton.addEventListener("click", () =>
  loadAddressBookTargets().catch((error) => toast(error.message))
);
els.selectPrivateTargetsButton.addEventListener("click", () => toggleTargetsByType("private"));
els.selectGroupTargetsButton.addEventListener("click", () => toggleTargetsByType("group"));
els.clearTargetsButton.addEventListener("click", clearSelectedTargets);
document.querySelectorAll("[data-target-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    targetFilter = button.dataset.targetFilter;
    document.querySelectorAll("[data-target-filter]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    renderTargetList();
  });
});
els.workspaceTabs.forEach((button) => {
  button.addEventListener("click", () => switchWorkspaceTab(button.dataset.workspaceTab));
});
els.refreshProactiveButton.addEventListener("click", () =>
  loadProactiveTasks().catch((error) => toast(error.message))
);
els.resetFormButton.addEventListener("click", () => {
  resetBotContext();
});
els.loadLogsButton.addEventListener("click", () => loadLogs().catch((error) => toast(error.message)));
els.collapseButtons.forEach((button) => {
  const panel = document.querySelector(`#${button.dataset.collapseTarget}`);
  button.setAttribute("aria-expanded", "true");
  button.addEventListener("click", () => {
    panel?.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!panel?.classList.contains("is-collapsed")));
  });
});

syncRoleVisibility();
loadBots()
  .catch((error) => {
    els.logsOutput.textContent = `无法加载配置：${error.message}`;
  });
syncMessageTypeFields();
