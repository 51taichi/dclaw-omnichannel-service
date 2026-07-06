const state = {
  apiKey: localStorage.getItem("worktool_console_api_key") || ""
};

const els = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  refreshButton: document.querySelector("#refreshButton"),
  botForm: document.querySelector("#botForm"),
  debugReplyForm: document.querySelector("#debugReplyForm"),
  proactiveForm: document.querySelector("#proactiveForm"),
  refreshProactiveButton: document.querySelector("#refreshProactiveButton"),
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
  renderBotOptions(bots);
  els.botsTable.innerHTML = bots
    .map((bot) => {
      const safeBot = encodeURIComponent(bot.botId);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(bot.botName || bot.botId)}</strong>
            <div class="muted">${escapeHtml(bot.botId)}</div>
          </td>
          <td>
            <strong>${escapeHtml(bot.agentName || bot.agentId)}</strong>
            <div class="muted">${escapeHtml(bot.agentId)}</div>
            <div class="muted">Public ID: ${escapeHtml(bot.dclawPublicId || "")}</div>
            <div class="muted">Base URL: ${escapeHtml(bot.dclawBaseUrl || "")}</div>
          </td>
          <td><span class="pill ${bot.enabled ? "ok" : "off"}">${bot.enabled ? "启用" : "停用"}</span></td>
          <td class="muted">${escapeHtml(bot.updatedAt || "")}</td>
          <td>
            <div class="row-actions">
              <button class="secondary" data-action="edit" data-bot="${safeBot}" type="button">编辑</button>
              <button class="secondary" data-action="bind-message" data-bot="${safeBot}" type="button">绑定消息</button>
              <button class="secondary" data-action="bind-command" data-bot="${safeBot}" type="button">绑定回调</button>
            </div>
          </td>
        </tr>
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
      const label = bot.botName ? `${bot.botName} (${bot.botId})` : bot.botId;
      return `<option value="${escapeHtml(bot.botId)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (current) select.value = current;
}

let currentBots = [];

async function loadBots() {
  const data = await request("/api/bots");
  currentBots = data.bots || [];
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

function parseTargets(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(private|group)\s*[:：]\s*(.+)$/i);
      if (match) {
        return {
          targetType: match[1].toLowerCase() === "group" ? "group" : "private",
          targetName: match[2].trim()
        };
      }
      return {
        targetType: "private",
        targetName: line
      };
    })
    .filter((target) => target.targetName);
}

async function createProactiveTask(event) {
  event.preventDefault();
  const data = new FormData(els.proactiveForm);
  const payload = {
    botId: String(data.get("botId") || "").trim(),
    title: String(data.get("title") || "").trim(),
    content: String(data.get("content") || "").trim(),
    targets: parseTargets(data.get("targets"))
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
          <td><button class="secondary" data-task="${task.id}" type="button">详情</button></td>
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
els.refreshProactiveButton.addEventListener("click", () =>
  loadProactiveTasks().catch((error) => toast(error.message))
);
els.resetFormButton.addEventListener("click", () => els.botForm.reset());
els.loadLogsButton.addEventListener("click", () => loadLogs().catch((error) => toast(error.message)));

Promise.all([loadBots(), loadDebugReply(), loadProactiveTasks()]).catch((error) => {
  els.logsOutput.textContent = `无法加载配置：${error.message}`;
});
