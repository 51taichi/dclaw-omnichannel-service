const ADMIN_SESSION_KEY = "worktool_admin_session";
const WORKSPACE_SESSION_KEY = "worktool_workspace_sessions";

const state = {
  session: readJson(ADMIN_SESSION_KEY),
  workspaces: [],
  workspaceDetails: new Map(),
  selectedWorkspaceId: 0,
  bots: [],
  agents: [],
  selectedBotIds: new Set(),
  assignmentBots: []
};

const els = {
  authRoot: document.querySelector("#adminAuthRoot"),
  shell: document.querySelector("#adminShell"),
  tabs: document.querySelectorAll("[data-admin-tab]"),
  panels: document.querySelectorAll("[data-admin-panel]"),
  logout: document.querySelector("#adminLogoutButton"),
  workspaceList: document.querySelector("#workspaceList"),
  workspaceForm: document.querySelector("#workspaceForm"),
  workspaceBots: document.querySelector("#workspaceBots"),
  newWorkspace: document.querySelector("#newWorkspaceButton"),
  openWorkspace: document.querySelector("#openWorkspaceButton"),
  deleteWorkspace: document.querySelector("#deleteWorkspaceButton"),
  assignBots: document.querySelector("#assignBotsButton"),
  botForm: document.querySelector("#botForm"),
  botList: document.querySelector("#botList"),
  agentForm: document.querySelector("#agentForm"),
  agentList: document.querySelector("#agentList"),
  passwordForm: document.querySelector("#adminPasswordForm"),
  assignmentModal: document.querySelector("#assignmentModal"),
  assignmentSearch: document.querySelector("#assignmentSearch"),
  assignmentBotList: document.querySelector("#assignmentBotList"),
  assignmentCancel: document.querySelector("#assignmentCancelButton"),
  assignmentConfirm: document.querySelector("#assignmentConfirmButton"),
  toast: document.querySelector("#adminToast")
};

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function saveAdminSession(session) {
  state.session = session;
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

function clearAdminSession() {
  state.session = null;
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function adminIcon(name) {
  return `<svg aria-hidden="true"><use href="#admin-icon-${name}"></use></svg>`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.token
        ? { "x-admin-session-token": state.session.token }
        : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && path !== "/api/admin/login") {
    clearAdminSession();
    showAdminLogin();
  }
  return parseResponse(response);
}

function showAdminLogin(message = "") {
  els.shell.hidden = true;
  els.authRoot.hidden = false;
  const controller = AuthShell.mount({
    root: els.authRoot,
    title: "管理员登录",
    prompt: message,
    accountLabel: "admin",
    fieldLabel: "密码",
    fieldIconId: "admin-icon-key",
    inputType: "password",
    submitLabel: "进入管理后台",
    submitIconId: "admin-icon-login",
    async onSubmit(password, shell) {
      try {
        const data = await adminRequest("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password })
        });
        saveAdminSession(data.session);
        shell.showSuccess({
          message: "验证成功",
          seconds: 3,
          onComplete: () => showAdminConsole()
        });
      } catch (error) {
        shell.setFailure(error.status === 401 ? "管理员密码不正确" : error.message);
      }
    }
  });
  controller.focus();
}

async function showAdminConsole() {
  els.authRoot.hidden = true;
  els.shell.hidden = false;
  await loadGlobalData();
}

function selectTab(name) {
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.adminTab === name));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.adminPanel === name));
}

async function loadGlobalData() {
  const [workspaceData, botData, agentData] = await Promise.all([
    adminRequest("/api/admin/workspaces"),
    adminRequest("/api/bots"),
    adminRequest("/api/agents")
  ]);
  state.workspaces = workspaceData.workspaces || [];
  state.bots = botData.bots || [];
  state.agents = agentData.agents || [];
  state.workspaceDetails.clear();
  await Promise.all(state.workspaces.map(async (workspace) => {
    const detail = await adminRequest(`/api/admin/workspaces/${workspace.id}`);
    state.workspaceDetails.set(workspace.id, detail);
  }));
  renderWorkspaceList();
  renderBotList();
  renderAgentList();
  renderAgentOptions();
  if (state.selectedWorkspaceId) await selectWorkspace(state.selectedWorkspaceId);
}

