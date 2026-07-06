const state = {
  apiKey: localStorage.getItem("worktool_console_api_key") || "",
  selectedBotId: ""
};

const els = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  refreshButton: document.querySelector("#refreshButton"),
  botBindingPanel: document.querySelector("#botBindingPanel"),
  bindingState: document.querySelector("#bindingState"),
  botForm: document.querySelector("#botForm"),
  debugReplyForm: document.querySelector("#debugReplyForm"),
  proactiveForm: document.querySelector("#proactiveForm"),
  refreshProactiveButton: document.querySelector("#refreshProactiveButton"),
  loadTargetsButton: document.querySelector("#loadTargetsButton"),
  seedTargetsButton: document.querySelector("#seedTargetsButton"),
  selectPrivateTargetsButton: document.querySelector("#selectPrivateTargetsButton"),
  selectGroupTargetsButton: document.querySelector("#selectGroupTargetsButton"),
  clearTargetsButton: document.querySelector("#clearTargetsButton"),
  targetSearchInput: document.querySelector("#targetSearchInput"),
  targetList: document.querySelector("#targetList"),
  selectedTargets: document.querySelector("#selectedTargets"),
  selectedTargetCount: document.querySelector("#selectedTargetCount"),
  resetFormButton: document.querySelector("#resetFormButton"),
  botsTable: document.querySelector("#botsTable"),
  botCount: document.querySelector("#botCount"),
  proactiveTasksTable: document.querySelector("#proactiveTasksTable"),
  logType: document.querySelector("#logType"),
  loadLogsButton: document.querySelector("#loadLogsButton"),
  logsOutput: document.querySelector("#logsOutput"),
  toast: document.querySelector("#toast")
};

els.apiKeyInput.value = state.apiKey;

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    "x-api-key": state.apiKey,
    ...extra
  };
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

