const PROACTIVE_MAX_ATTACHMENTS = 5;
const SELECTED_TARGET_PREVIEW_LIMIT = 3;
const BEIJING_TIME_ZONE = "Asia/Shanghai";
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const DEFAULT_REPLY_WAIT_FALLBACK_REPLY = "刚刚这边有点忙，我稍后回复你哈";
const { createInteractionLock, intersectTargetMaps } = window.ProactiveTargetSelection;

const state = {
  apiKey: localStorage.getItem("worktool_console_api_key") || "",
  selectedBotId: "",
  botContextVersion: 0,
  replyWaitLoadVersion: 0,
  historyAnalysisLoadVersion: 0,
  tagSyncLoadVersion: 0,
  tagSyncTrackVersion: 0,
  tagSyncConfig: null,
  pendingConfirmationResolve: null,
  selectedFlowConversationKey: "",
  loadingFlowConversationKey: "",
  currentRole: "",
  botSessions: JSON.parse(localStorage.getItem("worktool_console_bot_sessions") || "{}"),
  pendingUnlockBotId: "",
  unlockMode: "bot",
  pendingAdminKeyResolve: null,
  proactiveSubmitting: false,
  proactiveFiltersLoading: false,
  proactiveUploadFiles: [],
  proactiveTargetTags: [],
  proactiveTagSelections: new Map(),
  proactiveManualTargetKeys: new Set(),
  flowSessionsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  proactiveTargetsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  proactiveTasksPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  groups: [],
  selectedGroupId: "",
  selectedGroupDetail: null,
  createGroupContacts: [],
  createGroupContactIds: new Set(),
  createGroupContactsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  tagSchema: {
    dateTag: { enabled: true, cutoffTime: "00:00", effectiveAt: "" },
    groups: []
  }
};

const els = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  refreshButton: document.querySelector("#refreshButton"),
  lockBotButton: document.querySelector("#lockBotButton"),
  unlockDialog: document.querySelector("#unlockDialog"),
  unlockTitle: document.querySelector("#unlockTitle"),
  unlockBotName: document.querySelector("#unlockBotName"),
  unlockKeyLabel: document.querySelector("#unlockKeyLabel"),
  unlockKeyInput: document.querySelector("#unlockKeyInput"),
  unlockCancelButton: document.querySelector("#unlockCancelButton"),
  unlockAcceptButton: document.querySelector("#unlockAcceptButton"),
  proactivePanel: document.querySelector("#proactivePanel"),
  workspaceTabBar: document.querySelector(".workspace-tabs"),
  workspaceTabs: document.querySelectorAll("[data-workspace-tab]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),
  workspaceLockPanel: document.querySelector("#workspaceLockPanel"),
  workspaceEmptyState: document.querySelector("#workspaceEmptyState"),
  botForm: document.querySelector("#botForm"),
  botAccessKeyForm: document.querySelector("#botAccessKeyForm"),
  cockpitConfigForm: document.querySelector("#cockpitConfigForm"),
  generateCockpitReportButton: document.querySelector("#generateCockpitReportButton"),
  replyWaitPanel: document.querySelector("#replyWaitPanel"),
  replyWaitForm: document.querySelector("#replyWaitForm"),
  tagSyncPanel: document.querySelector("#tagSyncPanel"),
  tagSyncForm: document.querySelector("#tagSyncForm"),
  tagSyncNightlyEnabled: document.querySelector("#tagSyncNightlyEnabled"),
  tagSyncDateTagsEnabled: document.querySelector("#tagSyncDateTagsEnabled"),
  tagSyncWindowStart: document.querySelector("#tagSyncWindowStart"),
  tagSyncWindowEnd: document.querySelector("#tagSyncWindowEnd"),
  tagSyncRunButton: document.querySelector("#tagSyncRunButton"),
  tagSyncResult: document.querySelector("#tagSyncResult"),
  flowMachineForm: document.querySelector("#flowMachineForm"),
  refreshGroupsButton: document.querySelector("#refreshGroupsButton"),
  createGroupButton: document.querySelector("#createGroupButton"),
  groupSearchInput: document.querySelector("#groupSearchInput"),
  groupList: document.querySelector("#groupList"),
  groupConfigPane: document.querySelector("#groupConfigPane"),
  createGroupDialog: document.querySelector("#createGroupDialog"),
  createGroupForm: document.querySelector("#createGroupForm"),
  createGroupCancelButton: document.querySelector("#createGroupCancelButton"),
  createGroupContactSearch: document.querySelector("#createGroupContactSearch"),
  createGroupContactList: document.querySelector("#createGroupContactList"),
  createGroupContactPagination: document.querySelector("#createGroupContactPagination"),
  addFlowNodeButton: document.querySelector("#addFlowNodeButton"),
  applyFlowJsonButton: document.querySelector("#applyFlowJsonButton"),
  importFlowFile: document.querySelector("#importFlowFile"),
  flowNodeList: document.querySelector("#flowNodeList"),
  loadDefaultFlowButton: document.querySelector("#loadDefaultFlowButton"),
  exportFlowButton: document.querySelector("#exportFlowButton"),
  refreshFlowSessionsButton: document.querySelector("#refreshFlowSessionsButton"),
  flowSessionList: document.querySelector("#flowSessionList"),
  flowSessionsPaginationEl: document.querySelector("#flowSessionsPagination"),
  flowSessionTypeButtons: document.querySelectorAll("[data-flow-session-type]"),
  flowSessionFilters: document.querySelector(".flow-session-filters"),
  flowSessionSearchLabel: document.querySelector("#flowSessionSearchLabel"),
  flowSessionSearchInput: document.querySelector("#flowSessionSearchInput"),
  flowSessionNodeFilterField: document.querySelector("#flowSessionNodeFilterField"),
  flowSessionNodeFilter: document.querySelector("#flowSessionNodeFilter"),
  flowSessionTagFilter: document.querySelector("#flowSessionTagFilter"),
  flowSessionTagFilterButton: document.querySelector("#flowSessionTagFilterButton"),
  flowSessionTagFilterMenu: document.querySelector("#flowSessionTagFilterMenu"),
  flowSessionTagMenu: document.querySelector("#flowSessionTagMenu"),
  flowSessionDateTagFilter: document.querySelector("#flowSessionDateTagFilter"),
  tagAlertCenter: document.querySelector("#tagAlertCenter"),
  tagAlertButton: document.querySelector("#tagAlertButton"),
  tagAlertCount: document.querySelector("#tagAlertCount"),
  tagAlertPanel: document.querySelector("#tagAlertPanel"),
  tagAlertList: document.querySelector("#tagAlertList"),
  tagAlertAudio: document.querySelector("#tagAlertAudio"),
  chatTitle: document.querySelector("#chatTitle"),
  chatStatusBadge: document.querySelector("#chatStatusBadge"),
  chatTagList: document.querySelector("#chatTagList"),
  chatMessages: document.querySelector("#chatMessages"),
  flowEventsOutput: document.querySelector("#flowEventsOutput"),
  assetsButton: document.querySelector("#assetsButton"),
  assetsCount: document.querySelector("#assetsCount"),
  assetsPanel: document.querySelector("#assetsPanel"),
  manualReplyComposer: document.querySelector("#manualReplyComposer"),
  manualReplyInput: document.querySelector("#manualReplyInput"),
  manualReplyEmojiBar: document.querySelector("#manualReplyEmojiBar"),
  manualReplySendButton: document.querySelector("#manualReplySendButton"),
  resetConversationButton: document.querySelector("#resetConversationButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmCancelButton: document.querySelector("#confirmCancelButton"),
  confirmAcceptButton: document.querySelector("#confirmAcceptButton"),
  conversationResetLoadingDialog: document.querySelector("#conversationResetLoadingDialog"),
  proactiveForm: document.querySelector("#proactiveForm"),
  proactiveUploadDropzone: document.querySelector("#proactiveUploadDropzone"),
  proactiveUploadFile: document.querySelector("#proactiveUploadFile"),
  proactiveUploadName: document.querySelector("#proactiveUploadName"),
  proactiveAttachmentList: document.querySelector("#proactiveAttachmentList"),
  proactiveMessageFields: document.querySelector("#proactiveMessageFields"),
  proactiveUploadOverlay: document.querySelector("#proactiveUploadOverlay"),
  proactiveSubmitButton: document.querySelector("#proactiveSubmitButton"),
  proactiveSubmitText: document.querySelector("#proactiveSubmitText"),
  proactiveFileUrl: document.querySelector("#proactiveFileUrl"),
  proactiveTitle: document.querySelector("#proactiveTitle"),
  proactiveContent: document.querySelector("#proactiveContent"),
  proactiveScheduleEnabled: document.querySelector("#proactiveScheduleEnabled"),
  proactiveScheduledAtField: document.querySelector("#proactiveScheduledAtField"),
  proactiveScheduledAt: document.querySelector("#proactiveScheduledAt"),
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
  targetTagSelect: document.querySelector("#targetTagSelect"),
  targetTagSelectButton: document.querySelector("#targetTagSelectButton"),
  targetTagSelectMenu: document.querySelector("#targetTagSelectMenu"),
  targetDateTagSelect: document.querySelector("#targetDateTagSelect"),
  proactiveFilterControls: document.querySelector("#proactiveFilterControls"),
  proactiveFilterLoading: document.querySelector("#proactiveFilterLoading"),
  targetList: document.querySelector("#targetList"),
  selectedTargetsSummary: document.querySelector("#selectedTargetsSummary"),
  selectedTargetsSummaryButton: document.querySelector("#selectedTargetsSummaryButton"),
  selectedTargetsCount: document.querySelector("#selectedTargetsCount"),
  selectedTargetsPreview: document.querySelector("#selectedTargetsPreview"),
  selectedTargetsMoreButton: document.querySelector("#selectedTargetsMoreButton"),
  selectedTargetsPopover: document.querySelector("#selectedTargetsPopover"),
  targetPaginationEl: document.querySelector("#targetPagination"),
  resetFormButton: document.querySelector("#resetFormButton"),
  botsTable: document.querySelector("#botsTable"),
  botCount: document.querySelector("#botCount"),
  proactiveTasksTable: document.querySelector("#proactiveTasksTable"),
  proactiveTasksPaginationEl: document.querySelector("#proactiveTasksPagination"),
  logType: document.querySelector("#logType"),
  loadLogsButton: document.querySelector("#loadLogsButton"),
  logsOutput: document.querySelector("#logsOutput"),
  tagGroupList: document.querySelector("#tagGroupList"),
  addTagGroupButton: document.querySelector("#addTagGroupButton"),
  saveTagsButton: document.querySelector("#saveTagsButton"),
  importTagsButton: document.querySelector("#importTagsButton"),
  exportTagsButton: document.querySelector("#exportTagsButton"),
  importTagsFile: document.querySelector("#importTagsFile"),
  toast: document.querySelector("#toast"),
  botContextPanels: document.querySelectorAll(".bot-context-panel"),
  collapseButtons: document.querySelectorAll("[data-collapse-target]")
};

const proactiveFilterLock = createInteractionLock(setProactiveFilterLoading);

if (els.apiKeyInput) els.apiKeyInput.value = state.apiKey;
const today = formatLocalDate();
els.taskDateFrom.value = today;
els.taskDateTo.value = today;

function headers(extra = {}, botId = state.selectedBotId) {
  const result = {
    "Content-Type": "application/json",
    ...extra
  };
  const session = botId ? getBotSession(botId) : null;
  if (!result["x-api-key"] && !result["x-bot-session-token"] && session?.token) {
    result["x-bot-session-token"] = session.token;
  } else if (!result["x-api-key"] && !result["x-bot-session-token"] && state.apiKey) {
    result["x-api-key"] = state.apiKey;
  }
  return result;
}

const TOAST_CONFIG = {
  success: { icon: "check", type: "success" },
  error: { icon: "alert", type: "error" },
  info: { icon: "info", type: "info" }
};

function inferToastType(message) {
  const text = String(message || "");
  if (/失败|错误|不正确|异常|不可用|无权限|需要|请先|请选择|请输入|不能|最多只能|暂无/.test(text)) {
    return "error";
  }
  if (/^(已|绑定已保存|Bot 已解锁|状态机已保存|主动任务已创建|JSON 已导入|模板已载入)|已(保存|加载|发送|清空|删除|修改|选择|取消|切换|恢复|上锁|导入)/.test(text)) {
    return "success";
  }
  return "info";
}

function toast(message, type = inferToastType(message)) {
  const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
  els.toast.className = `toast toast-${config.type}`;
  els.toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icon(config.icon)}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function toastError(error) {
  toast(error?.message || String(error || "操作失败"), "error");
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function fieldLabelIcon(name, label) {
  return `${icon(name)}${escapeHtml(label)}`;
}

function beijingDateTimeParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatLocalDate(date = new Date()) {
  const parts = beijingDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDisplayDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return match ? `${match[1]} ${match[2]}` : String(value || "");
  }
  const parts = beijingDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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

function expireBotSession(botId) {
  if (!botId) return;
  clearBotSession(botId);
  if (state.selectedBotId === botId) {
    resetBotContext();
  } else {
    renderBots(currentBots);
  }
  loadBots().catch(() => {});
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
  document.body.classList.toggle("is-admin-role", isAdmin);
  document.body.classList.toggle("is-bot-role", state.currentRole === "bot");
  document.body.classList.toggle("is-workspace-locked", workspaceLocked);
  els.resetFormButton.hidden = !hasBot;
  if (els.lockBotButton) els.lockBotButton.hidden = !hasBot || workspaceLocked;
  if (els.workspaceLockPanel) els.workspaceLockPanel.hidden = !workspaceLocked;
  if (workspaceLocked) {
    els.tabPanels.forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove("active");
    });
  }
}

function dateToLocalIsoStart(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

function dateToLocalIsoNextDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+08:00`);
  return new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString();
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

function detectFileTypeFromName(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext)) {
    return "image";
  }
  if (["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "wmv"].includes(ext)) {
    return "video";
  }
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg", "amr", "wma"].includes(ext)) {
    return "audio";
  }
  return "file";
}

async function request(path, options = {}) {
  const { botId, ...fetchOptions } = options;
  const effectiveBotId = botId === undefined ? state.selectedBotId : botId;
  const session = effectiveBotId ? getBotSession(effectiveBotId) : null;
  const requestHeaders = headers(fetchOptions.headers || {}, effectiveBotId);
  const usedBotSession = requestHeaders["x-bot-session-token"] === session?.token;
  const response = await fetch(path, {
    ...fetchOptions,
    headers: requestHeaders
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok || data.ok === false) {
    if (response.status === 401 && usedBotSession) {
      expireBotSession(effectiveBotId);
      throw new Error("Bot 解锁已失效，请重新解锁");
    }
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return data;
}

async function uploadLocalFile(file, botId) {
  const payload = new FormData();
  payload.append("file", file);
  const response = await fetch(`/api/uploads?botId=${encodeURIComponent(botId)}`, {
    method: "POST",
    headers: {
      ...(getBotSession(botId)?.token
        ? { "x-bot-session-token": getBotSession(botId).token }
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
    enabled: data.get("enabled") === "on"
  };
}

function cockpitRecipients(value) {
  return String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

async function loadCockpitConfig({ contextVersion } = {}) {
  if (!state.selectedBotId || !els.cockpitConfigForm) return;
  const botId = state.selectedBotId;
  const data = await request(`/api/cockpit/${encodeURIComponent(botId)}/config`, { botId });
  if (contextVersion && !isCurrentBotContext(botId, contextVersion)) return;
  const config = data.config || {};
  els.cockpitConfigForm.timezone.value = "Asia/Shanghai";
  els.cockpitConfigForm.defaultNoReplyHours.value = 24;
  for (const type of ["daily", "weekly", "monthly"]) {
    els.cockpitConfigForm[`${type}Enabled`].checked = Boolean(config.schedules?.[type]?.enabled);
    els.cockpitConfigForm[`${type}Recipients`].value =
      (config.schedules?.[type]?.recipients || []).join("\n");
  }
}

async function saveCockpitConfig(event) {
  event.preventDefault();
  const form = els.cockpitConfigForm;
  const schedules = Object.fromEntries(["daily", "weekly", "monthly"].map((type) => [
    type,
    {
      enabled: form[`${type}Enabled`].checked,
      sendAt: "09:00",
      recipients: cockpitRecipients(form[`${type}Recipients`].value)
    }
  ]));
  await request(`/api/cockpit/${encodeURIComponent(state.selectedBotId)}/config`, {
    method: "PUT",
    botId: state.selectedBotId,
    body: JSON.stringify({
      timezone: form.timezone.value.trim(),
      defaultNoReplyHours: Number(form.defaultNoReplyHours.value),
      schedules
    })
  });
  toast("驾驶舱报告配置已保存");
}

async function generateCockpitReport() {
  await request(`/api/cockpit/${encodeURIComponent(state.selectedBotId)}/reports`, {
    method: "POST",
    botId: state.selectedBotId,
    body: JSON.stringify({ reportType: "daily" })
  });
  toast("日报生成任务已加入凌晨队列");
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
  if (tabName === "tags") {
    collapseAllTagCards();
    renderTagSchemaEditor();
  }
  if (tabName === "groups") {
    loadGroups().catch(toastError);
  }
  if (scrollTo) {
    requestAnimationFrame(() => scrollTo.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function syncWorkspaceSelectionState(hasBotContext) {
  if (els.workspaceEmptyState) {
    els.workspaceEmptyState.hidden = hasBotContext;
  }
  if (!hasBotContext) {
    els.workspaceTabs.forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
    });
    els.tabPanels.forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove("active");
    });
  }
}

function updateWorkspaceTabAccess(hasBotContext) {
  const workspaceLocked = isWorkspaceLocked();
  els.workspaceTabs.forEach((button) => {
    const locked = workspaceLocked || !hasBotContext;
    button.disabled = locked;
    button.setAttribute("aria-disabled", String(locked));
  });
  syncWorkspaceSelectionState(hasBotContext);
  if (
    !workspaceLocked &&
    hasBotContext &&
    !document.querySelector(".workspace-tabs button.active")
  ) {
    switchWorkspaceTab("cockpit", { force: true });
  }
}

function tabForPanel(panel) {
  return panel?.closest("[data-tab-panel]")?.dataset.tabPanel || "";
}

function setBindingState(bot = null) {
  state.selectedBotId = bot?.botId || "";
  state.currentRole = bot ? getBotSession(bot.botId)?.role || "" : "";
  const accent = bot ? getBotAccent(bot) : "";
  document.documentElement.classList.toggle("has-bot-context", Boolean(bot));
  if (accent) {
    document.documentElement.style.setProperty("--bot-accent", accent);
  } else {
    document.documentElement.style.removeProperty("--bot-accent");
  }
  updateWorkspaceTabAccess(Boolean(bot));
  syncRoleVisibility();
  els.workspaceTabBar?.classList.toggle("is-bound", Boolean(bot));
  els.workspaceTabBar?.style.setProperty("--bot-accent", accent);
  els.botContextPanels.forEach((panel) => {
    panel.classList.toggle("is-bound", Boolean(bot));
    panel.style.setProperty("--bot-accent", accent);
  });
  renderBots(currentBots);
}

function beginBotContext() {
  state.botContextVersion += 1;
  return state.botContextVersion;
}

function isCurrentBotContext(botId, contextVersion) {
  return state.selectedBotId === botId && state.botContextVersion === contextVersion;
}

function disconnectTagAlerts() {
  tagAlertClient.disconnect();
}

function connectTagAlerts(botId) {
  const authHeaders = headers({}, botId);
  if (!authHeaders["x-api-key"] && !authHeaders["x-bot-session-token"]) return;
  tagAlertClient.connect({
    botId,
    headers: headers({}, botId)
  });
}

function clearBotScopedContent() {
  disconnectTagAlerts();
  window.cockpitConsole?.clear();
  clearTimeout(proactiveSearchTimer);
  proactiveSearchTimer = null;
  proactiveFilterLock.reset();
  setFlowSessionTypeSelection("private");
  state.selectedFlowConversationKey = "";
  state.flowSessionsPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.proactiveTargetsPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.proactiveTasksPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
  state.proactiveTargetTags = [];
  state.tagSyncLoadVersion += 1;
  state.tagSyncTrackVersion += 1;
  state.tagSyncConfig = null;
  state.proactiveTagSelections.clear();
  state.proactiveManualTargetKeys.clear();
  selectedTargets.clear();
  addressBookTargets = [];
  currentFlowMachine = null;
  currentFlowSessions = [];
  currentFlowSession = null;
  flowDraftNodes = [];
  state.tagSchema = defaultTagSchema();
  collapsedFlowNodes.clear();
  collapsedTagGroups.clear();
  syncHandoffButton(null);
  renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
  els.chatTitle.textContent = emptyFlowSessionTitle();
  if (els.chatTagList) els.chatTagList.innerHTML = "";
  els.chatMessages.innerHTML = "";
  els.flowEventsOutput.textContent = "";
  els.flowSessionNodeFilter.innerHTML = `<option value="all">全部</option>`;
  if (els.flowSessionTagFilter) els.flowSessionTagFilter.innerHTML = `<option value="all">全部</option>`;
  setFlowSessionDateTagFilterValue("");
  if (els.tagGroupList) els.tagGroupList.innerHTML = "";
  els.flowNodeList.innerHTML = `<div class="empty-state">正在加载当前 Bot 的任务状态机...</div>`;
  els.botForm.reset();
  els.botForm.enabled.checked = true;
  els.botAccessKeyForm?.reset();
  els.flowMachineForm.reset();
  els.flowMachineForm.enabled.checked = false;
  els.replyWaitForm?.reset();
  if (els.replyWaitForm) {
    els.replyWaitForm.baseSeconds.value = "10";
    els.replyWaitForm.incrementSeconds.value = "5";
    els.replyWaitForm.fallbackReply.value = DEFAULT_REPLY_WAIT_FALLBACK_REPLY;
    els.replyWaitForm.historyCustomerTextMaxChars.value = "4000";
  }
  if (els.tagSyncForm) {
    els.tagSyncForm.reset();
    els.tagSyncNightlyEnabled.checked = true;
    els.tagSyncDateTagsEnabled.checked = false;
    els.tagSyncWindowStart.value = "03:00";
    els.tagSyncWindowEnd.value = "06:00";
    syncTagSyncScheduleFields();
  }
  setTagSyncBusy(false);
  clearTagSyncResult();
  els.manualReplyInput.value = "";
  els.proactiveForm.reset();
  if (els.proactiveFileUrl) els.proactiveFileUrl.value = "";
  clearProactiveUpload();
  renderProactiveTargetTags();
  syncProactiveScheduleFields();
  syncMessageTypeFields();
  renderSelectedTargets();
  renderTargetList();
  renderProactiveTasks([]);
  renderPaginationBar({
    container: els.targetPaginationEl,
    pagination: state.proactiveTargetsPagination
  });
  renderPaginationBar({
    container: els.flowSessionsPaginationEl,
    pagination: state.flowSessionsPagination
  });
  renderPaginationBar({
    container: els.proactiveTasksPaginationEl,
    pagination: state.proactiveTasksPagination
  });
  els.logsOutput.textContent = "";
  renderAgentOptions();
  syncFlowJsonTextarea();
}

function expandPanel(panel) {
  if (!panel) return;
  panel.classList.remove("is-collapsed");
  const button = panel.querySelector("[data-collapse-target]");
  if (button) button.setAttribute("aria-expanded", "true");
}

async function applyBotContext(bot, { scrollTo = null, tabName = "" } = {}) {
  if (!isBotUnlocked(bot?.botId)) {
    openUnlockDialog(bot);
    return;
  }
  const contextVersion = beginBotContext();
  const shouldReloadLogs = Boolean(els.logsOutput.textContent.trim());
  setBindingState(bot);
  if (tabName) switchWorkspaceTab(tabName);
  clearBotScopedContent();
  const cockpitBotId = state.selectedBotId;
  window.cockpitConsole?.setBotContext({
    botId: cockpitBotId,
    role: state.currentRole,
    accent: getBotAccent(bot),
    notify: (message, type) => toast(message, type),
    request: (path, options = {}) => request(path, {
      ...options,
      botId: cockpitBotId
    })
  });
  let activeBot = bot;
  if (bot?.botId) {
    if (state.currentRole === "admin") {
      const data = await window.WorkspaceContext.loadBots();
      if (!isCurrentBotContext(bot.botId, contextVersion)) return;
      currentBots = data.bots || currentBots;
      activeBot = currentBots.find((item) => item.botId === bot.botId) || bot;
      await loadAgents();
      if (!isCurrentBotContext(bot.botId, contextVersion)) return;
      renderBots(currentBots);
      fillForm(activeBot);
    }
    await loadReplyWait({ contextVersion });
    if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    await loadHistoryAnalysis({ contextVersion });
    if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    await loadTagSyncConfig({ contextVersion });
    if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    await loadCockpitConfig({ contextVersion });
    if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    const tasks = [
      loadAddressBookTargets({ contextVersion }),
      loadProactiveTargetTags({ contextVersion }),
      loadProactiveTasks({ contextVersion }),
      loadFlowMachine({ contextVersion }),
      loadTagSchema({ contextVersion }),
      loadFlowSessions({ contextVersion })
    ];
    await Promise.all(tasks);
    if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    if (shouldReloadLogs) {
      await loadLogs({ contextVersion });
      if (!isCurrentBotContext(bot.botId, contextVersion)) return;
    }
  }
  if (bot?.botId && isCurrentBotContext(bot.botId, contextVersion)) {
    connectTagAlerts(bot.botId);
  }
  if (scrollTo) {
    const tabName = tabForPanel(scrollTo);
    if (tabName) switchWorkspaceTab(tabName);
    expandPanel(scrollTo);
    scrollTo.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (!scrollTo) {
    switchWorkspaceTab("cockpit", { force: true });
  }
}

function openUnlockDialog(bot) {
  if (!bot?.botId) return;
  state.unlockMode = "bot";
  state.pendingUnlockBotId = bot.botId;
  state.pendingAdminKeyResolve = null;
  els.unlockTitle.textContent = "解锁 Bot";
  els.unlockBotName.textContent = `解锁 ${bot.botName || bot.agentName || bot.botId}`;
  els.unlockKeyLabel.innerHTML = fieldLabelIcon("key", "密钥");
  els.unlockAcceptButton.innerHTML = `${icon("lock")} 解锁`;
  els.unlockKeyInput.value = "";
  els.unlockDialog.hidden = false;
  requestAnimationFrame(() => els.unlockKeyInput.focus());
}

function openAdminKeyDialog(message) {
  return new Promise((resolve) => {
    state.unlockMode = "admin";
    state.pendingUnlockBotId = "";
    state.pendingAdminKeyResolve = resolve;
    els.unlockTitle.textContent = "管理员验证";
    els.unlockBotName.textContent = message || "请输入管理员密码后继续操作。";
    els.unlockKeyLabel.innerHTML = fieldLabelIcon("key", "管理员密码");
    els.unlockAcceptButton.innerHTML = `${icon("lock")} 确认`;
    els.unlockKeyInput.value = "";
    els.unlockDialog.hidden = false;
    requestAnimationFrame(() => els.unlockKeyInput.focus());
  });
}

function resetUnlockDialogState() {
  state.pendingUnlockBotId = "";
  state.unlockMode = "bot";
  els.unlockTitle.textContent = "解锁 Bot";
  els.unlockBotName.textContent = "输入当前 Bot 密钥或管理员密钥。";
  els.unlockKeyLabel.innerHTML = fieldLabelIcon("key", "密钥");
  els.unlockAcceptButton.innerHTML = `${icon("lock")} 解锁`;
}

function closeUnlockDialog() {
  const adminResolver = state.pendingAdminKeyResolve;
  state.pendingAdminKeyResolve = null;
  resetUnlockDialogState();
  els.unlockDialog.hidden = true;
  if (adminResolver) adminResolver(null);
}

function resolveAdminKey(key) {
  const adminResolver = state.pendingAdminKeyResolve;
  state.pendingAdminKeyResolve = null;
  resetUnlockDialogState();
  els.unlockDialog.hidden = true;
  if (adminResolver) adminResolver(key);
}

async function promptAdminHeaders(message) {
  if (state.currentRole === "admin") return {};
  const adminKey = await openAdminKeyDialog(message);
  if (!adminKey) return null;
  return { "x-api-key": adminKey };
}

async function ensureAdminBotSession(botId, adminHeaders = {}) {
  const adminKey = adminHeaders["x-api-key"];
  if (!botId || !adminKey || getBotSession(botId)?.role === "admin") return null;
  const data = await request(`/api/bots/${encodeURIComponent(botId)}/unlock`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ key: adminKey })
  });
  setBotSession(botId, {
    token: data.token,
    role: data.role,
    expiresAt: data.expiresAt
  });
  return data.bot || null;
}

async function acceptUnlockDialog() {
  if (state.unlockMode === "admin") {
    const key = els.unlockKeyInput.value.trim();
    if (!key) {
      toast("请输入管理员密码");
      return;
    }
    resolveAdminKey(key);
    return;
  }
  await unlockPendingBot();
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
  await applyBotContext(bot);
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

async function deleteBot(bot) {
  const botId = bot?.botId || "";
  if (!botId) return;
  const adminKey = await openAdminKeyDialog("删除 Bot 需要管理员密码。确认删除该 Bot 及其所有数据？此操作不可恢复。");
  if (!adminKey) return;
  await request(`/api/bots/${encodeURIComponent(botId)}`, {
    method: "DELETE",
    botId: "",
    headers: { "x-api-key": adminKey }
  });
  clearBotSession(botId);
  if (state.selectedBotId === botId) {
    resetBotContext();
  }
  await loadBots();
  toast("Bot 已删除");
}

function resetBotContext() {
  beginBotContext();
  setBindingState(null);
  clearBotScopedContent();
}

function renderAgentOptions(selectedAgentId = els.botForm.agentId?.value || "") {
  const select = els.botForm.agentId;
  if (!select) return;
  if (!currentAgents.length) {
    select.innerHTML = `<option value="">请先在 Agents 中创建 Agent</option>`;
    return;
  }
  select.innerHTML = [
    `<option value="">选择 Agent</option>`,
    ...currentAgents.map((agent) => {
      const label = agent.agentName || agent.agentId;
      return `<option value="${escapeHtml(agent.agentId)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  if (selectedAgentId && currentAgents.some((agent) => agent.agentId === selectedAgentId)) {
    select.value = selectedAgentId;
  } else if (!selectedAgentId && currentAgents.length === 1) {
    select.value = currentAgents[0].agentId;
  }
}

