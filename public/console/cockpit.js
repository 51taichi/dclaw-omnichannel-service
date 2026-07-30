(function initializeCockpitConsole(global) {
  const state = { botId: "", role: "", accent: "" };

  function elements() {
    return {
      loading: document.querySelector("#cockpitLoadingState"),
      stale: document.querySelector("#cockpitStaleState"),
      content: document.querySelector("#cockpitContent")
    };
  }

  function clear() {
    state.botId = "";
    state.role = "";
    state.accent = "";
    const current = elements();
    if (current.loading) current.loading.hidden = false;
    if (current.stale) current.stale.hidden = true;
    if (current.content) {
      current.content.hidden = true;
      current.content.innerHTML = "";
    }
  }

  function setBotContext(context = {}) {
    state.botId = String(context.botId || "");
    state.role = String(context.role || "");
    state.accent = String(context.accent || "");
    const current = elements();
    if (current.loading) current.loading.hidden = !state.botId;
    if (current.stale) current.stale.hidden = true;
    if (current.content) current.content.hidden = true;
  }

  function refresh() {
    setBotContext(state);
  }

  global.cockpitConsole = { clear, refresh, setBotContext };
})(window);