function setBindingState(bot = null) {
  state.selectedBotId = bot?.botId || "";
  const accent = bot ? getBotAccent(bot) : "";
  els.botBindingPanel.classList.toggle("is-bound", Boolean(bot));
  els.botBindingPanel.style.setProperty("--bot-accent", accent);
  els.bindingState.textContent = bot
    ? `编辑中：${bot.botName || bot.dclawPublicId || "当前 Bot"}`
    : "新增模式";
  renderBots(currentBots);
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
  setBindingState(bot);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderBots(bots) {
  els.botCount.textContent = `${bots.length} 个`;
  renderBotOptions(bots);
  if (!bots.length) {
    els.botsTable.innerHTML = `<div class="empty-state">暂无 Bot 绑定</div>`;
    return;
  }

  els.botsTable.innerHTML = bots
    .map((bot) => {
      const safeBot = encodeURIComponent(bot.botId);
      const title = bot.botName || bot.dclawPublicId || "未命名 Bot";
      const isSelected = bot.botId === state.selectedBotId;
      const accent = getBotAccent(bot);
      return `
        <article class="bot-card ${bot.enabled ? "is-online" : "is-offline"} ${isSelected ? "is-selected" : ""}" style="--bot-accent: ${escapeHtml(accent)}">
          <button class="bot-main" data-action="edit" data-bot="${safeBot}" type="button">
            <img class="bot-avatar" src="./assets/bot-avatar.png" alt="" aria-hidden="true" />
            <span class="bot-summary">
              <span class="bot-title-row">
                <strong>${escapeHtml(title)}</strong>
                <span class="pill ${isSelected ? "selected" : bot.enabled ? "ok" : "off"}">${isSelected ? "编辑中" : bot.enabled ? "在线" : "停用"}</span>
              </span>
              <span class="bot-agent">${escapeHtml(bot.agentName || bot.agentId || "未绑定 Agent")}</span>
            </span>
          </button>
          <div class="bot-meta">
            <span>Public ID: ${escapeHtml(bot.dclawPublicId || "")}</span>
            <span>更新: ${escapeHtml(bot.updatedAt || "-")}</span>
          </div>
          <div class="row-actions bot-actions">
            <button class="secondary" data-action="bind-message" data-bot="${safeBot}" type="button">${icon("link")}消息</button>
            <button class="secondary" data-action="bind-command" data-bot="${safeBot}" type="button">${icon("terminal")}回调</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.botsTable.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const botId = decodeURIComponent(button.dataset.bot);
      const bot = currentBots.find((item) => item.botId === botId);
      if (button.dataset.action === "edit") {
        fillForm(bot);
        return;
      }
      if (button.dataset.action === "bind-message") {
        await bindCallback(botId, "message-callback");
      }
      if (button.dataset.action === "bind-command") {
        await bindCallback(botId, "command-callback");
      }
    });
  });
}

function renderBotOptions(bots) {
  const select = els.proactiveForm.botId;
  const current = select.value;
  select.innerHTML = bots
    .map((bot) => {
      const label = bot.botName || bot.dclawPublicId || bot.agentName || "未命名 Bot";
      return `<option value="${escapeHtml(bot.botId)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (current) select.value = current;
}

let currentBots = [];
let targetFilter = "all";
let addressBookTargets = [];
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
  els.selectedTargetCount.textContent = `已选 ${targets.length} 个`;
  els.selectedTargets.innerHTML = targets.length
    ? targets
        .map((target) => {
          const key = escapeHtml(targetKey(target));
          return `
            <button class="target-chip" data-remove-target="${key}" type="button">
              <span>${escapeHtml(target.displayName || target.targetName)}</span>
              <small>${escapeHtml(targetTypeLabel(target.targetType))}</small>
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
                <small>${escapeHtml(targetTypeLabel(target.targetType))} · ${escapeHtml(target.source || "unknown")}</small>
              </span>
              <span class="target-check">${checked ? "已选" : "选择"}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-targets">暂无目标，可以添加示例目标或等待客户/群聊产生回调后自动沉淀。</div>`;

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
  const botId = els.proactiveForm.botId.value;
  if (!botId) return;
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

async function seedAddressBookTargets() {
  const botId = els.proactiveForm.botId.value;
  if (!botId) {
    toast("请先选择 Bot");
    return;
  }
  await request("/api/proactive/targets/mock", {
    method: "POST",
    body: JSON.stringify({ botId })
  });
  toast("示例目标已添加");
  await loadAddressBookTargets();
}

async function loadBots() {
  const data = await request("/api/bots");
  currentBots = data.bots || [];
  if (state.selectedBotId && !currentBots.some((bot) => bot.botId === state.selectedBotId)) {
    setBindingState(null);
    return;
  }
  renderBots(currentBots);
}

async function loadDebugReply() {
  const data = await request("/api/settings/debug-reply");
  const config = data.config || {};
  els.debugReplyForm.enabled.checked = Boolean(config.enabled);
  els.debugReplyForm.trigger.value = config.trigger || "ping";
  els.debugReplyForm.reply.value = config.reply || "pong";
}

async function saveBot(event) {
  event.preventDefault();
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
  await loadBots();
  const savedBot = currentBots.find((item) => item.botId === bot.botId);
  if (savedBot) setBindingState(savedBot);
}

async function bindCallback(botId, type) {
  await request(`/api/config/${encodeURIComponent(botId)}/${type}`, {
    method: "POST",
    body: JSON.stringify({})
  });
  toast(type === "message-callback" ? "消息回调已绑定" : "指令回调已绑定");
}

async function loadLogs() {
  const type = els.logType.value;
  const data = await request(`/api/logs/${encodeURIComponent(type)}?limit=40`);
  els.logsOutput.textContent = JSON.stringify(data.logs || [], null, 2);
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
  const payload = {
    botId: String(data.get("botId") || "").trim(),
    title: String(data.get("title") || "").trim(),
    content: String(data.get("content") || "").trim(),
    targets: getSelectedTargets()
  };

  if (!payload.botId || !payload.content || !payload.targets.length) {
    toast("请填写 Bot、目标列表和推送内容");
    return;
  }

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
  await loadProactiveTasks();
}

async function loadProactiveTasks() {
  const data = await request("/api/proactive/tasks?limit=20");
  renderProactiveTasks(data.tasks || []);
}

function renderProactiveTasks(tasks) {
  els.proactiveTasksTable.innerHTML = tasks
    .map((task) => {
      const progress = `${task.sentCount || 0}/${task.totalCount || 0}`;
      const failed = task.failedCount ? `，失败 ${task.failedCount}` : "";
      return `
        <tr>
          <td>
            <strong>#${task.id} ${escapeHtml(task.title || "主动推送")}</strong>
            <div class="muted">${escapeHtml(task.content || "").slice(0, 80)}</div>
          </td>
          <td class="muted">${escapeHtml(task.botId)}</td>
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

els.saveKeyButton.addEventListener("click", () => {
  state.apiKey = els.apiKeyInput.value.trim();
  localStorage.setItem("worktool_console_api_key", state.apiKey);
  toast("管理密钥已保存");
});

els.refreshButton.addEventListener("click", () => loadBots().catch((error) => toast(error.message)));
els.botForm.addEventListener("submit", (event) => saveBot(event).catch((error) => toast(error.message)));
els.debugReplyForm.addEventListener("submit", (event) =>
  saveDebugReply(event).catch((error) => toast(error.message))
);
els.proactiveForm.addEventListener("submit", (event) =>
  createProactiveTask(event).catch((error) => toast(error.message))
);
els.proactiveForm.botId.addEventListener("change", () =>
  loadAddressBookTargets().catch((error) => toast(error.message))
);
els.targetSearchInput.addEventListener("input", () => renderTargetList());
els.loadTargetsButton.addEventListener("click", () =>
  loadAddressBookTargets().catch((error) => toast(error.message))
);
els.seedTargetsButton.addEventListener("click", () =>
  seedAddressBookTargets().catch((error) => toast(error.message))
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
els.refreshProactiveButton.addEventListener("click", () =>
  loadProactiveTasks().catch((error) => toast(error.message))
);
els.resetFormButton.addEventListener("click", () => {
  els.botForm.reset();
  els.botForm.enabled.checked = true;
  setBindingState(null);
});
els.loadLogsButton.addEventListener("click", () => loadLogs().catch((error) => toast(error.message)));

Promise.all([loadBots(), loadDebugReply(), loadProactiveTasks()])
  .then(() => loadAddressBookTargets())
  .catch((error) => {
    els.logsOutput.textContent = `无法加载配置：${error.message}`;
  });