function fillForm(bot) {
  els.botForm.botId.value = bot.botId || "";
  els.botForm.botName.value = bot.botName || "";
  renderAgentOptions(bot.agentId || "");
  els.botForm.enabled.checked = Boolean(bot.enabled);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAgents() {
  renderAgentOptions();
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
      const canDelete = unlocked && session?.role === "admin";
      const botStatusText = !unlocked ? "已上锁" : isSelected ? (session?.role === "admin" ? "管理员" : "使用中") : "已解锁";
      const botStatusClass = !unlocked ? "off" : isSelected ? "selected" : "ok";
      const accent = getBotAccent(bot);
      return `
        <article class="bot-card ${bot.enabled ? "is-online" : "is-offline"} ${unlocked ? "is-unlocked" : "is-locked"} ${isSelected ? "is-selected" : ""}" data-action="${unlocked ? "open" : "unlock"}" data-bot="${safeBot}" style="--bot-accent: ${escapeHtml(accent)}">
          <div class="bot-main">
            <span class="bot-identity">
              <span class="bot-identity-content">
                <img class="bot-avatar" src="./assets/bot-avatar.png" alt="" aria-hidden="true" />
                <span class="bot-summary">
                  <span class="bot-title-row">
                    <strong>${escapeHtml(title)}</strong>
                  </span>
                  <span class="bot-agent">${escapeHtml(bot.agentName || bot.agentId || "未绑定 Agent")}</span>
                </span>
              </span>
              <span class="bot-lock-mask" aria-hidden="true">
                ${icon("lock")}
                <strong>${escapeHtml(title)}</strong>
              </span>
            </span>
            <span class="pill ${botStatusClass}">${botStatusText}</span>
          </div>
          <div class="row-actions bot-actions">
            ${canDelete ? `<button class="danger bot-delete-button" data-action="delete" data-bot="${safeBot}" type="button" aria-label="删除 Bot" title="删除 Bot">${icon("reset")}</button>` : ""}
            <button class="secondary icon-button" data-action="${unlocked ? "sessions" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "客户会话" : "解锁"}" title="${unlocked ? "客户会话" : "解锁"}">${icon(unlocked ? "users" : "lock")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "tasks" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "任务配置" : "解锁"}" title="${unlocked ? "任务配置" : "解锁"}">${icon(unlocked ? "edit" : "lock")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "tags" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "标签维护" : "解锁"}" title="${unlocked ? "标签维护" : "解锁"}">${icon(unlocked ? "tag" : "lock")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "push" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "推送消息" : "解锁"}" title="${unlocked ? "推送消息" : "解锁"}">${icon(unlocked ? "send" : "lock")}</button>
            <button class="secondary icon-button" data-action="${unlocked ? "logs" : "unlock"}" data-bot="${safeBot}" type="button" aria-label="${unlocked ? "运行日志" : "解锁"}" title="${unlocked ? "运行日志" : "解锁"}">${icon(unlocked ? "eye" : "lock")}</button>
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
      if (actionTarget.dataset.action === "delete") {
        event.stopPropagation();
        await deleteBot(bot);
        return;
      }
      if (actionTarget.dataset.action === "open") {
        await applyBotContext(bot);
        return;
      }
      if (actionTarget.dataset.action === "push") {
        event.stopPropagation();
        await applyBotContext(bot, { scrollTo: els.proactivePanel });
      }
      if (actionTarget.dataset.action === "tasks") {
        event.stopPropagation();
        await applyBotContext(bot, { scrollTo: document.querySelector("#flowMachinePanel") });
      }
      if (actionTarget.dataset.action === "sessions") {
        event.stopPropagation();
        await applyBotContext(bot, { scrollTo: document.querySelector("#flowSessionsPanel") });
      }
      if (actionTarget.dataset.action === "tags") {
        event.stopPropagation();
        await applyBotContext(bot, { scrollTo: document.querySelector("#tagsTab") });
      }
      if (actionTarget.dataset.action === "logs") {
        event.stopPropagation();
        await applyBotContext(bot, { scrollTo: document.querySelector("#logsPanel") });
      }
    });
  });
}

let currentBots = [];
let currentAgents = [];
let targetFilter = "all";
let addressBookTargets = [];
let proactiveSearchTimer = null;
let currentFlowMachine = null;
let currentFlowSessions = [];
let flowDraftNodes = [];
let flowNodeDragState = null;
let focusedActionTarget = null;
let actionToolboxOpen = false;
let currentConversationAssets = { fields: [], totalCount: 0, collectedCount: 0 };
let currentFlowSession = null;
let currentTagAlerts = [];
const collapsedFlowNodes = new Set();
const collapsedTagGroups = new Set();
const selectedTargets = new Map();
const manualReplyEmojis = ["😊", "👌", "👍", "🙏", "😄", "🎉", "✨", "💪"];
const tagAlertClient = window.createTagAlertClient({
  onChange: renderTagAlerts,
  playSound: playTagAlertSound,
  unlockSound: unlockTagAlertAudio,
  onAuthExpired: () => {
    const botId = state.selectedBotId;
    if (!botId) return;
    expireBotSession(botId);
    if (state.apiKey) connectTagAlerts(botId);
  },
  onError: (error) => console.warn("Tag alert stream disconnected", error)
});

function setTagAlertInteraction(active) {
  if (!els.tagAlertCenter || !els.tagAlertPanel || !els.tagAlertButton) return;
  const shouldOpen = Boolean(active && currentTagAlerts.length);
  els.tagAlertCenter.classList.toggle("is-paused", shouldOpen);
  els.tagAlertPanel.hidden = !shouldOpen;
  els.tagAlertButton.setAttribute("aria-expanded", String(shouldOpen));
}

function renderTagAlerts(alerts) {
  currentTagAlerts = Array.isArray(alerts) ? alerts : [];
  if (!els.tagAlertCenter || !els.tagAlertList) return;
  const hasUnread = Boolean(state.selectedBotId && currentTagAlerts.length);
  els.tagAlertCenter.hidden = !hasUnread;
  els.tagAlertCenter.classList.toggle("has-unread", hasUnread);
  els.tagAlertCount.textContent = String(currentTagAlerts.length);
  els.tagAlertList.innerHTML = currentTagAlerts
    .map((alert) => `
      <button
        class="tag-alert-item"
        type="button"
        role="listitem"
        data-tag-alert-id="${escapeHtml(alert.id)}"
      >
        <strong>${escapeHtml(alert.customerName || "未命名客户")}</strong>
        <span>达成「${escapeHtml(alert.tagName || "未命名")}」标签</span>
      </button>
    `)
    .join("");
  if (!hasUnread) setTagAlertInteraction(false);
}

async function unlockTagAlertAudio() {
  const audio = els.tagAlertAudio;
  if (!audio) return;
  const wasMuted = audio.muted;
  audio.muted = true;
  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // Browsers may still require a later explicit gesture; alerts remain visible.
  } finally {
    audio.muted = wasMuted;
  }
}

function playTagAlertSound() {
  const audio = els.tagAlertAudio;
  if (!audio) return;
  audio.muted = false;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function resetFlowSessionFiltersForTagAlert(conversationKey) {
  setFlowSessionTypeSelection(flowSessionType({ conversationKey }));
  clearSelectedFlowConversation();
  els.flowSessionSearchInput.value = "";
  els.flowSessionNodeFilter.value = "all";
  setFlowSessionTagFilterValues([], { reload: false });
  setFlowSessionDateTagFilterValue("");
  resetFlowSessionsPagination();
}

async function openTagAlert(alert) {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId || !alert?.conversationKey) return;
  switchWorkspaceTab("sessions");
  resetFlowSessionFiltersForTagAlert(alert.conversationKey);
  await reloadFlowSessionsFromFirstPage();
  if (!isCurrentBotContext(botId, contextVersion)) return;
  const opened = await openFlowSession(alert.conversationKey, {
    anchorMessageId: alert.evidenceMessageId,
    alertTagName: alert.tagName,
    missingEvidence: !alert.evidenceMessageId
  });
  if (opened === false || !isCurrentBotContext(botId, contextVersion)) return;
  await tagAlertClient.markRead(alert.id);
}

function targetKey(target) {
  return `${target.targetType}:${target.targetName}`;
}

function proactiveFilterElements() {
  return [
    ...(els.proactiveFilterControls?.querySelectorAll("button, input, select") || []),
    els.loadTargetsButton,
    ...(els.targetPaginationEl?.querySelectorAll("button, select") || [])
  ].filter(Boolean);
}

function setProactiveFilterLoading(loading) {
  const isLoading = Boolean(loading);
  state.proactiveFiltersLoading = isLoading;
  if (isLoading) {
    closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
  }
  if (els.proactiveFilterControls) {
    els.proactiveFilterControls.classList.toggle("is-loading", isLoading);
    els.proactiveFilterControls.setAttribute("aria-busy", String(isLoading));
    els.proactiveFilterControls.inert = isLoading;
  }
  if (els.targetPaginationEl) {
    els.targetPaginationEl.classList.toggle("is-loading", isLoading);
    els.targetPaginationEl.setAttribute("aria-busy", String(isLoading));
    els.targetPaginationEl.inert = isLoading;
  }
  if (els.proactiveFilterLoading) {
    els.proactiveFilterLoading.hidden = !isLoading;
  }
  proactiveFilterElements().forEach((control) => {
    if (isLoading) {
      if (!control.hasAttribute("data-filter-lock-disabled")) {
        control.dataset.filterLockDisabled = String(control.disabled);
      }
      control.disabled = true;
      return;
    }
    if (!control.hasAttribute("data-filter-lock-disabled")) return;
    control.disabled = control.dataset.filterLockDisabled === "true";
    delete control.dataset.filterLockDisabled;
  });
}

function runProactiveFilterAction(action) {
  return proactiveFilterLock.run(action);
}

function scheduleProactiveTargetSearch() {
  clearTimeout(proactiveSearchTimer);
  proactiveSearchTimer = setTimeout(() => {
    proactiveSearchTimer = null;
    runProactiveFilterAction(() => reloadProactiveTargetsFromFirstPage()).catch(toastError);
  }, 260);
}

function targetTypeLabel(type) {
  return type === "group" ? "群组" : "私聊";
}

function targetTypeIcon(type) {
  return type === "group" ? "群" : "私";
}

function targetTypeAvatar(type) {
  return type === "group" ? "./assets/group.png" : "./assets/ddeer.png";
}

function getSelectedTargets() {
  return Array.from(selectedTargets.values());
}

function selectedTargetCountByType(type) {
  return getSelectedTargets().filter((target) => target.targetType === type).length;
}

function updateBulkActionButtons() {
  const privateSelected = selectedTargetCountByType("private") > 0;
  const groupSelected = selectedTargetCountByType("group") > 0;
  els.selectPrivateTargetsButton.classList.toggle("selected", privateSelected);
  els.selectGroupTargetsButton.classList.toggle("selected", groupSelected);
  els.selectPrivateTargetsButton.setAttribute("aria-pressed", String(privateSelected));
  els.selectGroupTargetsButton.setAttribute("aria-pressed", String(groupSelected));
  els.selectPrivateTargetsButton.textContent = "全选私聊";
  els.selectGroupTargetsButton.textContent = "全选群组";
}

async function fetchAllAddressBookTargetsByType(type, { contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) throw new Error("请先选择 Bot");
  const query = String(els.targetSearchInput.value || "").trim();
  const fetchPage = async (page) => {
    const params = new URLSearchParams();
    params.set("botId", botId);
    params.set("targetType", type);
    params.set("page", String(page));
    params.set("pageSize", "100");
    if (query) params.set("q", query);
    return request(`/api/proactive/targets?${params.toString()}`);
  };

  const firstPage = await fetchPage(1);
  if (!isCurrentBotContext(botId, contextVersion)) return [];
  const targets = [...(firstPage.targets || [])];
  const totalPages = normalizePagination(firstPage.pagination, { page: 1, pageSize: 100, total: targets.length, totalPages: 1 }).totalPages;
  for (let page = 2; page <= totalPages; page += 1) {
    const data = await fetchPage(page);
    if (!isCurrentBotContext(botId, contextVersion)) return [];
    targets.push(...(data.targets || []));
  }
  return targets;
}

async function selectTargetsByTypeAcrossPages(type) {
  const contextVersion = state.botContextVersion;
  const botId = state.selectedBotId;
  const targets = await fetchAllAddressBookTargetsByType(type, { contextVersion });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  const allSelected = targets.length > 0 && targets.every((target) => selectedTargets.has(targetKey(target)));
  targets.forEach((target) => {
    if (allSelected) {
      selectedTargets.delete(targetKey(target));
      state.proactiveManualTargetKeys.delete(targetKey(target));
    } else {
      selectedTargets.set(targetKey(target), target);
      state.proactiveManualTargetKeys.add(targetKey(target));
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
  state.proactiveTagSelections.clear();
  state.proactiveManualTargetKeys.clear();
  if (els.targetTagSelect) els.targetTagSelect.value = "";
  if (els.targetDateTagSelect) els.targetDateTagSelect.value = "";
  closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
  renderProactiveTargetTags();
  renderSelectedTargets();
  renderTargetList();
  toast("已清空全部已选目标");
}

function closeSelectedTargetsPopover() {
  if (!els.selectedTargetsPopover || !els.selectedTargetsSummaryButton) return;
  els.selectedTargetsPopover.hidden = true;
  els.selectedTargetsSummaryButton.setAttribute("aria-expanded", "false");
}

function toggleSelectedTargetsPopover() {
  if (!els.selectedTargetsPopover || !els.selectedTargetsSummaryButton) return;
  if (!getSelectedTargets().length) {
    closeSelectedTargetsPopover();
    return;
  }
  const willOpen = els.selectedTargetsPopover.hidden;
  els.selectedTargetsPopover.hidden = !willOpen;
  els.selectedTargetsSummaryButton.setAttribute("aria-expanded", String(willOpen));
}

function renderSelectedTargets() {
  const targets = getSelectedTargets();
  const previewTargets = targets.slice(0, SELECTED_TARGET_PREVIEW_LIMIT);
  const remainingCount = Math.max(0, targets.length - previewTargets.length);

  els.selectedTargetsCount.textContent = `已选 ${targets.length}`;
  els.selectedTargetsSummaryButton.disabled = targets.length === 0;
  els.selectedTargetsPreview.innerHTML = previewTargets
    .map((target) => `
      <span class="selected-target-chip" title="${escapeHtml(target.displayName || target.targetName)}">
        <img src="${escapeHtml(targetTypeAvatar(target.targetType))}" alt="" aria-hidden="true" />
        <span>${escapeHtml(target.displayName || target.targetName)}</span>
      </span>
    `)
    .join("");
  els.selectedTargetsMoreButton.hidden = remainingCount === 0;
  els.selectedTargetsMoreButton.textContent = `+${remainingCount}`;
  els.selectedTargetsPopover.innerHTML = targets.length
    ? `
      <div class="selected-targets-popover-head">
        <strong>全部已选目标</strong>
        <span>${targets.length} 个</span>
      </div>
      <div class="selected-targets-popover-list">
        ${targets.map((target) => `
          <div class="selected-target-popover-item">
            <img src="${escapeHtml(targetTypeAvatar(target.targetType))}" alt="" aria-hidden="true" />
            <span>${escapeHtml(target.displayName || target.targetName)}</span>
          </div>
        `).join("")}
      </div>
    `
    : "";
  if (!targets.length) closeSelectedTargetsPopover();
  updateBulkActionButtons();
}

function proactiveTagKey(tag) {
  return `${tag.tagType || "normal"}:${tag.groupId || ""}:${tag.tagId || ""}`;
}

function dedupeProactiveTargetTags(tags = []) {
  const seen = new Set();
  return (Array.isArray(tags) ? tags : []).filter((tag) => {
    const key = proactiveTagKey(tag);
    if (!tag?.tagId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectedProactiveTagKeys() {
  return new Set([...state.proactiveTagSelections.keys()].filter((key) => !key.startsWith("date:")));
}

function renderTagMultiSelectControl({
  select,
  button,
  menu,
  options = [],
  selectedValues = [],
  emptyLabel = "全部"
} = {}) {
  if (!select || !button || !menu) return;
  const selected = new Set(selectedValues);
  const normalizedOptions = options.map((option) => ({
    value: String(option?.value || ""),
    label: String(option?.label || option?.value || ""),
    groupLabel: String(option?.groupLabel || "")
  }));
  select.innerHTML = normalizedOptions
    .map(({ value, label }) => {
      const checked = value === "all" ? selected.size === 0 : selected.has(value);
      return `<option value="${escapeHtml(value)}" ${checked ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const menuOptions = [];
  let previousGroupLabel = "";
  normalizedOptions.forEach(({ value, label, groupLabel }) => {
    if (groupLabel && groupLabel !== previousGroupLabel) {
      menuOptions.push(`<div class="tag-multi-select-group-label">${escapeHtml(groupLabel)}</div>`);
      previousGroupLabel = groupLabel;
    }
    const checked = value === "all" ? selected.size === 0 : selected.has(value);
    menuOptions.push(`
      <label class="tag-multi-select-option" role="option" aria-selected="${checked ? "true" : "false"}">
        <input type="checkbox" value="${escapeHtml(value)}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(label)}</span>
      </label>
    `);
  });
  menu.innerHTML = menuOptions.length
    ? menuOptions.join("")
    : `<span class="tag-multi-select-empty">暂无可用标签</span>`;
  button.textContent = selected.size ? `已选 ${selected.size} 个` : emptyLabel;
}

function renderProactiveTargetTags() {
  if (!els.targetTagSelect || !els.targetTagSelectMenu) return;
  const selectedKeys = selectedProactiveTagKeys();
  const options = [];
  state.proactiveTargetTags
    .filter((tag) => tag.tagType !== "date")
    .forEach((tag) => {
      const key = proactiveTagKey(tag);
      options.push({
        value: key,
        label: tag.tagName || tag.tagId,
        groupLabel: tag.groupName || "未分组标签"
      });
    });
  renderTagMultiSelectControl({
    select: els.targetTagSelect,
    button: els.targetTagSelectButton,
    menu: els.targetTagSelectMenu,
    options,
    selectedValues: selectedKeys,
    emptyLabel: "选择标签"
  });
}

function selectedProactiveTag(tagKey) {
  return state.proactiveTargetTags.find((tag) => proactiveTagKey(tag) === tagKey) || null;
}

async function loadProactiveTargetTags({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) return;
  try {
    const data = await request(`/api/proactive/targets/tags?botId=${encodeURIComponent(botId)}`);
    if (!isCurrentBotContext(botId, contextVersion)) return;
    state.proactiveTargetTags = dedupeProactiveTargetTags(data.tags || []);
    renderProactiveTargetTags();
  } catch (error) {
    if (isCurrentBotContext(botId, contextVersion)) {
      renderProactiveTargetTags();
      toastError(error);
    }
  }
}

async function fetchAllAddressBookTargetsByTag(tag, { contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId || !tag) return [];
  const targets = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      botId,
      tagType: tag.tagType || "normal",
      groupId: tag.groupId || "",
      tagId: tag.tagId || "",
      page: String(page),
      pageSize: "100"
    });
    const data = await request(`/api/proactive/targets?${params.toString()}`);
    if (!isCurrentBotContext(botId, contextVersion)) return [];
    targets.push(...(data.targets || []));
    const pagination = normalizePagination(data.pagination, {
      page,
      pageSize: 100,
      total: targets.length,
      totalPages: 1
    });
    if (!pagination.hasNext) break;
    page += 1;
  }
  return targets;
}

