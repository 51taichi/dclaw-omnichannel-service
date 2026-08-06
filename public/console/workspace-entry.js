(function initializeWorkspaceEntry(global) {
  const SESSION_KEY = "dclaw_omnichannel_workspace_sessions";
  const pathMatch = global.location.pathname.match(/^\/console\/([a-z0-9-]{3,32})\/?$/);
  const slug = pathMatch?.[1] || "";
  const authRoot = document.querySelector("#workspaceAuthRoot");
  const logoutButton = document.querySelector("#workspaceLogoutButton");
  let workspace = null;
  let bots = [];
  let controller = null;
  let resolveReady;
  let readyResolved = false;

  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function readSessions() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function getSession() {
    return readSessions()[slug] || null;
  }

  function saveSession(session) {
    const sessions = readSessions();
    sessions[slug] = {
      token: session.token,
      expiresAt: session.expiresAt
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  }

  function clearSession() {
    const sessions = readSessions();
    delete sessions[slug];
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
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

  async function workspaceRequest(path, options = {}) {
    const session = getSession();
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(session?.token
          ? { "x-workspace-session-token": session.token }
          : {}),
        ...(options.headers || {})
      }
    });
    return parseResponse(response);
  }

  function revealConsole() {
    document.body.classList.remove("workspace-gated");
    authRoot.hidden = true;
    logoutButton.hidden = false;
    controller?.destroy();
    controller = null;
    if (!readyResolved) {
      readyResolved = true;
      resolveReady({ workspace, bots });
    }
  }

  function showUnavailable(message = "当前入口不可用") {
    document.body.classList.add("workspace-gated");
    authRoot.hidden = false;
    controller?.destroy();
    controller = AuthShell.mount({
      root: authRoot,
      title: "入口暂不可用",
      prompt: message,
      fieldLabel: "对口令",
      submitLabel: "确认",
      async onSubmit() {}
    });
    controller.setFailure("当前入口不可用");
    controller.setBusy(true);
  }

  async function loadBots() {
    try {
      const data = await workspaceRequest(
        `/api/workspaces/${encodeURIComponent(slug)}/bots`
      );
      workspace = data.workspace;
      bots = data.bots || [];
      context.workspace = workspace;
      return { workspace, bots };
    } catch (error) {
      if (error.status === 401) handleUnauthorized();
      throw error;
    }
  }

  function handleUnauthorized() {
    clearSession();
    global.location.reload();
  }

  async function logout() {
    try {
      await workspaceRequest(
        `/api/workspaces/${encodeURIComponent(slug)}/logout`,
        { method: "POST" }
      );
    } catch {}
    clearSession();
    global.location.reload();
  }

  async function showPhraseEntry(challenge) {
    document.body.classList.add("workspace-gated");
    authRoot.hidden = false;
    logoutButton.hidden = true;
    controller?.destroy();
    controller = AuthShell.mount({
      root: authRoot,
      title: challenge.name,
      prompt: "",
      accountFieldLabel: "上半句",
      accountLabel: challenge.challengeText,
      fieldLabel: "接下半句",
      inputType: "text",
      submitLabel: "对口令",
      async onSubmit(response, shell) {
        try {
          const data = await workspaceRequest(
            `/api/workspaces/${encodeURIComponent(slug)}/unlock`,
            {
              method: "POST",
              body: JSON.stringify({ response })
            }
          );
          saveSession(data.session);
          workspace = data.session.workspace;
          context.workspace = workspace;
          await loadBots();
          shell.showSuccess({
            message: "口令正确",
            seconds: 3,
            onComplete: revealConsole
          });
        } catch (error) {
          shell.setFailure(
            error.status === 401 ? "口令没对上，再试一次" : error.message
          );
        }
      }
    });
    controller.focus();
  }

  async function start() {
    if (!slug) {
      showUnavailable();
      return;
    }
    try {
      const challengeData = await workspaceRequest(
        `/api/workspaces/${encodeURIComponent(slug)}/challenge`
      );
      workspace = challengeData.workspace;
      context.workspace = workspace;
      if (getSession()) {
        try {
          await loadBots();
          revealConsole();
          return;
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
      await showPhraseEntry(workspace);
    } catch (error) {
      if (error.status === 404 || error.status === 423 || error.status === 400) {
        showUnavailable();
        return;
      }
      showUnavailable("当前入口暂时无法访问，请稍后重试");
    }
  }

  const context = {
    ready,
    slug,
    workspace,
    loadBots,
    logout,
    handleUnauthorized
  };
  global.WorkspaceContext = context;
  logoutButton?.addEventListener("click", () => logout());
  start();
})(window);