function renderWorkspaceList() {
  if (!state.workspaces.length) {
    els.workspaceList.innerHTML = `<p class="muted">暂无工作区</p>`;
    resetWorkspaceForm();
    return;
  }
  els.workspaceList.innerHTML = state.workspaces.map((workspace) => `
    <button type="button" data-workspace-id="${workspace.id}" class="${workspace.id === state.selectedWorkspaceId ? "active" : ""}">
      ${adminIcon("grid")}
      <span class="admin-item-main">
        <strong>${escapeHtml(workspace.name)}</strong>
        <small>${escapeHtml(workspace.slug)} · ${workspace.enabled ? "启用" : "停用"} · ${workspace.botCount || 0} Bots</small>
      </span>
    </button>
  `).join("");
  els.workspaceList.querySelectorAll("[data-workspace-id]").forEach((button) => {
    button.addEventListener("click", () => selectWorkspace(Number(button.dataset.workspaceId)));
  });
  if (!state.selectedWorkspaceId) {
    selectWorkspace(state.workspaces[0].id);
  }
}

async function selectWorkspace(id) {
  state.selectedWorkspaceId = Number(id);
  let detail = state.workspaceDetails.get(state.selectedWorkspaceId);
  if (!detail) {
    detail = await adminRequest(`/api/admin/workspaces/${state.selectedWorkspaceId}`);
    state.workspaceDetails.set(state.selectedWorkspaceId, detail);
  }
  const workspace = detail.workspace;
  els.workspaceForm.id.value = workspace.id;
  els.workspaceForm.name.value = workspace.name;
  els.workspaceForm.slug.value = workspace.slug;
  els.workspaceForm.challengeText.value = workspace.challengeText;
  els.workspaceForm.response.value = "";
  els.workspaceForm.enabled.checked = workspace.enabled;
  renderWorkspaceBots(detail.bots || []);
  renderWorkspaceList();
}

function resetWorkspaceForm() {
  state.selectedWorkspaceId = 0;
  els.workspaceForm.reset();
  els.workspaceForm.id.value = "";
  els.workspaceForm.enabled.checked = true;
  els.workspaceBots.innerHTML = `<p class="muted">保存后可分配 Bot</p>`;
}

function workspaceNameForBot(botId) {
  for (const detail of state.workspaceDetails.values()) {
    if (detail.bots?.some((bot) => bot.botId === botId)) return detail.workspace;
  }
  return null;
}

function renderWorkspaceBots(bots) {
  if (!bots.length) {
    els.workspaceBots.innerHTML = `<p class="muted">暂无已分配 Bot</p>`;
    return;
  }
  els.workspaceBots.innerHTML = bots.map((bot) => `
    <article class="admin-item">
      <div class="admin-item-main">
        <strong>${escapeHtml(bot.botName || bot.botId)}</strong>
        <small>${escapeHtml(bot.botId)} · ${escapeHtml(bot.agentName || bot.agentId)}</small>
      </div>
      <div class="admin-actions">
        <button class="secondary" data-open-bot="${escapeHtml(bot.botId)}">${adminIcon("open")}打开</button>
        <button class="secondary" data-transfer-bot="${escapeHtml(bot.botId)}">${adminIcon("transfer")}转移</button>
        <button class="danger" data-remove-bot="${escapeHtml(bot.botId)}">${adminIcon("unlink")}移除</button>
      </div>
    </article>
  `).join("");
  els.workspaceBots.querySelectorAll("[data-open-bot]").forEach((button) => {
    button.addEventListener("click", () => openWorkspace(button.dataset.openBot));
  });
  els.workspaceBots.querySelectorAll("[data-remove-bot]").forEach((button) => {
    button.addEventListener("click", () => removeBot(button.dataset.removeBot));
  });
  els.workspaceBots.querySelectorAll("[data-transfer-bot]").forEach((button) => {
    button.addEventListener("click", () => transferBot(button.dataset.transferBot));
  });
}