function reconcileProactiveTargetSelections() {
  const automaticTargets = intersectTargetMaps([...state.proactiveTagSelections.values()]);
  for (const key of [...selectedTargets.keys()]) {
    if (!state.proactiveManualTargetKeys.has(key)) {
      selectedTargets.delete(key);
    }
  }
  for (const [key, target] of automaticTargets.entries()) {
    selectedTargets.set(key, target);
  }
}

function removeProactiveTagSelection(tagKey) {
  if (!state.proactiveTagSelections.has(tagKey)) return;
  state.proactiveTagSelections.delete(tagKey);
  reconcileProactiveTargetSelections();
}

async function toggleProactiveTagSelection(tagKey) {
  const tag = selectedProactiveTag(tagKey);
  if (!tag) return;
  const contextVersion = state.botContextVersion;
  const botId = state.selectedBotId;
  if (state.proactiveTagSelections.has(tagKey)) {
    removeProactiveTagSelection(tagKey);
    renderProactiveTargetTags();
    renderSelectedTargets();
    renderTargetList();
    toast(`已取消标签选择：${tag.tagName}`);
    return;
  }

  const targets = await fetchAllAddressBookTargetsByTag(tag, { contextVersion });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  const targetMap = new Map();
  for (const target of targets) {
    const key = targetKey(target);
    targetMap.set(key, target);
  }
  state.proactiveTagSelections.set(tagKey, targetMap);
  reconcileProactiveTargetSelections();
  renderProactiveTargetTags();
  renderSelectedTargets();
  renderTargetList();
  toast(targets.length ? `已按标签选择 ${targets.length} 个客户` : "该标签暂无客户");
}

function proactiveDateTagKeyFromInput(value) {
  const compactValue = compactDateTagInputValue(value);
  return compactValue ? `date:${compactValue}` : "";
}

async function syncProactiveDateTagSelection() {
  const dateKey = proactiveDateTagKeyFromInput(els.targetDateTagSelect?.value || "");
  const contextVersion = state.botContextVersion;
  const botId = state.selectedBotId;
  [...state.proactiveTagSelections.keys()]
    .filter((key) => key.startsWith("date:"))
    .forEach((key) => removeProactiveTagSelection(key));
  if (!dateKey || !botId) {
    renderProactiveTargetTags();
    renderSelectedTargets();
    renderTargetList();
    return;
  }
  const tagId = dateKey.slice("date:".length);
  const tag = state.proactiveTargetTags.find((item) => item.tagType === "date" && item.tagId === tagId) || {
    tagType: "date",
    tagId,
    tagName: tagId
  };
  const targets = await fetchAllAddressBookTargetsByTag(tag, { contextVersion });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  const targetMap = new Map();
  for (const target of targets) {
    const key = targetKey(target);
    targetMap.set(key, target);
  }
  state.proactiveTagSelections.set(dateKey, targetMap);
  reconcileProactiveTargetSelections();
  renderProactiveTargetTags();
  renderSelectedTargets();
  renderTargetList();
  toast(targets.length ? `已按添加日期选择 ${targets.length} 个客户` : "该添加日期暂无客户");
}

function closeTagMultiSelectMenu(button, menu) {
  if (!menu || !button) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

function positionTagMultiSelectMenu(button, menu) {
  if (!menu || !button) return;
  const rect = button.getBoundingClientRect();
  const menuWidth = Math.max(220, rect.width);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.width = `${menuWidth}px`;
}

function toggleTagMultiSelectMenu(button, menu) {
  if (!menu || !button) return;
  const willOpen = menu.hidden;
  if (willOpen) positionTagMultiSelectMenu(button, menu);
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function renderTargetList() {
  els.targetList.innerHTML = addressBookTargets.length
    ? addressBookTargets
        .map((target) => {
          const key = targetKey(target);
          const checked = selectedTargets.has(key);
          return `
            <button class="target-card ${checked ? "selected" : ""}" data-target-key="${escapeHtml(key)}" type="button">
              <img class="target-avatar ${target.targetType === "group" ? "group" : "private"}" src="${escapeHtml(targetTypeAvatar(target.targetType))}" alt="" aria-hidden="true" />
              <span class="target-main">
                <strong>${escapeHtml(target.displayName || target.targetName)}</strong>
              </span>
              <span class="target-checkbox ${checked ? "checked" : ""}" aria-hidden="true">
                <svg class="icon"><use href="#icon-check"></use></svg>
              </span>
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
        state.proactiveManualTargetKeys.delete(button.dataset.targetKey);
      } else {
        selectedTargets.set(button.dataset.targetKey, target);
        state.proactiveManualTargetKeys.add(button.dataset.targetKey);
      }
      renderSelectedTargets();
      renderTargetList();
    });
  });
  updateBulkActionButtons();
}

async function loadAddressBookTargets({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) {
    toast("请先选择 Bot");
    return;
  }
  const params = new URLSearchParams();
  params.set("botId", botId);
  params.set("page", String(state.proactiveTargetsPagination.page));
  params.set("pageSize", String(state.proactiveTargetsPagination.pageSize));
  if (targetFilter === "private" || targetFilter === "group") {
    params.set("targetType", targetFilter);
  }
  const query = String(els.targetSearchInput.value || "").trim();
  if (query) params.set("q", query);
  const data = await request(`/api/proactive/targets?${params.toString()}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  addressBookTargets = data.targets || [];
  state.proactiveTargetsPagination = normalizePagination(data.pagination, state.proactiveTargetsPagination);
  renderSelectedTargets();
  renderTargetList();
  renderPaginationBar({
    container: els.targetPaginationEl,
    pagination: state.proactiveTargetsPagination,
    onPage: (page) => {
      runProactiveFilterAction(async () => {
        state.proactiveTargetsPagination.page = page;
        await loadAddressBookTargets();
      }).catch(toastError);
    },
    onPageSize: (pageSize) => {
      runProactiveFilterAction(async () => {
        state.proactiveTargetsPagination.page = 1;
        state.proactiveTargetsPagination.pageSize = pageSize;
        await loadAddressBookTargets();
      }).catch(toastError);
    }
  });
  updateBulkActionButtons();
}

async function loadBots() {
  const data = await window.WorkspaceContext.loadBots();
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

let directBotHandled = false;

async function openDirectBotFromUrl() {
  if (directBotHandled) return;
  directBotHandled = true;
  const directBotId = new URLSearchParams(window.location.search).get("bot");
  if (!directBotId) return;
  const bot = currentBots.find((item) => item.botId === directBotId);
  if (!bot) return;
  if (isBotUnlocked(directBotId)) {
    await applyBotContext(bot);
    return;
  }
  openUnlockDialog(bot);
}

async function loadAgents({ silent = false, headers: requestHeaders = {} } = {}) {
  try {
    const data = await request("/api/agents", {
      headers: requestHeaders
    });
    currentAgents = data.agents || [];
    renderAgents(currentAgents);
  } catch (error) {
    if (!silent) throw error;
    renderAgentOptions();
  }
}

async function loadReplyWait({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId || !els.replyWaitForm) return;
  const requestVersion = ++state.replyWaitLoadVersion;
  const data = await request(
    `/api/bots/${encodeURIComponent(botId)}/settings/reply-wait`
  );
  if (
    requestVersion !== state.replyWaitLoadVersion ||
    state.selectedBotId !== botId ||
    !isCurrentBotContext(botId, contextVersion)
  ) return;
  const config = data.config || {};
  els.replyWaitForm.baseSeconds.value = String(config.baseSeconds ?? 10);
  els.replyWaitForm.incrementSeconds.value = String(config.incrementSeconds ?? 5);
  els.replyWaitForm.fallbackReply.value =
    config.fallbackReply || DEFAULT_REPLY_WAIT_FALLBACK_REPLY;
}

async function loadHistoryAnalysis({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId || !els.replyWaitForm) return;
  const requestVersion = ++state.historyAnalysisLoadVersion;
  const data = await request(
    `/api/bots/${encodeURIComponent(botId)}/settings/history-analysis`
  );
  if (
    requestVersion !== state.historyAnalysisLoadVersion ||
    state.selectedBotId !== botId ||
    !isCurrentBotContext(botId, contextVersion)
  ) return;
  els.replyWaitForm.historyCustomerTextMaxChars.value =
    String(data.config?.historyCustomerTextMaxChars ?? 4000);
}

function canonicalNightMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return Number.NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}

function buildNightTagSyncTimeOptions() {
  const options = [];
  for (let minutes = 0; minutes <= 6 * 60; minutes += 15) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    options.push({
      value,
      minutes,
      label: value
    });
  }
  return options;
}

function initializeTagSyncTimeOptions() {
  if (!els.tagSyncWindowStart || !els.tagSyncWindowEnd) return;
  const options = buildNightTagSyncTimeOptions();
  els.tagSyncWindowStart.innerHTML = options
    .filter((option) => option.minutes < 6 * 60)
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  els.tagSyncWindowEnd.innerHTML = options
    .filter((option) => option.minutes > 0)
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  els.tagSyncWindowStart.value = "03:00";
  els.tagSyncWindowEnd.value = "06:00";
}

function syncTagSyncEndOptions() {
  if (!els.tagSyncWindowStart || !els.tagSyncWindowEnd) return;
  const startMinutes = canonicalNightMinutes(els.tagSyncWindowStart.value);
  let firstAvailable = "";
  for (const option of els.tagSyncWindowEnd.options) {
    const optionMinutes = canonicalNightMinutes(option.value);
    option.disabled = optionMinutes <= startMinutes;
    if (!option.disabled && !firstAvailable) firstAvailable = option.value;
  }
  if (els.tagSyncWindowEnd.selectedOptions[0]?.disabled && firstAvailable) {
    els.tagSyncWindowEnd.value = firstAvailable;
  }
}

function syncTagSyncScheduleFields() {
  if (!els.tagSyncNightlyEnabled) return;
  const enabled = els.tagSyncNightlyEnabled.checked;
  els.tagSyncWindowStart.disabled = !enabled;
  els.tagSyncWindowEnd.disabled = !enabled;
  syncTagSyncEndOptions();
}

function setTagSyncBusy(busy) {
  if (!els.tagSyncRunButton) return;
  const active = Boolean(busy);
  els.tagSyncRunButton.disabled = active;
  els.tagSyncRunButton.classList.toggle("is-syncing", active);
  els.tagSyncRunButton.setAttribute("aria-busy", String(active));
  const label = els.tagSyncRunButton.querySelector(".tag-sync-run-label");
  if (label) label.textContent = active ? "同步中" : "立即同步";
}

function clearTagSyncResult() {
  if (!els.tagSyncResult) return;
  els.tagSyncResult.hidden = true;
  els.tagSyncResult.className = "tag-sync-result";
  els.tagSyncResult.innerHTML = "";
}

function renderTagSyncResult(status = {}, run = {}) {
  if (!els.tagSyncResult) return;
  const resultLabels = {
    completed: "同步完成",
    stopped: "同步已停止",
    failed: "同步失败"
  };
  const runStatus = String(run.status || "completed");
  const resultTime = run.finishedAt || run.updatedAt || "";
  const error = run.lastError || run.pauseReason || "";
  els.tagSyncResult.className = `tag-sync-result is-${escapeHtml(runStatus)}`;
  els.tagSyncResult.innerHTML = `
    <div class="tag-sync-result-heading"${error ? ` title="${escapeHtml(error)}"` : ""}>
      ${icon(runStatus === "failed" ? "alert" : "check")}
      <strong>${escapeHtml(resultLabels[runStatus] || "同步结束")}</strong>
      ${resultTime ? `<span>${escapeHtml(formatDisplayDateTime(resultTime))}</span>` : ""}
    </div>
    <div class="tag-sync-result-stats">
      <span class="tag-sync-stat is-pending">待同步 <strong>${Number(status.pendingCount || 0)}</strong></span>
      <span class="tag-sync-stat is-processing">处理中 <strong>${Number(status.processingCount || 0)}</strong></span>
      <span class="tag-sync-stat is-failed">失败 <strong>${Number(status.failedCount || 0)}</strong></span>
      <span class="tag-sync-stat is-succeeded">已同步 <strong>${Number(status.succeededCount || 0)}</strong></span>
    </div>
  `;
  els.tagSyncResult.hidden = false;
}

function findTagSyncRun(status = {}, runId) {
  return [status.activeRun, status.lastRun]
    .find((run) => Number(run?.id || 0) === Number(runId || 0)) || null;
}

async function trackTagSyncRun({ botId, contextVersion, runId, initialStatus = null }) {
  const trackVersion = ++state.tagSyncTrackVersion;
  const terminalStatuses = new Set(["completed", "stopped", "failed"]);
  let status = initialStatus;
  let requestFailures = 0;
  setTagSyncBusy(true);
  clearTagSyncResult();
  try {
    while (
      trackVersion === state.tagSyncTrackVersion &&
      isCurrentBotContext(botId, contextVersion)
    ) {
      if (!status) {
        try {
          const data = await request(`/api/bots/${encodeURIComponent(botId)}/tag-sync/status`, { botId });
          status = data.status || {};
          requestFailures = 0;
        } catch (error) {
          requestFailures += 1;
          if (requestFailures >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
      }
      const run = findTagSyncRun(status, runId);
      if (run && terminalStatuses.has(run.status)) {
        renderTagSyncResult(status, run);
        const notices = {
          completed: ["企微标签同步已完成", "success"],
          stopped: ["企微标签同步已停止", "info"],
          failed: ["企微标签同步失败", "error"]
        };
        const [message, tone] = notices[run.status] || ["企微标签同步已结束", "info"];
        toast(message, tone);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = null;
    }
  } finally {
    if (
      trackVersion === state.tagSyncTrackVersion &&
      isCurrentBotContext(botId, contextVersion)
    ) {
      setTagSyncBusy(false);
    }
  }
}

function applyTagSyncConfig(config = {}) {
  state.tagSyncConfig = config;
  els.tagSyncNightlyEnabled.checked = Boolean(config.nightlyEnabled);
  els.tagSyncDateTagsEnabled.checked = Boolean(config.syncDateTags);
  els.tagSyncWindowStart.value = config.windowStart || "03:00";
  els.tagSyncWindowEnd.value = config.windowEnd || "06:00";
  syncTagSyncScheduleFields();
}

async function loadTagSyncConfig({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId || !els.tagSyncForm) return;
  const requestVersion = ++state.tagSyncLoadVersion;
  const [configData, statusData] = await Promise.all([
    request(`/api/bots/${encodeURIComponent(botId)}/tag-sync/config`, { botId }),
    request(`/api/bots/${encodeURIComponent(botId)}/tag-sync/status`, { botId })
  ]);
  if (
    requestVersion !== state.tagSyncLoadVersion ||
    state.selectedBotId !== botId ||
    !isCurrentBotContext(botId, contextVersion)
  ) return;
  applyTagSyncConfig(configData.config || statusData.status?.config || {});
  clearTagSyncResult();
  const activeRun = statusData.status?.activeRun || null;
  if (activeRun) {
    void trackTagSyncRun({
      botId,
      contextVersion,
      runId: activeRun.id,
      initialStatus: statusData.status || {}
    }).catch(toastError);
  } else {
    setTagSyncBusy(false);
  }
}

async function saveTagSyncConfig(event) {
  event.preventDefault();
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) {
    toast("请先解锁 Bot");
    return;
  }
  const nightlyEnabled = els.tagSyncNightlyEnabled.checked;
  if (nightlyEnabled && !state.tagSyncConfig?.initialBackfillAt) {
    const confirmed = await openConfirmation({
      title: "开启夜间自动同步？",
      message: "首次开启会登记当前所有私聊客户的已有标签，并在设定的夜间时段逐步同步到企微。",
      acceptLabel: "确认开启"
    });
    if (!confirmed || !isCurrentBotContext(botId, contextVersion)) {
      els.tagSyncNightlyEnabled.checked = Boolean(state.tagSyncConfig?.nightlyEnabled);
      syncTagSyncScheduleFields();
      return;
    }
  }
  const result = await request(`/api/bots/${encodeURIComponent(botId)}/tag-sync/config`, {
    method: "PUT",
    botId,
    body: JSON.stringify({
      nightlyEnabled,
      syncDateTags: els.tagSyncDateTagsEnabled.checked,
      windowStart: els.tagSyncWindowStart.value,
      windowEnd: els.tagSyncWindowEnd.value
    })
  });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  applyTagSyncConfig(result.config || {});
  toast("企微标签同步配置已保存");
}

async function runTagSyncNow() {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) {
    toast("请先解锁 Bot");
    return;
  }
  const confirmed = await openConfirmation({
    title: "立即同步企微标签？",
    message: "同步会使用当前 Bot 的 WorkTool 客户端队列；收到客户消息时会自动暂停，回复后继续。",
    acceptLabel: "立即同步"
  });
  if (!confirmed || !isCurrentBotContext(botId, contextVersion)) return;
  setTagSyncBusy(true);
  clearTagSyncResult();
  try {
    const data = await request(`/api/bots/${encodeURIComponent(botId)}/tag-sync/run`, {
      method: "POST",
      botId,
      body: JSON.stringify({})
    });
    if (!isCurrentBotContext(botId, contextVersion)) return;
    const run = data.run || data.status?.activeRun || null;
    if (!run?.id) throw new Error("未能获取企微标签同步任务");
    toast("企微标签同步已开始");
    await trackTagSyncRun({
      botId,
      contextVersion,
      runId: run.id,
      initialStatus: data.status || null
    });
  } catch (error) {
    if (isCurrentBotContext(botId, contextVersion)) setTagSyncBusy(false);
    throw error;
  }
}

async function saveBot(event) {
  event.preventDefault();
  const adminHeaders = await promptAdminHeaders("保存 Bot 配置需要管理员密码。");
  if (!adminHeaders) return;
  const bot = formData();
  if (!bot.botId || !bot.agentId) {
    toast("请填写 Bot ID，并选择 Agent");
    return;
  }
  const result = await request(`/api/bots/${encodeURIComponent(bot.botId)}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify(bot)
  });
  const unlockedBot = await ensureAdminBotSession(bot.botId, adminHeaders);
  toast(result.callbackBinding?.ok === false ? "绑定已保存，回调自动绑定失败" : "绑定已保存，回调已自动绑定");
  const data = await window.WorkspaceContext.loadBots();
  currentBots = data.bots || [];
  renderBots(currentBots);
  const savedBot = currentBots.find((item) => item.botId === bot.botId) || unlockedBot || result.binding;
  if (savedBot && unlockedBot) Object.assign(savedBot, unlockedBot);
  if (savedBot) await applyBotContext(savedBot);
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

async function loadLogs({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  const type = els.logType.value;
  const params = new URLSearchParams({ limit: "40" });
  if (botId) params.set("botId", botId);
  const data = await request(`/api/logs/${encodeURIComponent(type)}?${params.toString()}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  els.logsOutput.textContent = JSON.stringify(data.logs || [], null, 2);
}

function flowNodeLabel(nodeId) {
  const node = currentFlowMachine?.config?.nodes?.find((item) => item.id === nodeId);
  return node ? `${node.name} (${node.id})` : nodeId || "-";
}

function flowNodeName(nodeId) {
  const node = currentFlowMachine?.config?.nodes?.find((item) => item.id === nodeId);
  return node?.name || "未进入";
}

function compactFlowNodeName(value) {
  const characters = Array.from(String(value || "-"));
  return characters.length > 4 ? `${characters.slice(0, 4).join("")}…` : characters.join("");
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
    polishByAgent: true,
    messages: []
  };
}

function defaultActivationMessage() {
  return { content: "", intervalMinutes: 30, maxTimes: 1 };
}

function defaultFlowAction(index = 1) {
  return {
    id: `action_${index}`,
    type: "invite_to_group",
    groupName: "",
    target: "current_contact",
    showMessageHistory: false,
    runOnce: true
  };
}

const actionChipPattern = /\[动作：拉入\s+([^\]\n\r]+?)\]/g;

function normalizeFlowActionDraft(value = {}, index = 1) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const type = String(source.type || "invite_to_group").trim();
  if (type !== "invite_to_group") return null;
  return {
    id: String(source.id || `action_${index}`).trim() || `action_${index}`,
    type: "invite_to_group",
    groupName: String(source.groupName || ""),
    target: "current_contact",
    showMessageHistory: false,
    runOnce: source.runOnce !== false
  };
}

function normalizeFlowActionDrafts(actions = []) {
  return Array.isArray(actions)
    ? actions
      .map((action, index) => normalizeFlowActionDraft(action, index + 1))
      .filter(Boolean)
    : [];
}

function serializeActionChipForEditor(action = {}) {
  const normalized = normalizeFlowActionDraft(action);
  const groupName = String(normalized?.groupName || "").trim();
  return groupName ? `[动作：拉入 ${groupName}]` : "";
}

function extractActionChipsFromEditorText(text = "") {
  const actions = [];
  const seen = new Set();
  String(text || "").replace(actionChipPattern, (_match, rawGroupName) => {
    const groupName = String(rawGroupName || "").trim();
    if (!groupName) return "";
    const key = `invite_to_group:${groupName}`;
    if (seen.has(key)) return "";
    seen.add(key);
    actions.push({
      ...defaultFlowAction(actions.length + 1),
      id: `action_${actions.length + 1}`,
      groupName
    });
    return "";
  });
  return actions;
}

function stripActionChipsFromEditorText(text = "") {
  return String(text || "")
    .replace(actionChipPattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？!?，,；;：:])/g, "$1")
    .replace(/([。！？!?，,；;：:])\s+/g, "$1")
    .trim();
}

function mergeEditorFlowActions(actions = []) {
  const seen = new Set();
  return normalizeFlowActionDrafts(actions)
    .filter((action) => {
      const groupName = String(action.groupName || "").trim();
      if (!groupName) return true;
      const key = `${action.type}:${groupName}:${action.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((action, index) => ({
      ...action,
      id: String(action.id || `action_${index + 1}`).trim() || `action_${index + 1}`
    }));
}

function formatActivationMessageForEditor(message = {}) {
  const source = typeof message === "string" ? { content: message } : message || {};
  const content = String(source.content || "").trim();
  const chips = normalizeFlowActionDrafts(source.actionsAfterSend || [])
    .map((action) => serializeActionChipForEditor(action))
    .filter(Boolean);
  return [content, ...chips].filter(Boolean).join(" ");
}

function normalizeActivationIntervalMinutes(value, fallback = 30) {
  const parsedFallback = Number(fallback);
  const normalizedFallback = Number.isFinite(parsedFallback)
    ? Math.max(0, Math.trunc(parsedFallback))
    : 30;
  if (value === null || value === undefined || String(value).trim() === "") {
    return normalizedFallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : normalizedFallback;
}

function normalizeActivationMessageDraft(value = {}, defaults = defaultActivationMessage()) {
  const source = typeof value === "string" ? { content: value } : value || {};
  const inlineActions = extractActionChipsFromEditorText(source.content || "");
  const structuredActions = Array.isArray(source.actionsAfterSend) ? source.actionsAfterSend : [];
  const actionsAfterSend = mergeEditorFlowActions([...structuredActions, ...inlineActions]);
  return {
    content: stripActionChipsFromEditorText(source.content || ""),
    intervalMinutes: normalizeActivationIntervalMinutes(source.intervalMinutes, defaults.intervalMinutes),
    maxTimes: Math.max(1, Number(source.maxTimes ?? defaults.maxTimes)),
    ...(actionsAfterSend.length ? { actionsAfterSend } : {})
  };
}

function normalizeActivationDraft(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = {
    intervalMinutes: normalizeActivationIntervalMinutes(source.intervalMinutes, 30),
    maxTimes: Math.max(1, Number(source.maxTimes ?? 1))
  };
  const messages = Array.isArray(source.messages)
    ? source.messages.map((item) => normalizeActivationMessageDraft(item, defaults))
    : [];
  return {
    enabled: Boolean(source.enabled),
    polishByAgent: source.polishByAgent !== false,
    messages
  };
}

function defaultTagSchema() {
  return {
    dateTag: { enabled: true, cutoffTime: "00:00", effectiveAt: "" },
    groups: []
  };
}

function normalizeDateTagCutoffTimeDraft(value = "00:00") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "00:00";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "00:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeDateTagEffectiveAtDraft(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function defaultTagGroup(index = state.tagSchema.groups.length + 1) {
  return {
    id: `group_${index}`,
    name: `标签组 ${index}`,
    enabled: true,
    exclusive: true,
    oneWay: false,
    tags: []
  };
}

function defaultTag(index = 1) {
  return {
    id: `tag_${index}`,
    name: `标签 ${index}`,
    condition: "",
    voiceAlertEnabled: false,
    activation: { ...defaultActivationConfig(), messages: [defaultActivationMessage()] }
  };
}

function normalizeTagSchemaDraft(schema = {}) {
  const source = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {};
  return {
    dateTag: {
      enabled: true,
      cutoffTime: normalizeDateTagCutoffTimeDraft(source.dateTag?.cutoffTime),
      effectiveAt: normalizeDateTagEffectiveAtDraft(source.dateTag?.effectiveAt)
    },
    groups: Array.isArray(source.groups)
      ? source.groups.map((group, groupIndex) => ({
          id: String(group.id || `group_${groupIndex + 1}`).trim() || `group_${groupIndex + 1}`,
          name: String(group.name || `标签组 ${groupIndex + 1}`).trim() || `标签组 ${groupIndex + 1}`,
          enabled: group.enabled !== false,
          exclusive: group.exclusive !== false,
          oneWay: Boolean(group.oneWay),
          tags: Array.isArray(group.tags)
            ? group.tags.map((tag, tagIndex) => ({
                id: String(tag.id || `tag_${tagIndex + 1}`).trim() || `tag_${tagIndex + 1}`,
                name: String(tag.name || `标签 ${tagIndex + 1}`).trim() || `标签 ${tagIndex + 1}`,
                condition: String(tag.condition || ""),
                voiceAlertEnabled: Boolean(tag.voiceAlertEnabled),
                activation: normalizeActivationDraft(tag.activation || defaultActivationConfig())
              }))
            : []
        }))
      : []
  };
}

function activationDraftForEditor(value = {}) {
  return normalizeActivationDraft(value);
}

function flowNodeCollapseKey(node, index) {
  return String(node?.id || `index_${index}`);
}

function collapseAllFlowNodes() {
  collapsedFlowNodes.clear();
  flowDraftNodes.forEach((node, index) => {
    collapsedFlowNodes.add(flowNodeCollapseKey(node, index));
  });
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
    actionsOnComplete: [],
    activation: { ...defaultActivationConfig(), messages: [defaultActivationMessage()] },
    nextNodeId: "",
    transitions: []
  };
}

function relinkFlowDraftNodesSequentially() {
  flowDraftNodes.forEach((node, index) => {
    node.nextNodeId = flowDraftNodes[index + 1]?.id || "";
  });
  if (els.flowMachineForm.entryNodeId && flowDraftNodes[0]?.id) {
    els.flowMachineForm.entryNodeId.value = flowDraftNodes[0].id;
  }
}

function swapFlowDraftNodes(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return false;
  if (fromIndex >= flowDraftNodes.length || toIndex >= flowDraftNodes.length) return false;
  [flowDraftNodes[fromIndex], flowDraftNodes[toIndex]] = [flowDraftNodes[toIndex], flowDraftNodes[fromIndex]];
  relinkFlowDraftNodesSequentially();
  return true;
}

function flowNodeDragCards() {
  return [...els.flowNodeList.querySelectorAll("[data-flow-node-draggable]")];
}

function moveFlowNodeDragGhost(clientX, clientY) {
  if (!flowNodeDragState?.ghost) return;
  flowNodeDragState.ghost.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
}

function findFlowNodeDragTarget(clientX, clientY) {
  if (!flowNodeDragState) return null;
  const match = flowNodeDragState.cardRects.find(({ index, rect }) => (
    index !== flowNodeDragState.sourceIndex
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
  ));
  return match ? match.index : null;
}

function clearFlowNodeDragTargetPreview() {
  if (!flowNodeDragState) return;
  flowNodeDragState.targetCard?.classList.remove("is-swap-preview");
  if (flowNodeDragState.targetCard) {
    flowNodeDragState.targetCard.style.transform = "";
  }
  flowNodeDragState.targetCard = null;
  flowNodeDragState.targetIndex = null;
}

function updateFlowNodeDragTargetPreview(targetIndex) {
  if (!flowNodeDragState || targetIndex === flowNodeDragState.targetIndex) return;
  clearFlowNodeDragTargetPreview();
  if (!Number.isInteger(targetIndex)) return;
  const targetCard = els.flowNodeList.querySelector(`[data-flow-node-index="${targetIndex}"]`);
  const targetRect = flowNodeDragState.cardRects.find((item) => item.index === targetIndex)?.rect;
  if (!targetCard || !targetRect) return;
  const deltaX = flowNodeDragState.sourceRect.left - targetRect.left;
  const deltaY = flowNodeDragState.sourceRect.top - targetRect.top;
  targetCard.classList.add("is-swap-preview");
  targetCard.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
  flowNodeDragState.targetCard = targetCard;
  flowNodeDragState.targetIndex = targetIndex;
}

function cleanupFlowNodeDrag({ commit = false } = {}) {
  if (!flowNodeDragState) return;
  const { sourceIndex, targetIndex, ghost, sourceCard } = flowNodeDragState;
  document.removeEventListener("pointermove", handleFlowNodeDragMove);
  document.removeEventListener("pointerup", handleFlowNodeDragEnd);
  document.removeEventListener("pointercancel", handleFlowNodeDragCancel);
  document.body.classList.remove("is-flow-node-dragging");
  clearFlowNodeDragTargetPreview();
  sourceCard?.classList.remove("is-drag-placeholder");
  ghost?.remove();
  flowNodeDragState = null;
  if (commit && swapFlowDraftNodes(sourceIndex, targetIndex)) {
    renderFlowNodeEditor(flowDraftNodes[0]?.id || "");
    syncFlowJsonTextarea();
  }
}

function handleFlowNodeDragMove(event) {
  if (!flowNodeDragState) return;
  event.preventDefault();
  moveFlowNodeDragGhost(event.clientX, event.clientY);
  updateFlowNodeDragTargetPreview(findFlowNodeDragTarget(event.clientX, event.clientY));
}

function handleFlowNodeDragEnd(event) {
  event.preventDefault();
  cleanupFlowNodeDrag({ commit: Number.isInteger(flowNodeDragState?.targetIndex) });
}

function handleFlowNodeDragCancel() {
  cleanupFlowNodeDrag();
}

function startFlowNodeDrag(event, handle) {
  if (event.button !== 0 || flowDraftNodes.length <= 1) return;
  const sourceCard = handle.closest("[data-flow-node-index]");
  if (!sourceCard) return;
  const sourceIndex = Number(sourceCard.dataset.flowNodeIndex);
  if (!Number.isInteger(sourceIndex)) return;
  event.preventDefault();
  cleanupFlowNodeDrag();
  const cards = flowNodeDragCards();
  const cardRects = cards.map((card) => ({
    index: Number(card.dataset.flowNodeIndex),
    rect: card.getBoundingClientRect()
  }));
  const sourceRect = cardRects.find((item) => item.index === sourceIndex)?.rect;
  if (!sourceRect) return;
  const ghost = sourceCard.cloneNode(true);
  ghost.classList.remove("is-collapsed", "is-drag-placeholder", "is-swap-preview");
  ghost.classList.add("flow-node-drag-ghost");
  ghost.removeAttribute("data-flow-node-index");
  ghost.removeAttribute("data-flow-node-collapse-key");
  ghost.removeAttribute("data-flow-node-draggable");
  ghost.style.width = `${Math.min(420, sourceRect.width)}px`;
  document.body.append(ghost);
  flowNodeDragState = {
    sourceIndex,
    sourceCard,
    sourceRect,
    targetIndex: null,
    targetCard: null,
    ghost,
    cardRects
  };
  sourceCard.classList.add("is-drag-placeholder");
  document.body.classList.add("is-flow-node-dragging");
  moveFlowNodeDragGhost(event.clientX, event.clientY);
  document.addEventListener("pointermove", handleFlowNodeDragMove, { passive: false });
  document.addEventListener("pointerup", handleFlowNodeDragEnd, { passive: false });
  document.addEventListener("pointercancel", handleFlowNodeDragCancel);
}

function setFlowEditorFromConfig(config = {}) {
  els.flowMachineForm.flowName.value = config.name || "";
  if (els.flowMachineForm.generalRule) {
    els.flowMachineForm.generalRule.value = config.generalRule || "";
  }
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
        actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete || []),
        activation: normalizeActivationDraft(node.activation || defaultActivationConfig()),
        nextNodeId: node.nextNodeId || "",
        transitions: Array.isArray(node.transitions) ? node.transitions : []
      }))
    : [createBlankFlowNode(1)];
  collapseAllFlowNodes();
  const configuredEntryNodeId = String(config.entryNodeId || "").trim();
  renderFlowNodeEditor(configuredEntryNodeId);
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
    actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete),
    activation: normalizeActivationDraft(node.activation),
    nextNodeId: String(node.nextNodeId || "").trim(),
    transitions: Array.isArray(node.transitions) ? node.transitions : []
  }));
  const selectedEntryNodeId = String(els.flowMachineForm.entryNodeId.value || "").trim();
  return {
    name: String(els.flowMachineForm.flowName.value || "客服状态机").trim(),
    version: String(els.flowMachineForm.flowVersion.value || "1.0.0").trim(),
    generalRule: String(els.flowMachineForm.generalRule?.value || "").trim(),
    entryNodeId: nodes.some((node) => node.id === selectedEntryNodeId)
      ? selectedEntryNodeId
      : nodes[0]?.id || "",
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
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  if (input.dataset.activationMessageInterval !== undefined) {
    message.intervalMinutes = normalizeActivationIntervalMinutes(input.value, message.intervalMinutes);
  } else if (input.dataset.activationMessageMaxTimes !== undefined) {
    message.maxTimes = Math.max(1, Number(input.value || message.maxTimes || 1));
  } else {
    activation.messages[messageIndex] = normalizeActivationMessageDraft({
      ...message,
      content: input.value,
      actionsAfterSend: []
    });
    node.activation = activation;
    syncFlowJsonTextarea();
    return;
  }
  activation.messages[messageIndex] = message;
  node.activation = activation;
  syncFlowJsonTextarea();
}

function addActivationMessage(index) {
  const node = flowDraftNodes[index];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  activation.messages = [...activation.messages, defaultActivationMessage()];
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  requestAnimationFrame(() => {
    const card = els.flowNodeList.querySelector(`[data-flow-node-index="${index}"]`);
    const inputs = card?.querySelectorAll("[data-activation-message-content]");
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
  activation.messages.splice(messageIndex, 1, ...lines.map((content) => ({ ...defaultActivationMessage(), content })));
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function nextFlowActionId(actions = []) {
  const used = new Set(actions.map((action) => String(action.id || "")));
  let index = actions.length + 1;
  while (used.has(`action_${index}`)) index += 1;
  return `action_${index}`;
}

function addNodeAction(nodeIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const actions = normalizeFlowActionDrafts(node.actionsOnComplete || []);
  actions.push({ ...defaultFlowAction(actions.length + 1), id: nextFlowActionId(actions) });
  node.actionsOnComplete = actions;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function addActivationAction(nodeIndex, messageIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  const actions = normalizeFlowActionDrafts(message.actionsAfterSend || []);
  actions.push({ ...defaultFlowAction(actions.length + 1), id: nextFlowActionId(actions) });
  message.actionsAfterSend = actions;
  activation.messages[messageIndex] = message;
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function updateNodeActionInput(input) {
  const [nodeIndex, actionIndex] = input.dataset.nodeActionGroupName.split(":").map(Number);
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const actions = normalizeFlowActionDrafts(node.actionsOnComplete || []);
  const action = actions[actionIndex];
  if (!action) return;
  action.groupName = input.value;
  node.actionsOnComplete = actions;
  syncFlowJsonTextarea();
}

function updateActivationActionInput(input) {
  const [nodeIndex, messageIndex, actionIndex] = input.dataset.activationActionGroupName.split(":").map(Number);
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  const actions = normalizeFlowActionDrafts(message.actionsAfterSend || []);
  const action = actions[actionIndex];
  if (!action) return;
  action.groupName = input.value;
  message.actionsAfterSend = actions;
  activation.messages[messageIndex] = message;
  node.activation = activation;
  syncFlowJsonTextarea();
}

function removeNodeAction(nodeIndex, actionIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  node.actionsOnComplete = normalizeFlowActionDrafts(node.actionsOnComplete || [])
    .filter((_, index) => index !== actionIndex);
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function removeActivationAction(nodeIndex, messageIndex, actionIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  message.actionsAfterSend = normalizeFlowActionDrafts(message.actionsAfterSend || [])
    .filter((_, index) => index !== actionIndex);
  activation.messages[messageIndex] = message;
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function renderActionToolbox() {
  return `
    <aside class="action-toolbox" id="actionToolbox" aria-label="动作工具箱">
      <button class="action-toolbox-toggle" data-action-toolbox-toggle type="button" aria-label="打开工具箱" title="工具">
        ${icon("tool")}
      </button>
      <div class="action-toolbox-panel" role="dialog" aria-label="工具箱">
        <div class="action-toolbox-head">
          <strong>${icon("tool")}工具</strong>
          <button class="icon-button secondary" data-action-toolbox-close type="button" aria-label="收起工具箱" title="收起">
            ${icon("chevron")}
          </button>
        </div>
        <label class="input-group compact action-toolbox-field">
          <span class="field-label">${icon("users")}邀请入群</span>
          <input data-action-toolbox-group-name placeholder="例如 直播课学习群" />
        </label>
        <button class="primary action-toolbox-insert" data-action-toolbox-insert type="button">
          ${icon("plus")}插入动作
        </button>
      </div>
    </aside>
  `;
}

function ensureActionToolbox() {
  if (document.querySelector("#actionToolbox")) return;
  document.body.insertAdjacentHTML("beforeend", renderActionToolbox());
  const toolbox = document.querySelector("#actionToolbox");
  toolbox?.querySelector("[data-action-toolbox-toggle]")?.addEventListener("click", () => {
    actionToolboxOpen = !actionToolboxOpen;
    syncActionToolbox();
  });
  toolbox?.querySelector("[data-action-toolbox-close]")?.addEventListener("click", closeActionToolbox);
  toolbox?.querySelector("[data-action-toolbox-insert]")?.addEventListener("click", () => {
    const action = actionFromToolbox();
    if (!action) return;
    if (insertActionIntoFocusedTarget(action)) {
      toast("动作已插入");
    }
  });
  syncActionToolbox();
}

function syncActionToolbox() {
  const toolbox = document.querySelector("#actionToolbox");
  if (!toolbox) return;
  toolbox.classList.toggle("is-open", actionToolboxOpen);
}

function openActionToolbox() {
  actionToolboxOpen = true;
  syncActionToolbox();
}

function closeActionToolbox() {
  actionToolboxOpen = false;
  syncActionToolbox();
}

function actionFromToolbox() {
  const toolbox = document.querySelector("#actionToolbox");
  const groupName = String(toolbox?.querySelector("[data-action-toolbox-group-name]")?.value || "").trim();
  if (!groupName) {
    toast("请输入要邀请进入的群名");
    return null;
  }
  return {
    ...defaultFlowAction(1),
    type: "invite_to_group",
    groupName,
    target: "current_contact",
    showMessageHistory: false,
    runOnce: true
  };
}

function actionTargetElement(target = focusedActionTarget) {
  if (!target) return null;
  if (target.kind === "activation_message") {
    return els.flowNodeList.querySelector(
      `[data-action-target-activation="${target.nodeIndex}:${target.messageIndex}"]`
    );
  }
  return null;
}

function setFocusedActionTarget(target, element = null) {
  focusedActionTarget = target;
  els.flowNodeList.querySelectorAll("[data-action-target-activation]").forEach((item) => {
    item.classList.toggle("is-action-target-focused", item === (element || actionTargetElement(target)));
  });
  syncActionToolbox();
}

function insertActionIntoFocusedTarget(action = {}) {
  const normalizedAction = normalizeFlowActionDraft(action);
  if (!normalizedAction?.groupName?.trim()) {
    toast("请输入要邀请进入的群名");
    return false;
  }
  if (!focusedActionTarget) {
    openActionToolbox();
    toast("先点击激活话术位置");
    return false;
  }
  if (focusedActionTarget.kind === "activation_message") {
    const { nodeIndex, messageIndex } = focusedActionTarget;
    const textarea = els.flowNodeList.querySelector(`[data-action-target-activation="${nodeIndex}:${messageIndex}"]`);
    if (!textarea) return false;
    const chip = serializeActionChipForEditor(normalizedAction);
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const prefix = textarea.value && !/[\s\n]$/.test(textarea.value.slice(0, start)) ? " " : "";
    textarea.setRangeText(`${prefix}${chip}`, start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    setFocusedActionTarget({ kind: "activation_message", nodeIndex, messageIndex }, textarea);
    return true;
  }
  return false;
}

function bindActionTargets() {
  els.flowNodeList.querySelectorAll("[data-action-target-activation]").forEach((input) => {
    const [nodeIndex, messageIndex] = input.dataset.actionTargetActivation.split(":").map(Number);
    const focusTarget = () => {
      setFocusedActionTarget({ kind: "activation_message", nodeIndex, messageIndex }, input);
    };
    input.addEventListener("focus", focusTarget);
    input.addEventListener("click", focusTarget);
  });
  const targetElement = actionTargetElement();
  if (targetElement) {
    targetElement.classList.add("is-action-target-focused");
  }
}

function renderFlowActionChips(actions = [], { nodeIndex, messageIndex } = {}) {
  const normalized = normalizeFlowActionDrafts(actions);
  if (!normalized.length) {
    return '<div class="flow-action-empty">暂无动作</div>';
  }
  const isActivationAction = messageIndex !== undefined;
  return `
    <div class="flow-action-chips">
      ${normalized
        .map((action, actionIndex) => {
          const indexPath = isActivationAction
            ? `${nodeIndex}:${messageIndex}:${actionIndex}`
            : `${nodeIndex}:${actionIndex}`;
          const groupAttr = isActivationAction
            ? `data-activation-action-group-name="${indexPath}"`
            : `data-node-action-group-name="${indexPath}"`;
          const removeAttr = isActivationAction
            ? `data-remove-activation-action="${indexPath}"`
            : `data-remove-node-action="${indexPath}"`;
          return `
            <div class="flow-action-editor">
              <span class="flow-action-chip">${icon("users")}拉入群</span>
              <label class="input-group compact flow-action-group-field">
                <span>群名</span>
                <input ${groupAttr} value="${escapeHtml(action.groupName || "")}" placeholder="例如 直播课学习群" />
              </label>
              <button class="danger icon-button flow-action-remove-button" ${removeAttr} type="button" aria-label="删除动作" title="删除动作">
                ${icon("reset")}
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function tagFilterKey(tag) {
  if (!tag) return "";
  return tag.tagType === "date" ? `date:${tag.tagId}` : `${tag.groupId}:${tag.tagId}`;
}

function compactDateTagInputValue(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? digits : "";
}

function nativeDateValueFromCompactDate(value) {
  const compactValue = compactDateTagInputValue(value);
  if (!compactValue) return "";
  return `${compactValue.slice(0, 4)}-${compactValue.slice(4, 6)}-${compactValue.slice(6, 8)}`;
}

function dateTagFilterKeyFromInput(value) {
  const compactValue = compactDateTagInputValue(value);
  return compactValue ? `date:${compactValue}` : "all";
}

function selectedFlowSessionTagFilterValues() {
  if (!els.flowSessionTagFilter) return [];
  return [...els.flowSessionTagFilter.selectedOptions]
    .map((option) => option.value)
    .filter((value) => value && value !== "all");
}

function setFlowSessionDateTagFilterValue(value) {
  const rawValue = String(value || "");
  const compactValue = rawValue.includes("-") ? compactDateTagInputValue(rawValue) : rawValue.replace(/\D/g, "").slice(0, 8);
  if (els.flowSessionDateTagFilter) {
    els.flowSessionDateTagFilter.value = nativeDateValueFromCompactDate(compactValue);
  }
}

function normalizeFlowSessionDateTagFilter() {
  setFlowSessionDateTagFilterValue(els.flowSessionDateTagFilter?.value || "");
}

function normalizePagination(pagination = {}, fallback = { page: 1, pageSize: 20, total: 0, totalPages: 1 }) {
  const fallbackPageSize = Number(fallback.pageSize || 20);
  const rawPageSize = Number(pagination.pageSize || fallbackPageSize);
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : fallbackPageSize;
  const total = Math.max(0, Number(pagination.total || 0));
  const totalPages = Math.max(1, Number(pagination.totalPages || Math.ceil(total / pageSize) || 1));
  const page = Math.min(
    Math.max(1, Number(pagination.page || fallback.page || 1)),
    totalPages
  );
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages
  };
}

function renderPaginationBar({
  container,
  pagination,
  onPage,
  onPageSize,
  pageSizeOptions = PAGE_SIZE_OPTIONS
}) {
  if (!container) return;
  const current = normalizePagination(pagination, pagination);
  container.innerHTML = `
    <label class="pagination-size">
      <span>每页</span>
      <select data-pagination-size>
        ${pageSizeOptions.map((size) => `<option value="${size}" ${size === current.pageSize ? "selected" : ""}>${size}</option>`).join("")}
      </select>
    </label>
    <button class="secondary pagination-button is-prev" data-pagination-page="${current.page - 1}" type="button" aria-label="上一页" title="上一页" ${current.hasPrev ? "" : "disabled"}>${icon("chevron")}</button>
    <span class="pagination-current">第 ${current.page} / ${current.totalPages} 页</span>
    <button class="secondary pagination-button is-next" data-pagination-page="${current.page + 1}" type="button" aria-label="下一页" title="下一页" ${current.hasNext ? "" : "disabled"}>${icon("chevron")}</button>
    <span class="pagination-summary">共 ${current.total} 条</span>
  `;
  container.querySelector("[data-pagination-size]")?.addEventListener("change", (event) => {
    onPageSize?.(Number(event.target.value));
  });
  container.querySelectorAll("[data-pagination-page]").forEach((button) => {
    button.addEventListener("click", () => {
      onPage?.(Number(button.dataset.paginationPage));
    });
  });
}

function resetFlowSessionsPagination() {
  state.flowSessionsPagination = {
    ...state.flowSessionsPagination,
    page: 1
  };
}

function reloadFlowSessionsFromFirstPage() {
  resetFlowSessionsPagination();
  return loadFlowSessions();
}

function resetProactiveTasksPagination() {
  state.proactiveTasksPagination = {
    ...state.proactiveTasksPagination,
    page: 1
  };
}

function reloadProactiveTasksFromFirstPage() {
  resetProactiveTasksPagination();
  return loadProactiveTasks();
}

function resetProactiveTargetsPagination() {
  state.proactiveTargetsPagination = {
    ...state.proactiveTargetsPagination,
    page: 1
  };
}

function reloadProactiveTargetsFromFirstPage() {
  resetProactiveTargetsPagination();
  return loadAddressBookTargets();
}

function sortConversationTagsForDisplay(tags = []) {
  return [...tags].sort((a, b) => {
    const aDate = a?.tagType === "date" ? 0 : 1;
    const bDate = b?.tagType === "date" ? 0 : 1;
    if (aDate !== bDate) return aDate - bDate;
    return String(a?.tagName || "").localeCompare(String(b?.tagName || ""), "zh-Hans-CN");
  });
}

function renderConversationTags(tags = [], { includeDate = true } = {}) {
  const visibleTags = sortConversationTagsForDisplay(
    Array.isArray(tags)
      ? tags.filter((tag) => Boolean(tag) && (includeDate || tag?.tagType !== "date"))
      : []
  );
  if (!visibleTags.length) return "";
  return `
    <span class="conversation-tags">
      ${visibleTags
        .map((tag) => {
          const label = tag.tagType === "date" ? tag.tagName : `${tag.groupName || "标签"}：${tag.tagName}`;
          const title = [label, tag.reason].filter(Boolean).join("\n");
          return `<span class="tag-chip ${tag.tagType === "date" ? "is-date" : ""}" title="${escapeHtml(title)}">${icon("tag")}<span>${escapeHtml(tag.tagName || "-")}</span></span>`;
        })
        .join("")}
    </span>
  `;
}

function renderConversationDateTag(tags = []) {
  const dateTag = (Array.isArray(tags) ? tags : []).find((tag) => tag?.tagType === "date");
  if (!dateTag) return "";
  const title = [dateTag.tagName, dateTag.reason].filter(Boolean).join("\n");
  return `<span class="flow-session-date-tag"><span class="tag-chip is-date" title="${escapeHtml(title)}">${icon("tag")}<span>${escapeHtml(dateTag.tagName || "-")}</span></span></span>`;
}

function enabledManualTagGroups() {
  return (state.tagSchema?.groups || [])
    .filter((group) => group.enabled !== false)
    .map((group) => ({
      ...group,
      tags: (group.tags || []).filter((tag) => tag.enabled !== false)
    }))
    .filter((group) => group.tags.length);
}

function conversationHasTag(session, groupId, tagId) {
  return (session?.tags || []).some((tag) => tag.tagType !== "date" && tag.groupId === groupId && tag.tagId === tagId);
}

function hideFlowSessionManualTagMenu() {
  if (!els.flowSessionTagMenu) return;
  els.flowSessionTagMenu.hidden = true;
  els.flowSessionTagMenu.innerHTML = "";
}

function positionFlowSessionManualTagMenu(menu, x, y) {
  const rect = menu.getBoundingClientRect();
  const padding = 12;
  const left = Math.max(padding, Math.min(x, window.innerWidth - rect.width - padding));
  const top = Math.max(padding, Math.min(y, window.innerHeight - rect.height - padding));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function updateConversationTagsInState(conversationKey, tags = []) {
  const previousPositions = captureFlowSessionPositions();
  currentFlowSessions = currentFlowSessions.map((session) =>
    session.conversationKey === conversationKey ? { ...session, tags } : session
  );
  if (state.selectedFlowConversationKey === conversationKey) {
    currentFlowSession = { ...(currentFlowSession || {}), tags };
    if (els.chatTagList) els.chatTagList.innerHTML = renderConversationTags(tags);
  }
  renderFlowSessionTagFilter();
  renderFlowSessionDateTagFilter();
  renderFlowSessions({ animateFrom: previousPositions });
}

async function applyManualConversationTag({ conversationKey, groupId, tagId, action }) {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId || !conversationKey || !groupId || !tagId) {
    toast("请选择要打标的会话和标签");
    return;
  }
  const result = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/tags/manual`, {
    method: "POST",
    botId,
    body: JSON.stringify({
      botId,
      groupId,
      tagId,
      action
    })
  });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  hideFlowSessionManualTagMenu();
  updateConversationTagsInState(conversationKey, result.tags || []);
  toast(action === "remove" ? "标签已移除" : "标签已更新");
}

function renderFlowSessionManualTagMenu({ session, x, y }) {
  if (
    !els.flowSessionTagMenu
    || !session?.conversationKey
    || flowSessionType(session) !== "private"
  ) return;
  const groups = enabledManualTagGroups();
  const sessionName = flowSessionDisplayName(session);
  els.flowSessionTagMenu.innerHTML = groups.length
    ? `
      <div class="flow-session-manual-tag-menu-head">
        <strong>给${escapeHtml(sessionName)}打上标签：</strong>
      </div>
      <div class="flow-session-manual-tag-groups">
        ${groups
          .map((group) => `
            <section class="flow-session-manual-tag-group" aria-label="${escapeHtml(group.name)}">
              <div class="flow-session-manual-tag-group-title">
                ${icon(group.exclusive ? "tag" : "info")}
                <span>${escapeHtml(group.name)}</span>
              </div>
              <div class="flow-session-manual-tag-options">
                ${group.tags
                  .map((tag) => {
                    const selected = conversationHasTag(session, group.id, tag.id);
                    const action = group.exclusive ? "set" : selected ? "remove" : "add";
                    const role = group.exclusive ? "menuitemradio" : "menuitemcheckbox";
                    return `
                      <button
                        class="flow-session-manual-tag-option ${selected ? "selected" : ""}"
                        data-manual-tag-action="${action}"
                        data-manual-tag-group-id="${escapeHtml(group.id)}"
                        data-manual-tag-id="${escapeHtml(tag.id)}"
                        type="button"
                        role="${role}"
                        aria-checked="${selected ? "true" : "false"}"
                      >
                        <span class="manual-tag-check" aria-hidden="true">${selected ? icon("check") : ""}</span>
                        <span>${escapeHtml(tag.name)}</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `)
          .join("")}
      </div>
    `
    : `<div class="flow-session-manual-tag-empty">当前 Agent 没有可用标签。</div>`;
  els.flowSessionTagMenu.hidden = false;
  positionFlowSessionManualTagMenu(els.flowSessionTagMenu, x, y);
  els.flowSessionTagMenu.querySelectorAll("[data-manual-tag-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyManualConversationTag({
        conversationKey: session.conversationKey,
        groupId: button.dataset.manualTagGroupId,
        tagId: button.dataset.manualTagId,
        action: button.dataset.manualTagAction
      }).catch(toastError);
    });
  });
}

function nextTagGroupId(start = state.tagSchema.groups.length + 1) {
  let index = Math.max(1, start);
  const used = new Set((state.tagSchema.groups || []).map((group) => group.id));
  while (used.has(`group_${index}`)) index += 1;
  return `group_${index}`;
}

function nextTagId(group, start = (group?.tags || []).length + 1) {
  let index = Math.max(1, start);
  const used = new Set((group?.tags || []).map((tag) => tag.id));
  while (used.has(`tag_${index}`)) index += 1;
  return `tag_${index}`;
}

function tagGroupCollapseKey(group, groupIndex) {
  return String(group?.id || `group_${groupIndex + 1}`);
}

function playCollapseAnimation(body, isCollapsed) {
  if (!body || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const animationClass = isCollapsed ? "is-slide-up" : "is-slide-down";
  body.classList.remove("is-slide-up", "is-slide-down");
  void body.offsetWidth;
  body.classList.add(animationClass);
  body.addEventListener(
    "animationend",
    () => body.classList.remove("is-slide-up", "is-slide-down"),
    { once: true }
  );
}

function updateCollapseCardVisual(card, isCollapsed, { bodySelector, toggleSelector, expandLabel, collapseLabel } = {}) {
  if (!card) return;
  const wasCollapsed = card.classList.contains("is-collapsed");
  card.classList.toggle("is-collapsed", isCollapsed);
  const toggle = card.querySelector(toggleSelector);
  toggle?.setAttribute("aria-expanded", String(!isCollapsed));
  toggle?.setAttribute("aria-label", isCollapsed ? expandLabel : collapseLabel);
  if (wasCollapsed !== isCollapsed) {
    playCollapseAnimation(card.querySelector(bodySelector), isCollapsed);
  }
}

function updateCollapsiblePanelVisual(panel, isCollapsed) {
  if (!panel) return;
  const wasCollapsed = panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", isCollapsed);
  const button = panel.querySelector("[data-collapse-target]");
  button?.setAttribute("aria-expanded", String(!isCollapsed));
  if (wasCollapsed !== isCollapsed) {
    playCollapseAnimation(panel.querySelector(".collapsible-content"), isCollapsed);
  }
}

function collapseAllTagCards() {
  collapsedTagGroups.clear();
  (state.tagSchema.groups || []).forEach((group, groupIndex) => {
    collapsedTagGroups.add(tagGroupCollapseKey(group, groupIndex));
  });
}

function dateTagCutoffInput() {
  return els.tagGroupList?.querySelector("#dateTagCutoffTime") || null;
}

function editableDateTagRule() {
  return {
    enabled: true,
    cutoffTime: normalizeDateTagCutoffTimeDraft(dateTagCutoffInput()?.value)
  };
}

function renderDateTagSpecialGroup() {
  const dateTag = state.tagSchema.dateTag || defaultTagSchema().dateTag;
  const cutoffHelp = [
    "日切时间决定“添加日期”标签何时进入下一天。",
    "例如设置为 20:00：7月25日 19:59 添加的客户标记为 20260725；20:00 起标记为 20260726。",
    "设置为 00:00 时按自然日归类。"
  ].join("\n");
  return `
    <article class="tag-group-card date-tag-special-group">
      <div class="tag-group-head">
        <label class="toggle switch-toggle tag-group-enabled-toggle">
          <input id="dateTagEnabled" type="checkbox" checked disabled aria-label="添加日期标签始终启用" />
          <span class="switch-slider" aria-hidden="true"></span>
          <span class="switch-label">启用</span>
        </label>
        <div class="field-row date-tag-name-field">
          <span class="field-label">${icon("tag")}标签组</span>
          <strong class="field-control">添加日期</strong>
        </div>
        <label class="date-tag-cutoff-field">
          <span class="field-label">${icon("clock")}日切时间</span>
          <input id="dateTagCutoffTime" type="time" step="60" value="${escapeHtml(dateTag.cutoffTime || "00:00")}" />
        </label>
        <button class="activation-help-icon date-tag-help" type="button" aria-label="日切时间说明" title="${escapeHtml(cutoffHelp)}">
          ${icon("info")}
        </button>
      </div>
    </article>
  `;
}

function renderNormalTagGroups(groups) {
  return groups.length
    ? groups
        .map((group, groupIndex) => {
          const groupKey = tagGroupCollapseKey(group, groupIndex);
          const groupCollapsed = collapsedTagGroups.has(groupKey);
          const tagCount = (group.tags || []).length;
          return `
            <article class="tag-group-card ${groupCollapsed ? "is-collapsed" : ""}" data-tag-group-index="${groupIndex}" data-tag-group-collapse-key="${escapeHtml(groupKey)}">
              <div class="tag-group-head">
                <label class="toggle switch-toggle tag-group-enabled-toggle">
                  <input data-tag-group-field="enabled" type="checkbox" ${group.enabled ? "checked" : ""} />
                  <span class="switch-slider" aria-hidden="true"></span>
                  <span class="switch-label">启用</span>
                </label>
                <label class="tag-name-field">
                  <span class="field-label">${icon("tag")}标签组</span>
                  <input data-tag-group-field="name" value="${escapeHtml(group.name)}" placeholder="例如：意向等级" />
                </label>
                <label class="toggle">
                  <input data-tag-group-field="exclusive" type="checkbox" ${group.exclusive ? "checked" : ""} />
                  组内互斥
                </label>
                <label class="toggle">
                  <input data-tag-group-field="oneWay" type="checkbox" ${group.oneWay ? "checked" : ""} />
                  单向变更
                </label>
                <div class="tag-card-actions">
                  <button class="secondary icon-button" data-add-tag="${groupIndex}" type="button" aria-label="新增标签" title="新增标签">${icon("plus")}</button>
                  <button class="danger icon-button" data-remove-tag-group="${groupIndex}" type="button" aria-label="删除标签组" title="删除标签组">${icon("reset")}</button>
                  <button class="collapse-button" data-toggle-tag-group="${groupIndex}" type="button" aria-label="${groupCollapsed ? "展开标签组" : "收起标签组"}" aria-expanded="${String(!groupCollapsed)}">
                    <svg class="icon" aria-hidden="true"><use href="#icon-chevron"></use></svg>
                  </button>
                </div>
              </div>
              <div class="tag-group-body">
                <div class="tag-group-body-inner">
                  <div class="tag-row-list">
                  ${tagCount
                    ? (group.tags || [])
                        .map((tag, tagIndex) => {
                          const activation = activationDraftForEditor(tag.activation || defaultActivationConfig());
                          const activationMessages = activation.messages.length ? activation.messages : [defaultActivationMessage()];
                          return `
                            <article class="tag-row-card" data-tag-index="${tagIndex}">
                              <div class="tag-row-head">
                                <label class="tag-name-field">
                                  <span class="field-label">${icon("tag")}标签</span>
                                  <input data-tag-field="name" value="${escapeHtml(tag.name)}" placeholder="例如：A类" />
                                </label>
                                <div class="tag-card-actions">
                                  <button class="danger icon-button" data-remove-tag="${groupIndex}:${tagIndex}" type="button" aria-label="删除标签" title="删除标签">${icon("reset")}</button>
                                </div>
                              </div>
                              <div class="tag-row-body">
                                <div class="tag-condition-row">
                                  <div class="expand-field-slot" data-tag-expand-field="condition">
                                    <label class="wide">
                                      <span class="field-label">${icon("check")}达标条件</span>
                                      <textarea class="expand-on-focus" data-tag-field="condition" rows="2" placeholder="例如：客户明确表示愿意合作或留下联系方式">${escapeHtml(tag.condition)}</textarea>
                                    </label>
                                  </div>
                                  <label class="toggle switch-toggle tag-voice-alert-toggle">
                                    <input data-tag-field="voiceAlertEnabled" type="checkbox" ${tag.voiceAlertEnabled ? "checked" : ""} />
                                    <span class="switch-slider" aria-hidden="true"></span>
                                    <span class="switch-label">语音提示</span>
                                  </label>
                                </div>
                                <section class="activation-editor tag-activation-editor ${activation.enabled ? "is-active" : ""}" aria-label="标签触发任务">
                                  <div class="activation-toolbar">
                                    <div class="activation-toolbar-main">
                                      <label class="toggle switch-toggle activation-toggle">
                                        <input data-tag-activation-field="enabled" type="checkbox" ${activation.enabled ? "checked" : ""} />
                                        <span class="switch-slider" aria-hidden="true"></span>
                                        <span>${icon("send")}启用触发任务</span>
                                      </label>
                                      <label class="toggle activation-toggle activation-polish-toggle">
                                        <input data-tag-activation-field="polishByAgent" type="checkbox" ${activation.polishByAgent ? "checked" : ""} />
                                        <span>${icon("terminal")}Agent 组织语言</span>
                                      </label>
                                    </div>
                                    <button class="secondary icon-button activation-add-button" data-add-tag-activation-message="${groupIndex}:${tagIndex}" type="button" aria-label="新增话术" title="新增话术">${icon("plus")}</button>
                                  </div>
                                  <div class="activation-messages">
                                    ${activationMessages
                                      .map((message, messageIndex) => `
                                        <div class="activation-message-card">
                                          <textarea data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-content rows="2" placeholder="贴上这个标签后要提醒客户的话术">${escapeHtml(message.content)}</textarea>
                                          <div class="activation-message-actions">
                                            <label class="activation-message-control" title="间隔（分钟）">
                                              ${icon("clock")}
                                              <input data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-interval type="number" min="0" value="${escapeHtml(message.intervalMinutes)}" aria-label="间隔（分钟）" />
                                              <span class="activation-message-unit">分钟</span>
                                            </label>
                                            <label class="activation-message-control" title="发送次数">
                                              ${icon("refresh")}
                                              <input data-tag-activation-message-index="${messageIndex}" data-tag-activation-message-max-times type="number" min="1" value="${escapeHtml(message.maxTimes)}" aria-label="发送次数" />
                                              <span class="activation-message-unit">次</span>
                                            </label>
                                            <button class="danger icon-button activation-remove-button" data-remove-tag-activation-message="${groupIndex}:${tagIndex}:${messageIndex}" type="button" aria-label="删除触发话术" title="删除触发话术">${icon("reset")}</button>
                                          </div>
                                        </div>
                                      `)
                                      .join("")}
                                  </div>
                                </section>
                              </div>
                            </article>
                          `;
                        })
                        .join("")
                    : `<div class="empty-state">这个标签组还没有标签。</div>`}
                  </div>
                </div>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">暂无标签组。可以先新增一个标签组，例如“意向等级”。</div>`;
}

function renderTagSchemaEditor() {
  state.tagSchema = normalizeTagSchemaDraft(state.tagSchema);
  if (!els.tagGroupList) return;
  const groups = state.tagSchema.groups || [];
  els.tagGroupList.innerHTML = `${renderDateTagSpecialGroup()}${renderNormalTagGroups(groups)}`;
  bindTagSchemaEditorEvents();
}

function bindTagSchemaEditorEvents() {
  dateTagCutoffInput()?.addEventListener("change", (event) => {
    const cutoffTime = normalizeDateTagCutoffTimeDraft(event.currentTarget.value);
    state.tagSchema.dateTag.cutoffTime = cutoffTime;
    event.currentTarget.value = cutoffTime;
  });
  els.tagGroupList.querySelectorAll("[data-tag-group-field]").forEach((input) => {
    input.addEventListener("input", () => updateTagGroupDraft(input));
    input.addEventListener("change", () => updateTagGroupDraft(input));
  });
  els.tagGroupList.querySelectorAll("[data-tag-field]").forEach((input) => {
    input.addEventListener("input", () => updateTagDraft(input));
    input.addEventListener("change", () => updateTagDraft(input));
  });
  els.tagGroupList.querySelectorAll("[data-tag-activation-field]").forEach((input) => {
    input.addEventListener("input", () => updateTagActivationDraft(input));
    input.addEventListener("change", () => updateTagActivationDraft(input));
  });
  els.tagGroupList.querySelectorAll("[data-tag-activation-message-index]").forEach((input) => {
    input.addEventListener("input", () => updateTagActivationMessageDraft(input));
  });
  els.tagGroupList.querySelectorAll("[data-toggle-tag-group]").forEach((button) => {
    button.addEventListener("click", () => toggleTagGroupCollapse(Number(button.dataset.toggleTagGroup)));
  });
  els.tagGroupList.querySelectorAll("[data-add-tag]").forEach((button) => {
    button.addEventListener("click", () => addTag(Number(button.dataset.addTag)));
  });
  els.tagGroupList.querySelectorAll("[data-remove-tag-group]").forEach((button) => {
    button.addEventListener("click", () => removeTagGroup(Number(button.dataset.removeTagGroup)));
  });
  els.tagGroupList.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, tagIndex] = button.dataset.removeTag.split(":").map(Number);
      removeTag(groupIndex, tagIndex);
    });
  });
  els.tagGroupList.querySelectorAll("[data-add-tag-activation-message]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, tagIndex] = button.dataset.addTagActivationMessage.split(":").map(Number);
      addTagActivationMessage(groupIndex, tagIndex);
    });
  });
  els.tagGroupList.querySelectorAll("[data-remove-tag-activation-message]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, tagIndex, messageIndex] = button.dataset.removeTagActivationMessage.split(":").map(Number);
      removeTagActivationMessage(groupIndex, tagIndex, messageIndex);
    });
  });
}