async function saveWorkspace(event) {
  event.preventDefault();
  const form = new FormData(els.workspaceForm);
  const id = Number(form.get("id") || 0);
  const body = {
    name: form.get("name"),
    slug: form.get("slug"),
    challengeText: form.get("challengeText"),
    enabled: form.get("enabled") === "on"
  };
  if (form.get("response")) body.response = form.get("response");
  if (!id && !body.response) throw new Error("新建工作区需要填写下半句口令");
  const data = await adminRequest(id ? `/api/admin/workspaces/${id}` : "/api/admin/workspaces", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  state.selectedWorkspaceId = data.workspace.id;
  await loadGlobalData();
  toast("工作区已保存");
}

async function deleteWorkspace() {
  const detail = state.workspaceDetails.get(state.selectedWorkspaceId);
  if (!detail) return;
  if (!confirm(`删除工作区？将解除 ${detail.bots?.length || 0} 个 Bot 的分配，但不会删除 Bot 和业务数据。`)) return;
  await adminRequest(`/api/admin/workspaces/${state.selectedWorkspaceId}`, { method: "DELETE" });
  state.selectedWorkspaceId = 0;
  await loadGlobalData();
  toast("工作区已删除");
}

async function openWorkspace(botId = "") {
  const detail = state.workspaceDetails.get(state.selectedWorkspaceId);
  if (!detail) return;
  const workspaceTab = window.open("about:blank", "_blank");
  if (!workspaceTab) {
    throw new Error("浏览器阻止了新页签，请允许弹出窗口后重试");
  }
  workspaceTab.opener = null;

  try {
    const data = await adminRequest(`/api/admin/workspaces/${state.selectedWorkspaceId}/session`, {
      method: "POST"
    });
    const sessions = readJson(WORKSPACE_SESSION_KEY) || {};
    sessions[detail.workspace.slug] = {
      token: data.session.token,
      expiresAt: data.session.expiresAt
    };
    localStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(sessions));
    const suffix = botId ? `?bot=${encodeURIComponent(botId)}` : "";
    const targetUrl = `/console/${encodeURIComponent(detail.workspace.slug)}${suffix}`;
    workspaceTab.location.replace(targetUrl);
  } catch (error) {
    workspaceTab.close();
    throw error;
  }
}

async function openAssignmentModal() {
  if (!state.selectedWorkspaceId) return;
  const data = await adminRequest("/api/admin/workspaces/unassigned-bots");
  state.assignmentBots = data.bots || [];
  state.selectedBotIds = new Set();
  els.assignmentSearch.value = "";
  renderAssignmentBots();
  els.assignmentModal.hidden = false;
}

function renderAssignmentBots() {
  const query = els.assignmentSearch.value.trim().toLowerCase();
  const bots = state.assignmentBots.filter((bot) =>
    `${bot.botId} ${bot.botName}`.toLowerCase().includes(query)
  );
  els.assignmentBotList.innerHTML = bots.length ? bots.map((bot) => `
    <label class="admin-item">
      ${adminIcon("bot")}
      <span class="admin-item-main"><strong>${escapeHtml(bot.botName || bot.botId)}</strong><small>${escapeHtml(bot.botId)}</small></span>
      <input type="checkbox" value="${escapeHtml(bot.botId)}" ${state.selectedBotIds.has(bot.botId) ? "checked" : ""} />
    </label>
  `).join("") : `<p class="muted">暂无可分配 Bot</p>`;
  els.assignmentBotList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedBotIds.add(input.value);
      else state.selectedBotIds.delete(input.value);
    });
  });
}