function toggleTagGroupCollapse(groupIndex) {
  const group = state.tagSchema.groups[groupIndex];
  if (!group) return;
  const collapseKey = tagGroupCollapseKey(group, groupIndex);
  if (collapsedTagGroups.has(collapseKey)) {
    collapsedTagGroups.clear();
    (state.tagSchema.groups || []).forEach((item, index) => {
      collapsedTagGroups.add(tagGroupCollapseKey(item, index));
    });
    collapsedTagGroups.delete(collapseKey);
  } else {
    collapsedTagGroups.add(collapseKey);
  }
  els.tagGroupList.querySelectorAll("[data-tag-group-collapse-key]").forEach((groupCard) => {
    const isCollapsed = collapsedTagGroups.has(groupCard.dataset.tagGroupCollapseKey || "");
    updateCollapseCardVisual(groupCard, isCollapsed, {
      bodySelector: ".tag-group-body",
      toggleSelector: "[data-toggle-tag-group]",
      expandLabel: "展开标签组",
      collapseLabel: "收起标签组"
    });
  });
}

function tagGroupForInput(input) {
  const groupIndex = Number(input.closest("[data-tag-group-index]")?.dataset.tagGroupIndex);
  return state.tagSchema.groups[groupIndex];
}

function tagForInput(input) {
  const group = tagGroupForInput(input);
  const tagIndex = Number(input.closest("[data-tag-index]")?.dataset.tagIndex);
  return group?.tags?.[tagIndex];
}

function updateTagGroupDraft(input) {
  const group = tagGroupForInput(input);
  if (!group) return;
  const field = input.dataset.tagGroupField;
  if (["enabled", "exclusive", "oneWay"].includes(field)) {
    group[field] = input.checked;
  } else if (field === "name") {
    group.name = input.value;
  }
}

function updateTagDraft(input) {
  const tag = tagForInput(input);
  if (!tag) return;
  if (input.dataset.tagField === "voiceAlertEnabled") {
    tag.voiceAlertEnabled = input.checked;
    return;
  }
  tag[input.dataset.tagField] = input.value;
}

function updateTagActivationDraft(input) {
  const tag = tagForInput(input);
  if (!tag) return;
  const activation = activationDraftForEditor(tag.activation);
  const field = input.dataset.tagActivationField;
  if (field === "enabled" || field === "polishByAgent") {
    activation[field] = input.checked;
  }
  tag.activation = activation;
  if (field === "enabled") {
    input.closest(".activation-editor")?.classList.toggle("is-active", Boolean(input.checked));
  }
}

function updateTagActivationMessageDraft(input) {
  const tag = tagForInput(input);
  if (!tag) return;
  const activation = activationDraftForEditor(tag.activation);
  const messageIndex = Number(input.dataset.tagActivationMessageIndex);
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  if (input.dataset.tagActivationMessageInterval !== undefined) {
    message.intervalMinutes = normalizeActivationIntervalMinutes(input.value, message.intervalMinutes);
  } else if (input.dataset.tagActivationMessageMaxTimes !== undefined) {
    message.maxTimes = Math.max(1, Number(input.value || message.maxTimes || 1));
  } else {
    message.content = input.value;
  }
  activation.messages[messageIndex] = message;
  tag.activation = activation;
}

function addTagGroup() {
  const index = state.tagSchema.groups.length + 1;
  const group = { ...defaultTagGroup(index), id: nextTagGroupId(index) };
  state.tagSchema.groups.push(group);
  collapseAllTagCards();
  collapsedTagGroups.delete(tagGroupCollapseKey(group, state.tagSchema.groups.length - 1));
  renderTagSchemaEditor();
}

function removeTagGroup(index) {
  const group = state.tagSchema.groups[index];
  if (group) {
    collapsedTagGroups.delete(tagGroupCollapseKey(group, index));
  }
  state.tagSchema.groups.splice(index, 1);
  renderTagSchemaEditor();
}

function addTag(groupIndex) {
  const group = state.tagSchema.groups[groupIndex];
  if (!group) return;
  const index = (group.tags || []).length + 1;
  const tag = { ...defaultTag(index), id: nextTagId(group, index) };
  group.tags = [...(group.tags || []), tag];
  collapseAllTagCards();
  collapsedTagGroups.delete(tagGroupCollapseKey(group, groupIndex));
  renderTagSchemaEditor();
}

function removeTag(groupIndex, tagIndex) {
  const group = state.tagSchema.groups[groupIndex];
  if (!group) return;
  group.tags.splice(tagIndex, 1);
  renderTagSchemaEditor();
}

function addTagActivationMessage(groupIndex, tagIndex) {
  const tag = state.tagSchema.groups[groupIndex]?.tags?.[tagIndex];
  if (!tag) return;
  const activation = activationDraftForEditor(tag.activation);
  activation.messages = [...activation.messages, defaultActivationMessage()];
  tag.activation = activation;
  renderTagSchemaEditor();
}

function removeTagActivationMessage(groupIndex, tagIndex, messageIndex) {
  const tag = state.tagSchema.groups[groupIndex]?.tags?.[tagIndex];
  if (!tag) return;
  const activation = activationDraftForEditor(tag.activation);
  activation.messages.splice(messageIndex, 1);
  tag.activation = activation;
  renderTagSchemaEditor();
}

async function loadTagSchema({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) return;
  const data = await request(`/api/tag-schemas/${encodeURIComponent(botId)}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  state.tagSchema = normalizeTagSchemaDraft(data.schema || defaultTagSchema());
  collapseAllTagCards();
  renderTagSchemaEditor();
  renderFlowSessionTagFilter();
  renderFlowSessionDateTagFilter();
}

async function saveTagSchema() {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) {
    toast("请选择 Bot");
    return;
  }
  state.tagSchema = normalizeTagSchemaDraft({
    ...state.tagSchema,
    dateTag: editableDateTagRule()
  });
  const data = await request(`/api/tag-schemas/${encodeURIComponent(botId)}`, {
    method: "PUT",
    botId,
    body: JSON.stringify({
      schema: {
        ...state.tagSchema,
        dateTag: editableDateTagRule()
      }
    })
  });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  state.tagSchema = normalizeTagSchemaDraft(data.schema || state.tagSchema);
  collapseAllTagCards();
  renderTagSchemaEditor();
  renderFlowSessionDateTagFilter();
  toast("标签配置已保存");
}

function exportTagSchema() {
  const schema = normalizeTagSchemaDraft({
    ...state.tagSchema,
    dateTag: editableDateTagRule()
  });
  schema.dateTag = editableDateTagRule();
  const blob = new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "customer-tags.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importTagSchemaFile(file) {
  if (!file) return;
  const schema = JSON.parse(await file.text());
  state.tagSchema = normalizeTagSchemaDraft({
    ...schema,
    dateTag: {
      ...(schema?.dateTag || {}),
      effectiveAt: ""
    }
  });
  collapseAllTagCards();
  renderTagSchemaEditor();
  renderFlowSessionTagFilter();
  renderFlowSessionDateTagFilter();
  toast("标签 JSON 已导入，保存后生效");
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

function renderFlowNodeExpandableField(node, definition) {
  const value = flowNodeFieldValue(node, definition.field);
  const rows = definition.list ? 3 : 2;
  return `
    <div class="expand-field-slot" data-flow-node-expand-field="${escapeHtml(definition.field)}">
      <label>
        ${flowNodeFieldLabel(definition.field, definition.label)}
        <textarea class="expand-on-focus" data-flow-node-field="${escapeHtml(definition.field)}" rows="${rows}" placeholder="${escapeHtml(definition.placeholder || "")}">${escapeHtml(value)}</textarea>
      </label>
    </div>
  `;
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
      const activationPolishByAgent = activation.polishByAgent;
      const activationMessages = activation.messages.length ? activation.messages : [defaultActivationMessage()];
      return `
        <article class="flow-node-card ${isCollapsed ? "is-collapsed" : ""}" data-flow-node-index="${index}" data-flow-node-collapse-key="${escapeHtml(collapseKey)}" data-flow-node-draggable>
          <div class="flow-node-card-head">
            <button class="flow-node-drag-handle" data-flow-node-drag-handle="${index}" type="button" aria-label="拖拽调整节点顺序" title="拖拽调整节点顺序">
              ${icon("grip")}
            </button>
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
          <div class="flow-node-card-body">
            <div class="flow-node-card-body-inner">
              <div class="flow-node-grid">
                ${flowNodeQuickFields.map((definition) => renderFlowNodeExpandableField(node, definition)).join("")}
              </div>
              <section class="activation-editor ${activationEnabled ? "is-active" : ""}" aria-label="客户激活设置">
            <div class="activation-toolbar">
              <div class="activation-toolbar-main">
                <label class="toggle switch-toggle activation-toggle">
                  <input data-flow-node-activation-field="enabled" type="checkbox" ${activationEnabled ? "checked" : ""} />
                  <span class="switch-slider" aria-hidden="true"></span>
                  <span>${icon("send")}启用客户激活</span>
                </label>
                <label class="toggle activation-toggle activation-polish-toggle">
                  <input data-flow-node-activation-field="polishByAgent" type="checkbox" ${activationPolishByAgent ? "checked" : ""} />
                  <span>${icon("terminal")}Agent 组织语言</span>
                </label>
                <span class="activation-help-icon" tabindex="0" aria-label="激活参数说明" title="${escapeHtml("例：10 分钟后发第 1 条；填 0 则按 5 秒倒计时。还没回复，第 2 次按更长间隔继续提醒。Agent 组织语言会先润色话术。")}">
                  ${icon("info")}
                </span>
              </div>
              <button class="secondary icon-button activation-add-button" data-add-activation-message="${index}" type="button" aria-label="新增话术" title="新增话术">
                ${icon("plus")}
              </button>
            </div>
            <div class="activation-messages">
              ${activationMessages
                .map((activationMessage, messageIndex) => `
                  <div class="activation-message-card">
                    <textarea data-action-target-activation="${index}:${messageIndex}" data-activation-message-index="${messageIndex}" data-activation-message-content rows="2" placeholder="激活话术，例如：再提醒您一下，看到后回我一句就行">${escapeHtml(formatActivationMessageForEditor(activationMessage))}</textarea>
                    <div class="activation-message-actions">
                      <label class="activation-message-control" title="间隔（分钟）">
                        ${icon("clock")}
                        <input data-activation-message-index="${messageIndex}" data-activation-message-interval type="number" min="0" value="${escapeHtml(activationMessage.intervalMinutes)}" aria-label="间隔（分钟）" />
                        <span class="activation-message-unit">分钟</span>
                      </label>
                      <label class="activation-message-control" title="发送次数">
                        ${icon("refresh")}
                        <input data-activation-message-index="${messageIndex}" data-activation-message-max-times type="number" min="1" value="${escapeHtml(activationMessage.maxTimes)}" aria-label="发送次数" />
                        <span class="activation-message-unit">次</span>
                      </label>
                      <button class="danger icon-button activation-remove-button" data-remove-activation-message="${index}:${messageIndex}" type="button" aria-label="删除激活话术" title="删除激活话术">${icon("reset")}</button>
                    </div>
                  </div>
                `)
                .join("")}
            </div>
              </section>
            </div>
          </div>
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
  els.flowNodeList.querySelectorAll("[data-flow-node-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startFlowNodeDrag(event, handle));
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
  bindActionTargets();
  els.flowNodeList.querySelectorAll("[data-node-action-group-name]").forEach((input) => {
    input.addEventListener("input", () => updateNodeActionInput(input));
  });
  els.flowNodeList.querySelectorAll("[data-activation-action-group-name]").forEach((input) => {
    input.addEventListener("input", () => updateActivationActionInput(input));
  });
  els.flowNodeList.querySelectorAll("[data-remove-node-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeIndex, actionIndex] = button.dataset.removeNodeAction.split(":").map(Number);
      removeNodeAction(nodeIndex, actionIndex);
    });
  });
  els.flowNodeList.querySelectorAll("[data-remove-activation-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeIndex, messageIndex, actionIndex] = button.dataset.removeActivationAction.split(":").map(Number);
      removeActivationAction(nodeIndex, messageIndex, actionIndex);
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
        collapseAllFlowNodes();
        collapsedFlowNodes.delete(collapseKey);
      } else {
        collapseAllFlowNodes();
        collapsedFlowNodes.add(collapseKey);
      }
      els.flowNodeList.querySelectorAll("[data-flow-node-collapse-key]").forEach((nodeCard) => {
        const isCollapsed = collapsedFlowNodes.has(nodeCard.dataset.flowNodeCollapseKey || "");
        updateCollapseCardVisual(nodeCard, isCollapsed, {
          bodySelector: ".flow-node-card-body",
          toggleSelector: "[data-toggle-flow-node]",
          expandLabel: "展开任务节点",
          collapseLabel: "收起任务节点"
        });
      });
    });
  });
}

async function loadFlowMachine({ useDefault = false, contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) return;
  const data = await request(
    `/api/flow-machines/${encodeURIComponent(botId)}${useDefault ? "?default=1" : ""}`
  );
  if (!isCurrentBotContext(botId, contextVersion)) return;
  currentFlowMachine = data.machine || null;
  if (currentFlowMachine?.config) {
    els.flowMachineForm.enabled.checked = Boolean(currentFlowMachine.enabled);
    setFlowEditorFromConfig(currentFlowMachine.config);
  } else {
    els.flowMachineForm.enabled.checked = false;
    setFlowEditorFromConfig({});
  }
  renderFlowSessionNodeFilter();
  if (!useDefault && currentFlowSessions.length) renderFlowSessions();
}

async function saveFlowMachine(event) {
  event.preventDefault();
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) {
    toast("请先选择 Bot");
    return;
  }
  const config = buildFlowConfigFromEditor();
  const data = await request(`/api/flow-machines/${encodeURIComponent(botId)}`, {
    method: "PUT",
    botId,
    body: JSON.stringify({
      enabled: els.flowMachineForm.enabled.checked,
      config
    })
  });
  if (!isCurrentBotContext(botId, contextVersion)) return;
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

async function importFlowConfigFile(file) {
  if (!file) return;
  try {
    const config = JSON.parse(await file.text());
    setFlowEditorFromConfig(config);
    toast("状态机配置已导入，保存后生效");
  } catch {
    toast("状态机配置 JSON 格式不正确");
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

async function loadFlowSessions({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) return;
  const params = new URLSearchParams();
  params.set("botId", botId);
  params.set("page", String(state.flowSessionsPagination.page));
  params.set("pageSize", String(state.flowSessionsPagination.pageSize));
  params.set("type", currentFlowSessionTypeFilter());
  const query = String(els.flowSessionSearchInput?.value || "").trim();
  if (query) params.set("query", query);
  const nodeFilter = String(els.flowSessionNodeFilter?.value || "").trim();
  if (currentFlowSessionTypeFilter() === "private" && nodeFilter && nodeFilter !== "all") {
    params.set("nodeId", nodeFilter);
  }
  for (const tagFilter of selectedFlowSessionTagFilterValues()) {
    params.append("tag", tagFilter);
  }
  const dateTagFilter = dateTagFilterKeyFromInput(els.flowSessionDateTagFilter?.value || "");
  if (dateTagFilter !== "all") params.set("dateTag", dateTagFilter);
  const data = await request(`/api/flow-sessions?${params.toString()}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  currentFlowSessions = data.sessions || [];
  state.flowSessionsPagination = normalizePagination(data.pagination, state.flowSessionsPagination);
  renderFlowSessionNodeFilter();
  renderFlowSessionTagFilter();
  renderFlowSessionDateTagFilter();
  renderFlowSessions();
  renderPaginationBar({
    container: els.flowSessionsPaginationEl,
    pagination: state.flowSessionsPagination,
    onPage: (page) => {
      state.flowSessionsPagination.page = page;
      loadFlowSessions().catch(toastError);
    },
    onPageSize: (pageSize) => {
      state.flowSessionsPagination.page = 1;
      state.flowSessionsPagination.pageSize = pageSize;
      loadFlowSessions().catch(toastError);
    }
  });
}

function sortFlowSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const aHuman = flowSessionType(a) === "private" && a.handoffStatus === "human" ? 1 : 0;
    const bHuman = flowSessionType(b) === "private" && b.handoffStatus === "human" ? 1 : 0;
    if (aHuman !== bHuman) return bHuman - aHuman;
    return Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || 0)
      - Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || 0);
  });
}

function flowSessionType(session) {
  const conversationKey = String(session?.conversationKey || "");
  if (conversationKey.includes(":group:") || conversationKey.includes(":group-id:")) return "group";
  if (conversationKey.includes(":private:")) return "private";
  const roomType = Number(session?.roomType || 0);
  if (roomType === 1 || roomType === 3) return "group";
  if (roomType === 2 || roomType === 4) return "private";
  return session?.groupName && !session?.receivedName ? "group" : "private";
}

function flowSessionDisplayName(session) {
  const conversationKey = String(session?.conversationKey || "");
  const fallback = conversationKey.split(":").pop() || conversationKey || "未命名会话";
  if (flowSessionType(session) === "group") {
    return session?.groupName || fallback;
  }
  return session?.receivedName || fallback;
}

function sessionUsesFlowFilters(session) {
  return flowSessionType(session) === "private";
}

function currentFlowSessionTypeFilter() {
  return document.querySelector("[data-flow-session-type].active")?.dataset.flowSessionType || "private";
}

function setFlowSessionTypeSelection(type) {
  const nextType = type === "group" ? "group" : "private";
  els.flowSessionTypeButtons.forEach((button) => {
    const active = button.dataset.flowSessionType === nextType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  syncFlowSessionTypeUi();
}

function syncFlowSessionTypeUi() {
  const isGroup = currentFlowSessionTypeFilter() === "group";
  els.flowSessionFilters?.classList.toggle("is-group", isGroup);
  if (els.flowSessionNodeFilterField) els.flowSessionNodeFilterField.hidden = isGroup;
  if (els.flowSessionNodeFilter) {
    els.flowSessionNodeFilter.disabled = isGroup;
    if (isGroup) els.flowSessionNodeFilter.value = "all";
  }
  if (els.flowSessionSearchLabel) {
    els.flowSessionSearchLabel.lastChild.textContent = isGroup ? "搜索群聊" : "搜索客户";
  }
  if (els.flowSessionSearchInput) {
    els.flowSessionSearchInput.placeholder = isGroup ? "搜索群名" : "搜索客户";
  }
  if (isGroup) hideFlowSessionManualTagMenu();
}

function clearSelectedFlowConversation() {
  state.selectedFlowConversationKey = "";
  state.loadingFlowConversationKey = "";
  currentFlowSession = null;
  syncHandoffButton(null);
  renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
  if (els.chatTagList) els.chatTagList.innerHTML = "";
  els.flowEventsOutput.textContent = "";
  els.chatTitle.textContent = emptyFlowSessionTitle();
  els.chatMessages.innerHTML = `<div class="empty-state">${escapeHtml(emptyFlowSessionTitle())}</div>`;
}

function emptyFlowSessionTitle() {
  const typeFilter = currentFlowSessionTypeFilter();
  if (typeFilter === "group") return "请选择一个群聊会话";
  return "请选择一个私聊会话";
}

function getVisibleFlowSessions() {
  const typeFilter = currentFlowSessionTypeFilter();
  const normalizedSessionSearch = String(els.flowSessionSearchInput.value || "").trim().toLowerCase();
  const nodeFilter = els.flowSessionNodeFilter.value;
  const tagFilters = new Set(selectedFlowSessionTagFilterValues());
  const dateTagFilterKey = dateTagFilterKeyFromInput(els.flowSessionDateTagFilter?.value || "");

  return sortFlowSessions(currentFlowSessions.filter((session) => {
    if (flowSessionType(session) !== typeFilter) return false;
    const appliesFlowFilters = sessionUsesFlowFilters(session);
    if (normalizedSessionSearch) {
      const searchableText = [
        session.receivedName,
        session.groupName,
        session.conversationKey
      ].filter(Boolean).join(" ").toLowerCase();
      if (!searchableText.includes(normalizedSessionSearch)) return false;
    }
    if (appliesFlowFilters && nodeFilter !== "all" && session.currentNodeId !== nodeFilter) return false;
    if (tagFilters.size && !(session.tags || []).some((tag) => tagFilters.has(tagFilterKey(tag)))) return false;
    if (dateTagFilterKey !== "all" && !(session.tags || []).some((tag) => tag.tagType === "date" && tagFilterKey(tag) === dateTagFilterKey)) return false;
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

function renderFlowSessionTagFilter() {
  if (!els.flowSessionTagFilter) return;
  const current = new Set(selectedFlowSessionTagFilterValues());
  const options = [];
  for (const group of enabledManualTagGroups()) {
    for (const tag of group.tags || []) {
      const key = `${group.id}:${tag.id}`;
      options.push({
        value: key,
        label: tag.name,
        groupLabel: group.name || "未分组标签"
      });
    }
  }
  for (const value of current) {
    if (!options.some((option) => option.value === value)) {
      options.push({
        value,
        label: value,
        groupLabel: "已选标签"
      });
    }
  }
  const selected = [...current].filter((value) => options.some((option) => option.value === value));
  renderTagMultiSelectControl({
    select: els.flowSessionTagFilter,
    button: els.flowSessionTagFilterButton,
    menu: els.flowSessionTagFilterMenu,
    options,
    selectedValues: selected,
    emptyLabel: "选择标签"
  });
}

function setFlowSessionTagFilterValues(values) {
  if (!els.flowSessionTagFilter) return;
  const { reload = true } = arguments[1] || {};
  const selected = new Set(values.filter((value) => value && value !== "all"));
  [...els.flowSessionTagFilter.options].forEach((option) => {
    option.selected = option.value === "all" ? selected.size === 0 : selected.has(option.value);
  });
  renderFlowSessionTagFilter();
  if (reload) reloadFlowSessionsFromFirstPage().catch(toastError);
}

function renderFlowSessionDateTagFilter() {
  if (!els.flowSessionDateTagFilter) return;
  const dateTagEnabled = Boolean(state.tagSchema?.dateTag?.enabled);
  normalizeFlowSessionDateTagFilter();
  els.flowSessionDateTagFilter.disabled = !dateTagEnabled;
}

function captureFlowSessionPositions() {
  const positions = new Map();
  els.flowSessionList?.querySelectorAll("[data-flow-session]").forEach((card) => {
    positions.set(card.dataset.flowSession, card.getBoundingClientRect().top);
  });
  return positions;
}

function animateFlowSessionReorder(previousPositions) {
  if (!previousPositions?.size || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  els.flowSessionList?.querySelectorAll("[data-flow-session]").forEach((card) => {
    const previousTop = previousPositions.get(card.dataset.flowSession);
    if (!Number.isFinite(previousTop)) return;
    const delta = previousTop - card.getBoundingClientRect().top;
    if (Math.abs(delta) < 2 || typeof card.animate !== "function") return;
    card.classList.add("is-reordering");
    const animation = card.animate(
      [
        { transform: `translateY(${delta}px)` },
        { transform: "translateY(0)" }
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
    );
    const cleanup = () => card.classList.remove("is-reordering");
    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  });
}

function renderFlowSessions({ animateFrom = null } = {}) {
  const visibleSessions = getVisibleFlowSessions();
  const typeFilter = currentFlowSessionTypeFilter();
  const emptyCopy = typeFilter === "private"
    ? "没有符合筛选条件的私聊会话。"
    : "没有符合筛选条件的群聊会话。";
  els.flowSessionList.innerHTML = visibleSessions.length
    ? visibleSessions
        .map((session) => {
          const active = session.conversationKey === state.selectedFlowConversationKey;
          const sessionType = flowSessionType(session);
          const name = flowSessionDisplayName(session);
          const avatar = sessionType === "group" ? "./assets/group.png" : "./assets/ddeer.png";
          const isLegacyCustomer = sessionType === "private" && session?.customerOrigin === "legacy";
          const status = flowNodeName(session.currentNodeId);
          const statusLabel = compactFlowNodeName(status);
          const isHandoff = sessionType === "private" && session.handoffStatus === "human";
          const manualTagTrigger = sessionType === "private"
            ? `<span
                class="flow-session-manual-tag-trigger"
                data-flow-manual-tag-trigger="${escapeHtml(session.conversationKey)}"
                role="button"
                tabindex="0"
                title="手工打标签"
                aria-label="给${escapeHtml(name)}手工打标签"
              >${icon("tag")}</span>`
            : "";
          const privateSessionTools = sessionType === "private"
            ? `<span class="flow-session-tools">
                <span class="flow-session-current-task" title="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
              </span>`
            : "";
          const handoffSwitch = sessionType === "private"
            ? `<span class="flow-session-switch handoff-switch ${isHandoff ? "is-human" : ""}" data-flow-handoff-switch="${escapeHtml(session.conversationKey)}" role="switch" tabindex="0" aria-checked="${isHandoff ? "true" : "false"}" title="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}" aria-label="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}">
                <span class="handoff-switch-option is-ai" aria-hidden="true">${icon("robot")}</span>
                <span class="handoff-switch-option is-human" aria-hidden="true">${icon("user")}</span>
                <span class="handoff-switch-thumb" aria-hidden="true"></span>
              </span>`
            : "";
          return `
            <button class="flow-session-card ${sessionType === "group" ? "is-group" : "is-private"} ${active ? "selected" : ""} ${isHandoff ? "is-handoff" : ""} ${isLegacyCustomer ? "is-legacy" : ""}" data-flow-session="${escapeHtml(session.conversationKey)}" type="button">
              <span class="flow-session-avatar-shell ${isLegacyCustomer ? "is-legacy" : ""}" title="${isLegacyCustomer ? "老客户" : ""}">
                <img class="flow-session-avatar ${sessionType === "group" ? "is-group" : ""}" src="${avatar}" alt="" aria-hidden="true" />
              </span>
              <span class="flow-session-main">
                <span class="flow-session-name-row">
                  <strong class="flow-session-name" title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                </span>
                ${renderConversationDateTag(session.tags || [])}
                ${manualTagTrigger}
                <span class="flow-session-tag-zone">
                  ${renderConversationTags(session.tags || [], { includeDate: false })}
                </span>
                ${privateSessionTools}
              </span>
              ${handoffSwitch}
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state">${currentFlowSessions.length ? emptyCopy : "暂无客户会话。启用状态机后，新的私聊或群聊会自动出现在这里。"}</div>`;

  els.flowSessionList.querySelectorAll("[data-flow-session]").forEach((button) => {
    button.addEventListener("click", () =>
      openFlowSession(button.dataset.flowSession).catch(toastError)
    );
    button.addEventListener("contextmenu", (event) => {
      const session = currentFlowSessions.find((item) => item.conversationKey === button.dataset.flowSession);
      if (flowSessionType(session) !== "private") return;
      event.preventDefault();
      event.stopPropagation();
      renderFlowSessionManualTagMenu({
        session,
        x: event.clientX,
        y: event.clientY
      });
    });
  });
  els.flowSessionList.querySelectorAll("[data-flow-handoff-switch]").forEach((switchEl) => {
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSelectedConversationHandoff(switchEl.dataset.flowHandoffSwitch).catch(toastError);
    };
    switchEl.addEventListener("click", toggle);
    switchEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") toggle(event);
    });
  });
  els.flowSessionList.querySelectorAll("[data-flow-manual-tag-trigger]").forEach((trigger) => {
    const openMenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const session = currentFlowSessions.find(
        (item) => item.conversationKey === trigger.dataset.flowManualTagTrigger
      );
      const rect = trigger.getBoundingClientRect();
      renderFlowSessionManualTagMenu({
        session,
        x: rect.left,
        y: rect.bottom + 6
      });
    };
    trigger.addEventListener("click", openMenu);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openMenu(event);
    });
  });
  animateFlowSessionReorder(animateFrom);
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

function renderConversationAssetsForSession(session, assets) {
  if (flowSessionType(session) === "group") {
    renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
    return;
  }
  renderConversationAssets(assets || { fields: [], totalCount: 0, collectedCount: 0 });
}

function renderManualReplyEmojiBar() {
  if (!els.manualReplyEmojiBar || els.manualReplyEmojiBar.dataset.rendered === "true") return;
  els.manualReplyEmojiBar.innerHTML = manualReplyEmojis
    .map((emoji) => `<button type="button" data-manual-reply-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`)
    .join("");
  els.manualReplyEmojiBar.dataset.rendered = "true";
  els.manualReplyEmojiBar.querySelectorAll("[data-manual-reply-emoji]").forEach((button) => {
    button.addEventListener("click", () => insertManualReplyEmoji(button.dataset.manualReplyEmoji || ""));
  });
}

function insertManualReplyEmoji(emoji) {
  if (!emoji || !els.manualReplyInput || els.manualReplyInput.disabled) return;
  const input = els.manualReplyInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  const nextPosition = start + emoji.length;
  input.focus();
  input.setSelectionRange(nextPosition, nextPosition);
}

function renderManualReplyComposer(session) {
  if (!els.manualReplyComposer) return;
  const hasSession = Boolean(
    session
    && state.selectedFlowConversationKey
    && flowSessionType(session) === "private"
  );
  const isHuman = session?.handoffStatus === "human";
  const aiCard = els.manualReplyComposer.querySelector(".ai-takeover-card");
  const replyBox = els.manualReplyComposer.querySelector(".manual-reply-box");

  els.manualReplyComposer.hidden = !hasSession;
  els.manualReplyComposer.classList.toggle("is-ai", hasSession && !isHuman);
  els.manualReplyComposer.classList.toggle("is-human", hasSession && isHuman);
  if (aiCard) aiCard.hidden = !hasSession || isHuman;
  if (replyBox) replyBox.hidden = !hasSession || !isHuman;

  if (els.manualReplyInput) {
    els.manualReplyInput.disabled = !hasSession || !isHuman;
    els.manualReplyInput.placeholder = isHuman ? "输入人工回复，支持 emoji" : "AI 正在接管中";
  }
  if (els.manualReplySendButton) els.manualReplySendButton.disabled = !hasSession || !isHuman;
  renderManualReplyEmojiBar();
}

function syncHandoffButton(session = currentFlowSession) {
  currentFlowSession = session || null;
  const hasSession = Boolean(currentFlowSession && state.selectedFlowConversationKey);
  if (!hasSession) {
    if (els.chatStatusBadge) els.chatStatusBadge.hidden = true;
    renderManualReplyComposer(null);
    return;
  }

  const isHandoff = currentFlowSession.handoffStatus === "human";
  if (els.chatStatusBadge) {
    els.chatStatusBadge.hidden = true;
    els.chatStatusBadge.innerHTML = "";
    els.chatStatusBadge.classList.remove("is-ai", "is-human");
  }
  renderManualReplyComposer(currentFlowSession);
}