async function confirmAssignment() {
  if (!state.selectedBotIds.size) return;
  await adminRequest(`/api/admin/workspaces/${state.selectedWorkspaceId}/bots`, {
    method: "POST",
    body: JSON.stringify({ botIds: [...state.selectedBotIds] })
  });
  els.assignmentModal.hidden = true;
  await loadGlobalData();
  toast("Bot 已分配");
}

async function removeBot(botId) {
  if (!confirm("从当前入口移除这个 Bot？Bot 和业务数据会保留。")) return;
  await adminRequest(`/api/admin/workspaces/${state.selectedWorkspaceId}/bots/${encodeURIComponent(botId)}`, {
    method: "DELETE"
  });
  await loadGlobalData();
}

async function transferBot(botId) {
  const source = state.workspaceDetails.get(state.selectedWorkspaceId)?.workspace;
  const targets = state.workspaces.filter((workspace) => workspace.id !== state.selectedWorkspaceId);
  if (!targets.length) throw new Error("没有其他可转移的工作区");
  const targetSlug = prompt(`原入口：${source.name}\n请输入目标工作区 URL 尾巴：`);
  if (!targetSlug) return;
  const target = targets.find((workspace) => workspace.slug === targetSlug.trim());
  if (!target) throw new Error("目标工作区不存在");
  if (!confirm(`确认转移？\n原入口：${source.name}\n新入口：${target.name}`)) return;
  await adminRequest(`/api/admin/workspaces/${source.id}/bots/${encodeURIComponent(botId)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ targetWorkspaceId: target.id })
  });
  await loadGlobalData();
}

function renderAgentOptions() {
  els.botForm.agentId.innerHTML = `<option value="">选择 Agent</option>${state.agents.map((agent) =>
    `<option value="${escapeHtml(agent.agentId)}">${escapeHtml(agent.agentName || agent.agentId)}</option>`
  ).join("")}`;
}

function renderBotList() {
  els.botList.innerHTML = state.bots.map((bot) => {
    const workspace = workspaceNameForBot(bot.botId);
    return `
      <div class="admin-table-row">
        <span><strong>${escapeHtml(bot.botName || bot.botId)}</strong><small>${escapeHtml(bot.botId)}</small></span>
        <span>${escapeHtml(bot.agentName || bot.agentId)}</span>
        <span>${workspace ? escapeHtml(workspace.name) : "未分配"}</span>
        <span class="admin-actions">
          <button data-edit-bot="${escapeHtml(bot.botId)}">${adminIcon("edit")}编辑</button>
          <button data-enter-bot="${escapeHtml(bot.botId)}" ${workspace ? "" : "disabled"}>${adminIcon("settings")}进入配置</button>
        </span>
      </div>
    `;
  }).join("");
  els.botList.querySelectorAll("[data-edit-bot]").forEach((button) => {
    button.addEventListener("click", () => {
      const bot = state.bots.find((item) => item.botId === button.dataset.editBot);
      els.botForm.botId.value = bot.botId;
      els.botForm.botName.value = bot.botName || "";
      els.botForm.agentId.value = bot.agentId || "";
      els.botForm.enabled.checked = bot.botEnabled !== false;
      els.botForm.scrollIntoView({ behavior: "smooth" });
    });
  });
  els.botList.querySelectorAll("[data-enter-bot]").forEach((button) => {
    button.addEventListener("click", async () => {
      const workspace = workspaceNameForBot(button.dataset.enterBot);
      if (!workspace) return;
      state.selectedWorkspaceId = workspace.id;
      await openWorkspace(button.dataset.enterBot);
    });
  });
}

async function saveBot(event) {
  event.preventDefault();
  const form = new FormData(els.botForm);
  await adminRequest(`/api/bots/${encodeURIComponent(form.get("botId"))}`, {
    method: "PUT",
    body: JSON.stringify({
      botName: form.get("botName"),
      agentId: form.get("agentId"),
      enabled: form.get("enabled") === "on"
    })
  });
  await loadGlobalData();
  toast("Bot 已保存");
}

function renderAgentList() {
  els.agentList.innerHTML = state.agents.map((agent) => `
    <article class="admin-item">
      <div class="admin-item-main">
        <strong>${escapeHtml(agent.agentName || agent.agentId)}</strong>
        <small>${escapeHtml(agent.agentId)} · Public ID ${escapeHtml(agent.dclawPublicId)}</small>
      </div>
      <div class="admin-actions">
        <button data-edit-agent="${escapeHtml(agent.agentId)}">${adminIcon("edit")}编辑</button>
        <button class="danger" data-delete-agent="${escapeHtml(agent.agentId)}">${adminIcon("trash")}删除</button>
      </div>
    </article>
  `).join("");
  els.agentList.querySelectorAll("[data-edit-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      const agent = state.agents.find((item) => item.agentId === button.dataset.editAgent);
      for (const field of ["agentId", "agentName", "dclawBaseUrl", "dclawPublicId"]) {
        els.agentForm[field].value = agent[field] || "";
      }
      els.agentForm.agentApiKey.value = "";
      els.agentForm.enabled.checked = agent.enabled;
      els.agentForm.scrollIntoView({ behavior: "smooth" });
    });
  });
  els.agentList.querySelectorAll("[data-delete-agent]").forEach((button) => {
    button.addEventListener("click", () => deleteAgent(button.dataset.deleteAgent));
  });
}

async function saveAgent(event) {
  event.preventDefault();
  const form = new FormData(els.agentForm);
  const body = Object.fromEntries(form.entries());
  body.enabled = form.get("enabled") === "on";
  await adminRequest(`/api/agents/${encodeURIComponent(body.agentId)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  els.agentForm.reset();
  els.agentForm.enabled.checked = true;
  await loadGlobalData();
  toast("Agent 已保存");
}

async function deleteAgent(agentId) {
  if (!confirm("删除这个 Agent？已绑定 Bot 的 Agent 不允许删除。")) return;
  await adminRequest(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  await loadGlobalData();
}

async function changePassword(event) {
  event.preventDefault();
  const form = new FormData(els.passwordForm);
  if (form.get("password") !== form.get("confirmation")) throw new Error("两次输入的密码不一致");
  await adminRequest("/api/admin/password", {
    method: "PUT",
    body: JSON.stringify({ password: form.get("password") })
  });
  clearAdminSession();
  showAdminLogin("管理员密码已修改，请使用新密码登录。");
}

async function logout() {
  try {
    await adminRequest("/api/admin/logout", { method: "POST" });
  } finally {
    clearAdminSession();
    showAdminLogin();
  }
}

els.tabs.forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.adminTab)));
els.logout.addEventListener("click", () => logout().catch((error) => toast(error.message)));
els.workspaceForm.addEventListener("submit", (event) => saveWorkspace(event).catch((error) => toast(error.message)));
els.newWorkspace.addEventListener("click", resetWorkspaceForm);
els.openWorkspace.addEventListener("click", () => openWorkspace().catch((error) => toast(error.message)));
els.deleteWorkspace.addEventListener("click", () => deleteWorkspace().catch((error) => toast(error.message)));
els.assignBots.addEventListener("click", () => openAssignmentModal().catch((error) => toast(error.message)));
els.assignmentSearch.addEventListener("input", renderAssignmentBots);
els.assignmentCancel.addEventListener("click", () => { els.assignmentModal.hidden = true; });
els.assignmentConfirm.addEventListener("click", () => confirmAssignment().catch((error) => toast(error.message)));
els.botForm.addEventListener("submit", (event) => saveBot(event).catch((error) => toast(error.message)));
els.agentForm.addEventListener("submit", (event) => saveAgent(event).catch((error) => toast(error.message)));
els.passwordForm.addEventListener("submit", (event) => changePassword(event).catch((error) => toast(error.message)));

async function start() {
  if (!state.session?.token) {
    showAdminLogin();
    return;
  }
  try {
    await adminRequest("/api/admin/session");
    await showAdminConsole();
  } catch {
    clearAdminSession();
    showAdminLogin();
  }
}

start();