function resolveInboundImageMessage(message) {
  const rawPayload = message?.rawPayload || {};
  const isImage = Number(rawPayload.textType) === 2;
  if (!isImage) return null;
  const fileUrl = [rawPayload.fileUrl, rawPayload.filePath, rawPayload.imageUrl]
    .map((value) => String(value || "").trim())
    .find((value) => /^https?:\/\//i.test(value)) || "";
  return {
    fileUrl,
    fileName: String(rawPayload.fileName || "").trim() || "图片消息"
  };
}

function renderChatMessageContent(message) {
  const mediaPayload = message.rawPayload?.messagePayload;
  const mediaType = String(message.rawPayload?.messageType || "");
  const sources = renderChatSources(message.rawPayload?.sources);
  const attachments = renderChatAttachments(
    message.rawPayload?.attachments || message.rawPayload?.agentReply?.attachments
  );
  const inboundImage = resolveInboundImageMessage(message);
  if (inboundImage) {
    const caption = String(message.content || "").trim();
    const media = inboundImage.fileUrl
      ? `<img class="chat-media-image" src="${escapeHtml(inboundImage.fileUrl)}" alt="${escapeHtml(inboundImage.fileName)}" loading="lazy" />`
      : `<div class="chat-media-placeholder">${icon("image")}<span>图片消息</span></div>`;
    return `
      <div class="chat-media">
        ${media}
        ${caption && caption !== "[图片消息]" ? `<div class="chat-text">${escapeHtml(caption)}</div>` : ""}
        ${attachments}
        ${sources}
      </div>
    `;
  }
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
        ${attachments}
        ${sources}
      </div>
    `;
  }
  return `
    <div class="chat-text">${escapeHtml(message.content)}</div>
    ${attachments}
    ${sources}
  `;
}

function attachmentTypeLabel(type) {
  return {
    image: "图片",
    file: "文件",
    video: "视频",
    audio: "音频",
    link: "链接"
  }[String(type || "").trim()] || "附件";
}

function renderChatAttachments(value) {
  const attachments = Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && item.url)
    : [];
  if (!attachments.length) return "";
  return `
    <div class="chat-attachments" aria-label="附件链接">
      ${attachments
        .map((attachment) => {
          const type = attachmentTypeLabel(attachment.type || attachment.fileType);
          const name = attachment.name || attachment.title || attachment.url;
          const label = `${type}：${name}`;
          return `<a class="chat-attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(attachment.url)}">${escapeHtml(label)}</a>`;
        })
        .join("")}
    </div>
  `;
}

function sourceTypeLabel(type) {
  return {
    enterprise_knowledge: "企业智库",
    knowledge: "企业智库",
    experience: "经验库",
    flow_node: "任务节点",
    conversation: "会话",
    profile: "客户档案",
    llm_fallback: "模型兜底"
  }[String(type || "").trim()] || "来源";
}

function sourceTypeIcon(type) {
  return {
    enterprise_knowledge: "info",
    knowledge: "info",
    experience: "briefcase",
    flow_node: "edit",
    conversation: "users",
    profile: "user",
    llm_fallback: "terminal"
  }[String(type || "").trim()] || "link";
}

function sourceTypeShortLabel(type) {
  return {
    enterprise_knowledge: "智库",
    knowledge: "智库",
    experience: "经验",
    flow_node: "任务",
    conversation: "会话",
    profile: "客户",
    llm_fallback: "AI"
  }[String(type || "").trim()] || "来源";
}

function shouldShowChatSource(source) {
  const type = String(source?.type || "").trim();
  return type !== "conversation";
}

function renderChatSources(value) {
  const sources = Array.isArray(value)
    ? value.filter((source) => source && typeof source === "object" && source.type && source.name && shouldShowChatSource(source))
    : [];
  if (!sources.length) return "";
  return `
    <div class="chat-sources" aria-label="回复来源">
      ${sources
        .map((source) => {
          const label = `${sourceTypeLabel(source.type)}：${source.name}`;
          const tooltip = source.reason ? `${label}\n${source.reason}` : label;
          return `<span class="chat-source-chip" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(label)}">${icon(sourceTypeIcon(source.type))}<span>${escapeHtml(sourceTypeShortLabel(source.type))}</span></span>`;
        })
        .join("")}
    </div>
  `;
}

async function openFlowSession(conversationKey, {
  anchorMessageId = "",
  alertTagName = "",
  missingEvidence = false
} = {}) {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) return false;
  if (state.loadingFlowConversationKey === conversationKey) return false;
  state.selectedFlowConversationKey = conversationKey;
  const session = currentFlowSessions.find((item) => item.conversationKey === conversationKey);
  renderFlowSessions();
  els.chatTitle.textContent = flowSessionDisplayName(session || { conversationKey });
  state.loadingFlowConversationKey = conversationKey;
  renderChatLoadingState(session || { conversationKey });
  try {
    const params = new URLSearchParams({ limit: "300", botId });
    if (anchorMessageId) params.set("anchorMessageId", String(anchorMessageId));
    const data = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}?${params.toString()}`);
    if (!isCurrentBotContext(botId, contextVersion) || state.selectedFlowConversationKey !== conversationKey) {
      return false;
    }
    const currentTags = data.tags || session?.tags || [];
    const detailedSession = data.session
      ? {
          ...(session || {}),
          ...data.session,
          tags: currentTags
        }
      : null;
    currentFlowSession = detailedSession || {
      ...(session || {}),
      tags: currentTags
    };
    if (detailedSession) {
      currentFlowSessions = window.upsertFlowSession(currentFlowSessions, detailedSession);
    }
    renderFlowSessions();
    if (els.chatTagList) els.chatTagList.innerHTML = renderConversationTags(currentTags);
    renderFlowSessionTagFilter();
    renderFlowSessionDateTagFilter();
    syncHandoffButton(currentFlowSession);
    renderConversationAssetsForSession(
      currentFlowSession,
      data.assets || session?.assets || { fields: [], totalCount: 0, collectedCount: 0 }
    );
    renderChatMessages(data.messages || [], {
      anchorMessageId,
      alertTagName,
      missingEvidence: Boolean(missingEvidence || (anchorMessageId && data.evidenceFound === false))
    });
    els.flowEventsOutput.textContent = JSON.stringify(data.events || [], null, 2);
    return true;
  } catch (error) {
    if (isCurrentBotContext(botId, contextVersion) && state.selectedFlowConversationKey === conversationKey) {
      renderChatLoadError(error);
    }
    throw error;
  } finally {
    if (state.loadingFlowConversationKey === conversationKey) {
      state.loadingFlowConversationKey = "";
    }
  }
}

async function toggleSelectedConversationHandoff(conversationKey = state.selectedFlowConversationKey) {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  const targetSession = currentFlowSessions.find((session) => session.conversationKey === conversationKey)
    || (conversationKey === state.selectedFlowConversationKey ? currentFlowSession : null);
  if (!botId || !conversationKey || !targetSession) {
    toast("请先选择会话");
    return;
  }
  const nextStatus = targetSession.handoffStatus === "human" ? "ai" : "human";
  const data = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/handoff`, {
    method: "PUT",
    botId,
    body: JSON.stringify({
      botId,
      handoffStatus: nextStatus,
      reason: nextStatus === "human" ? "控制台人工接手" : "控制台恢复 AI"
    })
  });
  if (!isCurrentBotContext(botId, contextVersion)) return;
  const previousPositions = captureFlowSessionPositions();
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
  renderFlowSessions({ animateFrom: previousPositions });
  toast(nextStatus === "human" ? "已切换为人工接手" : "已恢复 AI 接手");
}

function renderChatMessages(messages, {
  anchorMessageId = "",
  alertTagName = "",
  missingEvidence = false
} = {}) {
  const normalizedAnchorMessageId = String(anchorMessageId || "");
  els.chatMessages.innerHTML = messages.length
    ? messages
        .map((message) => {
          const outbound = message.direction === "outbound";
          const avatar = outbound ? "./assets/bot-avatar.png" : "./assets/ddeer.png";
          const sender = message.senderName || (outbound ? "机器人" : "客户");
          const isEvidence = normalizedAnchorMessageId && String(message.id) === normalizedAnchorMessageId;
          return `
          <div
            class="chat-bubble-row ${outbound ? "outbound" : "inbound"} ${isEvidence ? "is-tag-evidence-highlight" : ""}"
            data-message-id="${escapeHtml(message.id)}"
          >
            ${outbound ? "" : `<img class="chat-avatar" src="${avatar}" alt="" aria-hidden="true" />`}
            <div class="chat-bubble">
              <div class="chat-meta">
                <small>${escapeHtml(sender)}</small>
                <time>${escapeHtml(formatDisplayDateTime(message.createdAt))}</time>
              </div>
              ${renderChatMessageContent(message)}
              ${isEvidence && alertTagName
                ? `<div class="tag-evidence-note">${icon("tag")}<span>此消息触发「${escapeHtml(alertTagName)}」标签</span></div>`
                : ""}
            </div>
            ${outbound ? `<img class="chat-avatar" src="${avatar}" alt="" aria-hidden="true" />` : ""}
          </div>
        `;
        })
        .join("")
    : `<div class="empty-state">暂无会话记录</div>`;
  const evidenceMessage = [...els.chatMessages.querySelectorAll("[data-message-id]")]
    .find((element) => element.dataset.messageId === normalizedAnchorMessageId);
  if (evidenceMessage) {
    requestAnimationFrame(() => {
      evidenceMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => {
      evidenceMessage.classList.remove("is-tag-evidence-highlight");
    }, 3000);
  } else {
    if (missingEvidence || normalizedAnchorMessageId) {
      els.chatMessages.insertAdjacentHTML(
        "afterbegin",
        `<div class="tag-evidence-missing" role="status">${icon("info")}<span>原触发消息已不在会话记录中，已为您打开该客户的最新会话</span></div>`
      );
    }
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
}

function renderChatLoadingState(session) {
  currentFlowSession = null;
  if (els.chatTagList) els.chatTagList.innerHTML = "";
  renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
  renderManualReplyComposer(null);
  els.flowEventsOutput.textContent = "";
  els.chatMessages.innerHTML = `
    <div class="chat-loading-state" role="status" aria-live="polite">
      <div class="chat-loading-card">
        <img src="./assets/sorry.png" alt="" aria-hidden="true" />
        <span>
          <strong>正在加载会话记录...</strong>
          <small>${escapeHtml(flowSessionDisplayName(session || {}))}</small>
        </span>
      </div>
    </div>
  `;
}

function renderChatLoadError(error) {
  els.chatMessages.innerHTML = `
    <div class="empty-state">
      会话记录加载失败：${escapeHtml(error?.message || "请稍后重试")}
    </div>
  `;
}

async function sendManualReply(event) {
  event.preventDefault();
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  const conversationKey = state.selectedFlowConversationKey;
  if (!botId || !conversationKey || currentFlowSession?.handoffStatus !== "human") {
    toast("请先切换为人工接手");
    return;
  }
  const content = String(els.manualReplyInput?.value || "").trim();
  if (!content) {
    toast("请输入要发送的内容");
    return;
  }

  els.manualReplySendButton.disabled = true;
  try {
    await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/manual-reply`, {
      method: "POST",
      botId,
      body: JSON.stringify({
        botId,
        content
      })
    });
    if (!isCurrentBotContext(botId, contextVersion)) return;
    els.manualReplyInput.value = "";
    toast("已发送");
    await openFlowSession(conversationKey);
  } finally {
    if (isCurrentBotContext(botId, contextVersion) && currentFlowSession?.handoffStatus === "human") {
      els.manualReplySendButton.disabled = false;
    }
  }
}

async function resetSelectedConversation() {
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  const conversationKey = state.selectedFlowConversationKey;
  if (!botId || !conversationKey) {
    toast("请先选择会话");
    return;
  }
  closeConfirmDialog();
  setConversationResetSubmitting(true);
  try {
    await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/reset`, {
      method: "POST",
      botId,
      body: JSON.stringify({
        botId,
        reason: "控制台清空会话"
      })
    });
    if (!isCurrentBotContext(botId, contextVersion)) return;
    toast("会话已删除");
    state.selectedFlowConversationKey = "";
    currentFlowSession = null;
    syncHandoffButton(null);
    renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
    renderManualReplyComposer(null);
    if (els.chatTagList) els.chatTagList.innerHTML = "";
    els.flowEventsOutput.textContent = "";
    els.chatTitle.textContent = emptyFlowSessionTitle();
    els.chatMessages.innerHTML = `<div class="empty-state">${escapeHtml(emptyFlowSessionTitle())}</div>`;
  } finally {
    setConversationResetSubmitting(false);
  }
  try {
    await loadFlowSessions();
  } catch (error) {
    const authExpired = /解锁|登录|access|required|401/i.test(error.message);
    toast(authExpired
      ? "会话已删除，请重新登录后刷新列表"
      : "会话已删除，但列表刷新失败");
  }
}

function setConversationResetSubmitting(submitting) {
  els.conversationResetLoadingDialog.hidden = !submitting;
  els.resetConversationButton.disabled = submitting;
  els.confirmAcceptButton.disabled = submitting;
  els.confirmCancelButton.disabled = submitting;
}

function openConfirmDialog() {
  if (!state.selectedBotId || !state.selectedFlowConversationKey) {
    toast("请先选择会话");
    return;
  }
  openConfirmation({
    title: "删除会话？",
    message: "确认后会删除并清空当前会话记录。",
    acceptLabel: "确认删除",
    danger: true
  }).then((confirmed) => {
    if (confirmed) resetSelectedConversation().catch(toastError);
  });
}

function closeConfirmDialog() {
  els.confirmDialog.hidden = true;
}

function settleConfirmation(accepted) {
  const resolve = state.pendingConfirmationResolve;
  state.pendingConfirmationResolve = null;
  closeConfirmDialog();
  if (resolve) resolve(Boolean(accepted));
}

function openConfirmation({ title, message, acceptLabel = "确认", danger = false } = {}) {
  if (state.pendingConfirmationResolve) settleConfirmation(false);
  els.confirmTitle.textContent = title || "确认操作？";
  els.confirmMessage.textContent = message || "请确认是否继续。";
  els.confirmAcceptButton.classList.toggle("danger", danger);
  els.confirmAcceptButton.classList.toggle("primary", !danger);
  els.confirmAcceptButton.innerHTML = `${icon(danger ? "reset" : "check")} ${escapeHtml(acceptLabel)}`;
  els.confirmDialog.hidden = false;
  return new Promise((resolve) => {
    state.pendingConfirmationResolve = resolve;
  });
}

function toggleAssetsPanel() {
  if (!currentConversationAssets.totalCount) return;
  els.assetsPanel.hidden = !els.assetsPanel.hidden;
}

async function saveReplyWait(event) {
  event.preventDefault();
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  if (!botId) {
    toast("请先解锁 Bot");
    return;
  }
  const [replyWaitResult, historyAnalysisResult] = await Promise.all([
    request(`/api/bots/${encodeURIComponent(botId)}/settings/reply-wait`, {
      method: "PUT",
      botId,
      body: JSON.stringify({
        baseSeconds: Number(els.replyWaitForm.baseSeconds.value),
        incrementSeconds: Number(els.replyWaitForm.incrementSeconds.value),
        fallbackReply: els.replyWaitForm.fallbackReply.value
      })
    }),
    request(`/api/bots/${encodeURIComponent(botId)}/settings/history-analysis`, {
      method: "PUT",
      botId,
      body: JSON.stringify({
        historyCustomerTextMaxChars: Number(
          els.replyWaitForm.historyCustomerTextMaxChars.value
        )
      })
    })
  ]);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  els.replyWaitForm.baseSeconds.value = String(replyWaitResult.config?.baseSeconds ?? 10);
  els.replyWaitForm.incrementSeconds.value = String(replyWaitResult.config?.incrementSeconds ?? 5);
  els.replyWaitForm.fallbackReply.value =
    replyWaitResult.config?.fallbackReply || DEFAULT_REPLY_WAIT_FALLBACK_REPLY;
  els.replyWaitForm.historyCustomerTextMaxChars.value =
    String(historyAnalysisResult.config?.historyCustomerTextMaxChars ?? 4000);
  toast("消息/等待回复配置已保存");
}

async function saveBotAccessKey(event) {
  event.preventDefault();
  const botId = state.selectedBotId;
  if (!botId || !els.botAccessKeyForm) {
    toast("请先解锁 Bot");
    return;
  }
  const accessKey = String(new FormData(els.botAccessKeyForm).get("accessKey") || "").trim();
  if (!accessKey) {
    toast("请输入新的 Bot 密钥");
    return;
  }
  await request(`/api/bots/${encodeURIComponent(botId)}/access-key`, {
    method: "PUT",
    botId,
    body: JSON.stringify({ accessKey })
  });
  els.botAccessKeyForm.reset();
  toast("Bot 密钥已修改");
}

function proactiveAttachmentIcon(type) {
  return {
    image: "icon-image",
    video: "icon-video",
    audio: "icon-audio",
    file: "icon-file"
  }[type] || "icon-file";
}

function renderProactiveAttachments() {
  const files = state.proactiveUploadFiles || [];
  if (els.proactiveUploadName) {
    els.proactiveUploadName.textContent = files.length
      ? `${files.length}/${PROACTIVE_MAX_ATTACHMENTS} 个`
      : `最多 ${PROACTIVE_MAX_ATTACHMENTS} 个`;
  }
  els.proactiveUploadDropzone?.classList.toggle("has-file", files.length > 0);
  if (!els.proactiveAttachmentList) return;
  els.proactiveAttachmentList.innerHTML = files
    .map((file, index) => {
      const type = detectFileTypeFromName(file.name);
      return `
        <div class="proactive-attachment-card" title="${escapeHtml(file.name)}">
          <span class="proactive-attachment-icon" aria-hidden="true">
            <svg class="icon"><use href="#${proactiveAttachmentIcon(type)}"></use></svg>
          </span>
          <span class="proactive-attachment-name">${escapeHtml(file.name)}</span>
          <button class="icon-button danger" type="button" data-remove-proactive-attachment="${index}" aria-label="删除附件">
            <svg class="icon" aria-hidden="true"><use href="#icon-reset"></use></svg>
          </button>
        </div>
      `;
    })
    .join("");
}

function setProactiveUploadFiles(files) {
  const incomingFiles = Array.from(files || []).filter(Boolean);
  if (!incomingFiles.length) return;
  const availableSlots = PROACTIVE_MAX_ATTACHMENTS - state.proactiveUploadFiles.length;
  if (availableSlots <= 0) {
    toast(`最多只能上传 ${PROACTIVE_MAX_ATTACHMENTS} 个附件`);
    return;
  }
  state.proactiveUploadFiles = [
    ...state.proactiveUploadFiles,
    ...incomingFiles.slice(0, availableSlots)
  ];
  if (incomingFiles.length > availableSlots) {
    toast(`最多只能上传 ${PROACTIVE_MAX_ATTACHMENTS} 个附件，已保留前 ${PROACTIVE_MAX_ATTACHMENTS} 个`);
  }
  if (els.proactiveUploadFile) els.proactiveUploadFile.value = "";
  renderProactiveAttachments();
}

function removeProactiveUploadFile(index) {
  state.proactiveUploadFiles = state.proactiveUploadFiles.filter((_, itemIndex) => itemIndex !== index);
  if (els.proactiveUploadFile) els.proactiveUploadFile.value = "";
  renderProactiveAttachments();
}

function clearProactiveUpload() {
  state.proactiveUploadFiles = [];
  if (els.proactiveUploadFile) els.proactiveUploadFile.value = "";
  renderProactiveAttachments();
}

function setProactiveSubmitting(submitting) {
  state.proactiveSubmitting = submitting;
  if (els.proactiveSubmitButton) els.proactiveSubmitButton.disabled = submitting;
  if (els.proactiveSubmitText) els.proactiveSubmitText.textContent = submitting ? "处理中" : "创建并发送";
  if (els.proactiveUploadOverlay) els.proactiveUploadOverlay.hidden = !submitting;
  els.proactiveMessageFields?.classList.toggle("is-uploading", submitting);
}

function syncProactiveScheduleFields() {
  const enabled = Boolean(els.proactiveScheduleEnabled?.checked);
  if (els.proactiveScheduledAtField) els.proactiveScheduledAtField.hidden = !enabled;
  if (els.proactiveScheduledAt) els.proactiveScheduledAt.required = enabled;
}

function validateProactiveScheduledAt(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请选择定时发送时间");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  const scheduledAt = match ? new Date(`${raw}:00+08:00`) : new Date("invalid");
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new Error("定时发送时间必须晚于当前北京时间");
  }
  return raw;
}

function bindProactiveUploadDropzone() {
  if (!els.proactiveUploadDropzone || !els.proactiveUploadFile) return;
  els.proactiveUploadFile.addEventListener("change", () => {
    setProactiveUploadFiles(els.proactiveUploadFile.files);
  });
  els.proactiveAttachmentList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-proactive-attachment]");
    if (!removeButton) return;
    removeProactiveUploadFile(Number(removeButton.dataset.removeProactiveAttachment));
  });
  els.proactiveUploadDropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    els.proactiveUploadFile.click();
  });
  ["dragenter", "dragover"].forEach((type) => {
    els.proactiveUploadDropzone.addEventListener(type, (event) => {
      event.preventDefault();
      els.proactiveUploadDropzone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    els.proactiveUploadDropzone.addEventListener(type, () => {
      els.proactiveUploadDropzone.classList.remove("is-dragging");
    });
  });
  els.proactiveUploadDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    setProactiveUploadFiles(event.dataTransfer?.files);
  });
}

async function createProactiveTask(event) {
  event.preventDefault();
  if (state.proactiveSubmitting) return;
  const botId = state.selectedBotId;
  const contextVersion = state.botContextVersion;
  const data = new FormData(els.proactiveForm);
  const localFiles = [...(state.proactiveUploadFiles || [])];
  const content = String(data.get("content") || "").trim();
  const scheduledAt = els.proactiveScheduleEnabled?.checked
    ? validateProactiveScheduledAt(els.proactiveScheduledAt?.value)
    : "";
  const payload = {
    botId,
    title: String(data.get("title") || "").trim(),
    messageType: localFiles.length ? "media" : "text",
    content,
    targets: getSelectedTargets(),
    scheduledAt: scheduledAt || null
  };

  if (!payload.botId) {
    toast("请先选择 Bot");
    return;
  }

  if (!payload.targets.length) {
    toast("请选择目标列表");
    return;
  }
  if (payload.messageType === "text" && !payload.content) {
    toast("请填写文本内容，或上传文件");
    return;
  }

  setProactiveSubmitting(true);
  try {
    if (localFiles.length) {
      toast(`正在上传附件 1/${localFiles.length}...`);
      const uploadedAttachments = [];
      for (const [index, localFile] of localFiles.entries()) {
        if (index > 0) toast(`正在上传附件 ${index + 1}/${localFiles.length}...`);
        const uploaded = await uploadLocalFile(localFile, botId);
        if (!isCurrentBotContext(botId, contextVersion)) return;
        const objectName = uploaded.originalName || uploaded.filename || localFile.name;
        uploadedAttachments.push({
          fileUrl: uploaded.url,
          objectName,
          fileType: detectFileTypeFromName(objectName || localFile.name || uploaded.url)
        });
      }
      payload.messageType = "media";
      payload.attachments = uploadedAttachments;
      payload.fileUrl = uploadedAttachments[0]?.fileUrl || "";
      payload.objectName = uploadedAttachments[0]?.objectName || "";
      payload.fileType = uploadedAttachments[0]?.fileType || "file";
      payload.extraText = content;
    } else {
      const fileUrl = String(data.get("fileUrl") || "").trim();
      if (fileUrl) {
        payload.messageType = "media";
        payload.fileUrl = fileUrl;
        payload.objectName = fileNameFromUrl(fileUrl);
        payload.fileType = detectFileTypeFromName(payload.objectName || fileUrl);
        payload.extraText = content;
      }
    }

    if (payload.messageType === "media" && !payload.attachments?.length && !payload.fileUrl) {
      toast("请上传附件");
      return;
    }

    toast("正在创建并发送...");
    const result = await request("/api/proactive/tasks", {
      method: "POST",
      botId,
      body: JSON.stringify(payload)
    });
    if (!isCurrentBotContext(botId, contextVersion)) return;
    toast(`主动任务已创建：#${result.task.id}`);
    selectedTargets.clear();
    renderSelectedTargets();
    renderTargetList();
    if (els.proactiveTitle) els.proactiveTitle.value = "";
    if (els.proactiveContent) els.proactiveContent.value = "";
    if (els.proactiveFileUrl) els.proactiveFileUrl.value = "";
    if (els.proactiveScheduleEnabled) els.proactiveScheduleEnabled.checked = false;
    if (els.proactiveScheduledAt) els.proactiveScheduledAt.value = "";
    syncProactiveScheduleFields();
    clearProactiveUpload();
    resetProactiveTasksPagination();
    await loadProactiveTasks();
  } finally {
    setProactiveSubmitting(false);
  }
}

function syncMessageTypeFields() {
  const type = els.messageTypeInput?.value || "text";
  els.messageFields.forEach((field) => {
    const active = field.dataset.messageField === type;
    field.hidden = Boolean(els.messageTypeInput) && !active;
    field.querySelectorAll("textarea, input, select").forEach((input) => {
      if (input.name === "content") input.required = false;
      if (input.name === "fileUrl") input.required = false;
    });
  });
}

async function loadProactiveTasks({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) {
    renderProactiveTasks([]);
    return;
  }
  const params = new URLSearchParams();
  params.set("botId", botId);
  params.set("page", String(state.proactiveTasksPagination.page));
  params.set("pageSize", String(state.proactiveTasksPagination.pageSize));
  const dateFrom = dateToLocalIsoStart(els.taskDateFrom.value);
  const dateTo = dateToLocalIsoNextDay(els.taskDateTo.value || els.taskDateFrom.value);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const data = await request(`/api/proactive/tasks?${params.toString()}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  state.proactiveTasksPagination = normalizePagination(data.pagination, state.proactiveTasksPagination);
  renderProactiveTasks(data.tasks || []);
  renderPaginationBar({
    container: els.proactiveTasksPaginationEl,
    pagination: state.proactiveTasksPagination,
    onPage: (page) => {
      state.proactiveTasksPagination.page = page;
      loadProactiveTasks().catch(toastError);
    },
    onPageSize: (pageSize) => {
      state.proactiveTasksPagination.page = 1;
      state.proactiveTasksPagination.pageSize = pageSize;
      loadProactiveTasks().catch(toastError);
    }
  });
}

function renderProactiveTasks(tasks) {
  if (!tasks.length) {
    els.proactiveTasksTable.innerHTML = `<tr class="proactive-task-empty-row"><td class="proactive-task-empty" colspan="6">暂无当前 Bot 的主动推送任务</td></tr>`;
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
      const statusLabel = {
        pending: task.scheduledAt ? "待定时" : "待发送",
        sending: "发送中",
        sent: "已发送",
        partial: "部分失败",
        failed: "失败",
        canceled: "已取消"
      }[task.status] || task.status;
      const statusClass = task.status === "sent"
        ? "ok"
        : ["failed", "partial"].includes(task.status)
          ? "bad"
          : task.status === "canceled" ? "selected" : "off";
      const cancelButton = ["pending", "sending"].includes(task.status)
        ? `<button class="secondary danger proactive-task-cancel" data-proactive-task-cancel="${task.id}" type="button" title="取消任务">${icon("reset")}取消</button>`
        : "";
      const timeLabel = task.scheduledAt
        ? `定时 ${formatDisplayDateTime(task.scheduledAt)}`
        : formatDisplayDateTime(task.updatedAt || task.createdAt);
      return `
        <tr>
          <td class="task-content-cell">
            <small class="message-type-badge">${escapeHtml(typeLabel)}</small>
            <span class="task-content-text" title="${escapeHtml(content)}">${escapeHtml(content)}</span>
          </td>
          <td class="muted">${escapeHtml(botDisplayName(task.botId))}</td>
          <td><span class="pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
          <td>${escapeHtml(progress + failed)}</td>
          <td class="muted">${escapeHtml(timeLabel)}</td>
          <td class="proactive-task-actions"><button class="secondary" data-task="${task.id}" type="button">${icon("info")}详情</button>${cancelButton}</td>
        </tr>
      `;
    })
    .join("");

  els.proactiveTasksTable.querySelectorAll("button[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      const botId = state.selectedBotId;
      const contextVersion = state.botContextVersion;
      const data = await request(`/api/proactive/tasks/${encodeURIComponent(button.dataset.task)}`, { botId });
      if (!isCurrentBotContext(botId, contextVersion)) return;
      els.logsOutput.textContent = JSON.stringify(data, null, 2);
      toast(`已加载任务 #${button.dataset.task}`);
    });
  });
  els.proactiveTasksTable.querySelectorAll("[data-proactive-task-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      const botId = state.selectedBotId;
      const contextVersion = state.botContextVersion;
      button.disabled = true;
      try {
        await request(`/api/proactive/tasks/${encodeURIComponent(button.dataset.proactiveTaskCancel)}/cancel`, {
          method: "POST",
          botId,
          body: JSON.stringify({ reason: "console" })
        });
        if (!isCurrentBotContext(botId, contextVersion)) return;
        toast("主动推送任务已取消");
        await loadProactiveTasks({ contextVersion });
      } finally {
        button.disabled = false;
      }
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

async function loadGroups({ refresh = false } = {}) {
  if (!state.selectedBotId) return;
  const params = new URLSearchParams({
    botId: state.selectedBotId,
    search: String(els.groupSearchInput?.value || ""),
    page: "1",
    pageSize: "100"
  });
  if (refresh) params.set("refresh", "1");
  const data = await request(`/api/groups?${params.toString()}`);
  state.groups = data.items || [];
  renderGroupList();
  if (state.selectedGroupId && state.groups.some((group) => group.id === state.selectedGroupId)) {
    await loadGroupDetail(state.selectedGroupId);
  }
}

function groupDateTagLabel(group) {
  const value = String(group?.groupCreatedAt || group?.createdAt || "").trim();
  const timezoneFree = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/);
  const normalizedValue = timezoneFree
    ? `${timezoneFree[1]}T${timezoneFree[2]}+08:00`
    : value;
  const date = new Date(normalizedValue);
  if (!value || Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}${dateParts.month}${dateParts.day}`;
}

function renderGroupList() {
  if (!els.groupList) return;
  els.groupList.innerHTML = state.groups.length
    ? state.groups.map((group) => `
        <button class="groups-list-item ${group.id === state.selectedGroupId ? "active" : ""}" data-group-id="${escapeHtml(group.id)}" type="button">
          <span class="groups-list-item-main">
            <span class="groups-list-item-icon"><img class="group-asset-icon" src="./assets/group.png" alt="" aria-hidden="true" /></span>
            <span class="groups-list-item-copy">
              <strong>${escapeHtml(group.currentName)}</strong>
            </span>
            <span class="groups-list-date-tag" title="建立日期">
              <svg class="icon" aria-hidden="true"><use href="#icon-calendar"></use></svg>
              ${escapeHtml(groupDateTagLabel(group))}
            </span>
          </span>
        </button>
      `).join("")
    : `<div class="empty-state">暂无群。群回调到达后会自动出现，也可以点击“刷新群列表”。</div>`;
  els.groupList.querySelectorAll("[data-group-id]").forEach((button) => {
    button.addEventListener("click", () => loadGroupDetail(button.dataset.groupId).catch(toastError));
  });
}

async function loadGroupDetail(groupId) {
  const data = await request(
    `/api/groups/${encodeURIComponent(groupId)}?botId=${encodeURIComponent(state.selectedBotId)}`
  );
  state.selectedGroupId = groupId;
  state.selectedGroupDetail = data;
  renderGroupList();
  renderGroupConfig();
}

function groupRoleRow(role = {}) {
  return `
    <div class="groups-role-row" data-role-id="${escapeHtml(role.id || "")}">
      <label class="groups-role-field" data-role-label="成员名称"><input data-role-field="currentName" value="${escapeHtml(role.currentName || "")}" placeholder="成员名称" /></label>
      <label class="groups-role-field" data-role-label="身份"><input data-role-field="identityType" value="${escapeHtml(role.identityType || "")}" placeholder="如客户、同事" /></label>
      <label class="groups-role-field" data-role-label="职责与关系"><input data-role-field="description" value="${escapeHtml(role.description || "")}" placeholder="职责与关系说明" /></label>
      <label class="groups-role-field" data-role-label="回复策略"><select data-role-field="replyPolicy">
          <option value="inherit" ${role.replyPolicy === "inherit" || !role.replyPolicy ? "selected" : ""}>继承群设置</option>
          <option value="always" ${role.replyPolicy === "always" ? "selected" : ""}>始终回复（重要客户）</option>
          <option value="mention_only" ${role.replyPolicy === "mention_only" ? "selected" : ""}>仅 @ 回复</option>
          <option value="never" ${role.replyPolicy === "never" ? "selected" : ""}>从不回复</option>
        </select></label>
      <button class="secondary danger groups-role-delete" data-remove-group-role type="button"><svg class="icon" aria-hidden="true"><use href="#icon-reset"></use></svg>删除</button>
    </div>`;
}

function renderGroupConfig() {
  const detail = state.selectedGroupDetail;
  if (!detail || !els.groupConfigPane) return;
  const { group, roles = [], availableTagGroups = [] } = detail;
  els.groupConfigPane.innerHTML = `
    <div class="section-head groups-config-head">
      <div><h3><img class="group-asset-icon" src="./assets/group.png" alt="" aria-hidden="true" />${escapeHtml(group.currentName)}</h3></div>
    </div>
    <form id="groupConfigForm" class="groups-config-form">
      <label><span class="field-label"><svg class="icon" aria-hidden="true"><use href="#icon-send"></use></svg>群回复方式</span>
        <select name="replyPolicy">
          <option value="always" ${group.replyPolicy === "always" ? "selected" : ""}>始终回复（重要客户群）</option>
          <option value="mention_only" ${group.replyPolicy === "mention_only" ? "selected" : ""}>仅 @ 回复</option>
          <option value="never" ${group.replyPolicy === "never" ? "selected" : ""}>从不回复</option>
        </select>
      </label>
      <div class="expand-field-slot groups-background-slot">
        <label class="groups-background-field"><span class="field-label"><svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>群背景</span><textarea class="expand-on-focus" name="background" rows="1" placeholder="例如：客户购买时间、产品和服务背景">${escapeHtml(group.background || "")}</textarea></label>
      </div>
      <fieldset class="groups-tags-fieldset"><legend><svg class="icon" aria-hidden="true"><use href="#icon-tag"></use></svg>群标签组</legend>
        <label class="groups-tag-card is-system is-selected"><input type="checkbox" checked disabled /><span class="groups-tag-card-icon"><svg class="icon" aria-hidden="true"><use href="#icon-calendar"></use></svg></span><span>建立日期<small>系统默认</small></span><svg class="icon groups-tag-lock" aria-label="不可移除"><use href="#icon-lock"></use></svg></label>
        ${availableTagGroups.map((tagGroup) => `
          <label class="groups-tag-card ${group.tagGroupIds?.includes(tagGroup.id) ? "is-selected" : ""}"><input name="tagGroupIds" type="checkbox" value="${escapeHtml(tagGroup.id)}" ${group.tagGroupIds?.includes(tagGroup.id) ? "checked" : ""} /><span class="groups-tag-card-icon"><svg class="icon" aria-hidden="true"><use href="#icon-tag"></use></svg></span><span>${escapeHtml(tagGroup.name)}</span></label>
        `).join("")}
      </fieldset>
      <button class="primary groups-save-config" type="submit"><svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg>保存群配置</button>
    </form>
    <div class="groups-role-head">
      <h3><svg class="icon" aria-hidden="true"><use href="#icon-user"></use></svg>群角色</h3>
      <div class="groups-role-actions">
        <button id="addGroupRoleButton" class="secondary" type="button"><svg class="icon" aria-hidden="true"><use href="#icon-plus"></use></svg>添加角色</button>
        <button class="primary groups-save-roles" form="groupRolesForm" type="submit"><svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg>保存角色</button>
      </div>
    </div>
    <form id="groupRolesForm" class="groups-roles-form">
      <div class="groups-role-columns" aria-hidden="true">
        <span><svg class="icon"><use href="#icon-user"></use></svg>成员名称</span>
        <span><svg class="icon"><use href="#icon-tag"></use></svg>身份</span>
        <span><svg class="icon"><use href="#icon-info"></use></svg>职责与关系</span>
        <span><svg class="icon"><use href="#icon-send"></use></svg>回复策略</span>
        <span><svg class="icon"><use href="#icon-reset"></use></svg>操作</span>
      </div>
      <div id="groupRoleList" class="groups-role-list">${roles.map(groupRoleRow).join("")}</div>
    </form>
  `;
  els.groupConfigPane.querySelector("#groupConfigForm").addEventListener("submit", saveSelectedGroupConfig);
  els.groupConfigPane.querySelector("#addGroupRoleButton").addEventListener("click", () => {
    els.groupConfigPane.querySelector("#groupRoleList").insertAdjacentHTML("beforeend", groupRoleRow());
    bindGroupRoleRemoveButtons();
  });
  els.groupConfigPane.querySelector("#groupRolesForm").addEventListener("submit", saveSelectedGroupRoles);
  bindGroupRoleRemoveButtons();
}

function bindGroupRoleRemoveButtons() {
  els.groupConfigPane.querySelectorAll("[data-remove-group-role]").forEach((button) => {
    button.onclick = () => button.closest(".groups-role-row").remove();
  });
}

async function saveSelectedGroupConfig(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await request(`/api/groups/${encodeURIComponent(state.selectedGroupId)}/config`, {
    method: "PATCH",
    body: JSON.stringify({
      botId: state.selectedBotId,
      expectedVersion: state.selectedGroupDetail.group.version,
      replyPolicy: form.get("replyPolicy"),
      background: form.get("background"),
      tagGroupIds: form.getAll("tagGroupIds")
    })
  });
  state.selectedGroupDetail.group = data.group;
  toast("群配置已保存", "success");
  await loadGroups();
}

async function saveSelectedGroupRoles(event) {
  event.preventDefault();
  const roles = [...event.currentTarget.querySelectorAll(".groups-role-row")].map((row) => {
    const value = (name) => row.querySelector(`[data-role-field="${name}"]`);
    return {
      ...(row.dataset.roleId ? { id: row.dataset.roleId } : {}),
      currentName: value("currentName").value,
      identityType: value("identityType").value,
      description: value("description").value,
      replyPolicy: value("replyPolicy").value
    };
  });
  const data = await request(`/api/groups/${encodeURIComponent(state.selectedGroupId)}/roles`, {
    method: "PATCH",
    body: JSON.stringify({
      botId: state.selectedBotId,
      expectedVersion: state.selectedGroupDetail.group.version,
      roles
    })
  });
  state.selectedGroupDetail = { ...state.selectedGroupDetail, group: data.group, roles: data.roles };
  renderGroupConfig();
  toast("角色已保存", "success");
}

async function loadCreateGroupContacts() {
  const params = new URLSearchParams({
    botId: state.selectedBotId,
    targetType: "private",
    page: String(state.createGroupContactsPagination.page),
    pageSize: String(state.createGroupContactsPagination.pageSize),
    q: String(els.createGroupContactSearch.value || "")
  });
  const data = await request(`/api/proactive/targets?${params.toString()}`);
  state.createGroupContacts = data.targets || [];
  state.createGroupContactsPagination = normalizePagination(
    data.pagination,
    state.createGroupContactsPagination
  );
  renderCreateGroupContacts();
  renderPaginationBar({
    container: els.createGroupContactPagination,
    pagination: state.createGroupContactsPagination,
    pageSizeOptions: [20],
    onPage: (page) => {
      state.createGroupContactsPagination.page = page;
      loadCreateGroupContacts().catch(toastError);
    }
  });
}

function renderCreateGroupContacts() {
  els.createGroupContactList.innerHTML = state.createGroupContacts.length
    ? `<div class="groups-contact-grid">${state.createGroupContacts.map((target) => {
        const selected = state.createGroupContactIds.has(target.targetName);
        return `
          <button class="groups-contact-card ${selected ? "selected" : ""}" data-create-group-contact="${escapeHtml(target.targetName)}" type="button">
            <img class="target-avatar private" src="${escapeHtml(targetTypeAvatar("private"))}" alt="" aria-hidden="true" />
            <span class="groups-contact-name">${escapeHtml(target.displayName || target.targetName)}</span>
            <span class="groups-contact-checkbox ${selected ? "checked" : ""}" aria-hidden="true">
              <svg class="icon"><use href="#icon-check"></use></svg>
            </span>
          </button>`;
      }).join("")}</div>`
    : `<div class="empty-state">暂无联系人，请先在推送名单中同步联系人。</div>`;
  els.createGroupContactList.querySelectorAll("[data-create-group-contact]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetName = button.dataset.createGroupContact;
      if (state.createGroupContactIds.has(targetName)) state.createGroupContactIds.delete(targetName);
      else state.createGroupContactIds.add(targetName);
      renderCreateGroupContacts();
    });
  });
}

els.saveKeyButton?.addEventListener("click", () => {
  state.apiKey = els.apiKeyInput?.value.trim() || "";
  localStorage.setItem("worktool_console_api_key", state.apiKey);
  toast("管理密钥已保存");
});

els.refreshButton?.addEventListener("click", () => loadBots().catch(toastError));
els.lockBotButton.addEventListener("click", () => lockCurrentBot().catch(toastError));
els.unlockCancelButton.addEventListener("click", closeUnlockDialog);
els.unlockDialog.addEventListener("click", (event) => {
  if (event.target === els.unlockDialog) closeUnlockDialog();
});
els.unlockKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    acceptUnlockDialog().catch(toastError);
  }
});
els.unlockAcceptButton.addEventListener("click", () =>
  acceptUnlockDialog().catch(toastError)
);
els.botForm.addEventListener("submit", (event) => saveBot(event).catch(toastError));
els.botAccessKeyForm?.addEventListener("submit", (event) =>
  saveBotAccessKey(event).catch(toastError)
);
els.cockpitConfigForm?.addEventListener("submit", (event) =>
  saveCockpitConfig(event).catch(toastError)
);
els.generateCockpitReportButton?.addEventListener("click", () =>
  generateCockpitReport().catch(toastError)
);
els.replyWaitForm?.addEventListener("submit", (event) =>
  saveReplyWait(event).catch(toastError)
);
els.tagSyncForm?.addEventListener("submit", (event) =>
  saveTagSyncConfig(event).catch(toastError)
);
els.tagSyncNightlyEnabled?.addEventListener("change", syncTagSyncScheduleFields);
els.tagSyncWindowStart?.addEventListener("change", syncTagSyncEndOptions);
els.tagSyncRunButton?.addEventListener("click", () => runTagSyncNow().catch(toastError));
els.flowMachineForm.addEventListener("submit", (event) =>
  saveFlowMachine(event).catch(toastError)
);
els.addFlowNodeButton.addEventListener("click", addFlowNode);
els.applyFlowJsonButton.addEventListener("click", () => els.importFlowFile?.click());
els.importFlowFile?.addEventListener("change", () =>
  importFlowConfigFile(els.importFlowFile.files?.[0])
    .finally(() => {
      if (els.importFlowFile) els.importFlowFile.value = "";
    })
    .catch(toastError)
);
els.flowMachineForm.entryNodeId.addEventListener("change", syncFlowJsonTextarea);
els.flowMachineForm.generalRule?.addEventListener("input", syncFlowJsonTextarea);
els.loadDefaultFlowButton.addEventListener("click", () =>
  loadDefaultFlowMachine().catch(toastError)
);
els.exportFlowButton.addEventListener("click", exportFlowMachine);
els.tagAlertCenter?.addEventListener("mouseenter", () => setTagAlertInteraction(true));
els.tagAlertCenter?.addEventListener("mouseleave", () => setTagAlertInteraction(false));
els.tagAlertCenter?.addEventListener("focusin", () => setTagAlertInteraction(true));
els.tagAlertCenter?.addEventListener("focusout", (event) => {
  if (!els.tagAlertCenter.contains(event.relatedTarget)) setTagAlertInteraction(false);
});
els.tagAlertButton?.addEventListener("click", () => {
  setTagAlertInteraction(true);
});
els.tagAlertList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-tag-alert-id]");
  if (!item) return;
  const alert = currentTagAlerts.find(
    (candidate) => String(candidate.id) === String(item.dataset.tagAlertId)
  );
  if (alert) openTagAlert(alert).catch(toastError);
});
document.addEventListener("pointerdown", () => {
  tagAlertClient.unlockAudio().catch(() => {});
}, { once: true, capture: true });
els.refreshFlowSessionsButton.addEventListener("click", () =>
  Promise.all([loadFlowMachine(), loadFlowSessions()]).catch(toastError)
);
els.flowSessionTypeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const previousType = currentFlowSessionTypeFilter();
    setFlowSessionTypeSelection(button.dataset.flowSessionType);
    if (previousType !== currentFlowSessionTypeFilter()) clearSelectedFlowConversation();
    reloadFlowSessionsFromFirstPage().catch(toastError);
  });
});
[
  els.flowSessionNodeFilter,
  els.flowSessionTagFilter
].forEach((control) => {
  control?.addEventListener("change", () =>
    reloadFlowSessionsFromFirstPage().catch(toastError)
  );
});
els.flowSessionTagFilterButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleTagMultiSelectMenu(els.flowSessionTagFilterButton, els.flowSessionTagFilterMenu);
});
els.flowSessionTagFilterMenu?.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  if (checkbox.value === "all") {
    setFlowSessionTagFilterValues([]);
    return;
  }
  const values = [...els.flowSessionTagFilterMenu.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value)
    .filter((value) => value !== "all");
  setFlowSessionTagFilterValues(values);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".selected-targets-summary")) {
    closeSelectedTargetsPopover();
  }
  if (event.target.closest(".flow-session-tag-menu")) return;
  if (event.target.closest(".tag-multi-select")) return;
  hideFlowSessionManualTagMenu();
  closeTagMultiSelectMenu(els.flowSessionTagFilterButton, els.flowSessionTagFilterMenu);
  closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
});
window.addEventListener("resize", () => {
  closeTagMultiSelectMenu(els.flowSessionTagFilterButton, els.flowSessionTagFilterMenu);
  closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
});
function closeTagMultiSelectMenusOnExternalScroll(event) {
  if (
    event.target instanceof Element &&
    event.target.closest(".tag-multi-select-menu")
  ) {
    return;
  }
  closeTagMultiSelectMenu(els.flowSessionTagFilterButton, els.flowSessionTagFilterMenu);
  closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
}
window.addEventListener("scroll", closeTagMultiSelectMenusOnExternalScroll, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSelectedTargetsPopover();
    hideFlowSessionManualTagMenu();
    closeTagMultiSelectMenu(els.flowSessionTagFilterButton, els.flowSessionTagFilterMenu);
    closeTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
  }
});
els.flowSessionDateTagFilter?.addEventListener("input", () => {
  normalizeFlowSessionDateTagFilter();
  reloadFlowSessionsFromFirstPage().catch(toastError);
});
els.flowSessionDateTagFilter?.addEventListener("change", () => {
  normalizeFlowSessionDateTagFilter();
  reloadFlowSessionsFromFirstPage().catch(toastError);
});
els.flowSessionSearchInput.addEventListener("input", () =>
  reloadFlowSessionsFromFirstPage().catch(toastError)
);
els.addTagGroupButton?.addEventListener("click", addTagGroup);
els.saveTagsButton?.addEventListener("click", () => saveTagSchema().catch(toastError));
els.exportTagsButton?.addEventListener("click", exportTagSchema);
els.importTagsButton?.addEventListener("click", () => els.importTagsFile?.click());
els.importTagsFile?.addEventListener("change", () =>
  importTagSchemaFile(els.importTagsFile.files?.[0])
    .catch(toastError)
    .finally(() => {
      if (els.importTagsFile) els.importTagsFile.value = "";
    })
);
els.resetConversationButton.addEventListener("click", openConfirmDialog);
els.confirmCancelButton.addEventListener("click", () => settleConfirmation(false));
els.confirmDialog.addEventListener("click", (event) => {
  if (event.target === els.confirmDialog) settleConfirmation(false);
});
els.confirmAcceptButton.addEventListener("click", () => settleConfirmation(true));
els.assetsButton.addEventListener("click", toggleAssetsPanel);
els.manualReplyComposer.addEventListener("submit", (event) =>
  sendManualReply(event).catch(toastError)
);
els.proactiveForm.addEventListener("submit", (event) =>
  createProactiveTask(event).catch(toastError)
);
bindProactiveUploadDropzone();
renderProactiveAttachments();
els.messageTypeInput?.addEventListener("change", syncMessageTypeFields);
els.taskDateFrom.addEventListener("change", () =>
  reloadProactiveTasksFromFirstPage().catch(toastError)
);
els.taskDateTo.addEventListener("change", () =>
  reloadProactiveTasksFromFirstPage().catch(toastError)
);
els.targetSearchInput.addEventListener("input", scheduleProactiveTargetSearch);
els.targetTagSelectButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleTagMultiSelectMenu(els.targetTagSelectButton, els.targetTagSelectMenu);
});
els.targetTagSelectMenu?.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  runProactiveFilterAction(() => toggleProactiveTagSelection(checkbox.value)).catch(toastError);
});
els.targetDateTagSelect?.addEventListener("change", () =>
  runProactiveFilterAction(syncProactiveDateTagSelection).catch(toastError)
);
els.selectedTargetsSummaryButton?.addEventListener("click", toggleSelectedTargetsPopover);
els.selectedTargetsMoreButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSelectedTargetsPopover();
});
els.loadTargetsButton.addEventListener("click", () =>
  runProactiveFilterAction(() => reloadProactiveTargetsFromFirstPage()).catch(toastError)
);
els.selectPrivateTargetsButton.addEventListener("click", () =>
  runProactiveFilterAction(() => selectTargetsByTypeAcrossPages("private")).catch(toastError)
);
els.selectGroupTargetsButton.addEventListener("click", () =>
  runProactiveFilterAction(() => selectTargetsByTypeAcrossPages("group")).catch(toastError)
);
els.clearTargetsButton.addEventListener("click", () =>
  runProactiveFilterAction(async () => clearSelectedTargets()).catch(toastError)
);
els.proactiveScheduleEnabled?.addEventListener("change", syncProactiveScheduleFields);
document.querySelectorAll("[data-target-filter]").forEach((button) => {
  button.addEventListener("click", () =>
    runProactiveFilterAction(async () => {
      targetFilter = button.dataset.targetFilter;
      document.querySelectorAll("[data-target-filter]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      await reloadProactiveTargetsFromFirstPage();
    }).catch(toastError)
  );
});
els.workspaceTabs.forEach((button) => {
  button.addEventListener("click", () => switchWorkspaceTab(button.dataset.workspaceTab));
});
els.refreshGroupsButton?.addEventListener("click", () => loadGroups({ refresh: true }).catch(toastError));
els.groupSearchInput?.addEventListener("input", () => loadGroups().catch(toastError));
els.createGroupButton?.addEventListener("click", () => {
  state.createGroupContactIds.clear();
  state.createGroupContactsPagination.page = 1;
  els.createGroupForm.reset();
  els.createGroupDialog.hidden = false;
  loadCreateGroupContacts().catch(toastError);
});
els.createGroupCancelButton?.addEventListener("click", () => {
  els.createGroupDialog.hidden = true;
});
els.createGroupContactSearch?.addEventListener("input", () => {
  state.createGroupContactsPagination.page = 1;
  loadCreateGroupContacts().catch(toastError);
});
els.createGroupForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  request("/api/groups/create", {
    method: "POST",
    body: JSON.stringify({
      botId: state.selectedBotId,
      groupName: form.get("groupName"),
      announcement: form.get("announcement"),
      selectList: [...state.createGroupContactIds]
    })
  }).then(async () => {
    els.createGroupDialog.hidden = true;
    toast("建群命令已提交", "success");
    await loadGroups();
  }).catch(toastError);
});
els.refreshProactiveButton.addEventListener("click", () =>
  loadProactiveTasks().catch(toastError)
);
els.resetFormButton.addEventListener("click", () => {
  resetBotContext();
});
els.loadLogsButton.addEventListener("click", () => loadLogs().catch(toastError));
els.collapseButtons.forEach((button) => {
  const panel = document.querySelector(`#${button.dataset.collapseTarget}`);
  button.setAttribute("aria-expanded", "true");
  button.addEventListener("click", () => {
    updateCollapsiblePanelVisual(panel, !panel?.classList.contains("is-collapsed"));
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && actionToolboxOpen) {
    closeActionToolbox();
  }
});

async function startConsole() {
  await window.WorkspaceContext.ready;
  initializeTagSyncTimeOptions();
  syncTagSyncScheduleFields();
  ensureActionToolbox();
  syncFlowSessionTypeUi();
  syncRoleVisibility();
  await loadBots();
  await openDirectBotFromUrl();
  syncMessageTypeFields();
  syncProactiveScheduleFields();
}

startConsole().catch((error) => {
  els.logsOutput.textContent = `无法加载配置：${error.message}`;
});
