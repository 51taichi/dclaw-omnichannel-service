(function initializeCockpitConsole(global) {
  const state = {
    botId: "",
    role: "",
    accent: "",
    periodType: "daily",
    request: null,
    version: 0
  };

  const metricDefinitions = [
    ["newCustomers", "新增客户", "users"],
    ["successfulInvitations", "成功邀约", "check"],
    ["invitationRate", "邀约转化率", "cockpit"],
    ["effectiveConversations", "有效沟通", "history"],
    ["neverReplied", "从未回复", "alert"],
    ["stoppedReplying", "中途未回复", "clock"],
    ["waiting", "等待中", "clock"],
    ["handoffs", "转人工", "user"]
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function icon(name) {
    return `<svg class="icon cockpit-card-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  }

  function elements() {
    return {
      loading: document.querySelector("#cockpitLoadingState"),
      stale: document.querySelector("#cockpitStaleState"),
      content: document.querySelector("#cockpitContent")
    };
  }

  function clear() {
    state.version += 1;
    state.botId = "";
    state.role = "";
    state.accent = "";
    state.request = null;
    const current = elements();
    if (current.loading) current.loading.hidden = false;
    if (current.stale) current.stale.hidden = true;
    if (current.content) {
      current.content.hidden = true;
      current.content.innerHTML = "";
    }
  }

  function metricValue(key, metrics, today) {
    const value = metrics[key] ?? today[key] ?? 0;
    if (key === "invitationRate") return `${Math.round(Number(value || 0) * 100)}%`;
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function render(data) {
    const current = elements();
    const report = data.latestReport?.document || {};
    const analysis = report.analysis || {};
    const problems = analysis.problems || [];
    const actions = analysis.actions || [];
    current.content.innerHTML = `
      <div class="cockpit-dashboard">
        <header class="cockpit-toolbar cockpit-card">
          <div>
            <span class="cockpit-eyebrow">AI 经营驾驶舱</span>
            <strong>${escapeHtml(data.period?.label || "最近统计周期")}</strong>
          </div>
          <div id="cockpitPeriodSwitcher" class="segmented" role="tablist" aria-label="报告周期">
            ${[["daily", "日报"], ["weekly", "周报"], ["monthly", "月报"]].map(([type, label]) => `
              <button type="button" data-cockpit-period="${type}" class="${state.periodType === type ? "active" : ""}">${label}</button>
            `).join("")}
          </div>
          <small id="cockpitFreshness">完整统计：${escapeHtml(data.freshness?.completeAt || "尚未生成")}</small>
        </header>

        <section id="cockpitAiSummary" class="cockpit-card cockpit-summary" tabindex="0">
          ${icon("cockpit")}
          <div><span class="cockpit-eyebrow">AI 经营结论</span><strong>${escapeHtml(analysis.executiveSummary || "完整报告将在凌晨统计后生成")}</strong></div>
        </section>

        <section id="cockpitMetricGrid" class="cockpit-metric-grid" aria-label="核心经营指标">
          ${metricDefinitions.map(([key, label, iconName]) => `
            <article class="cockpit-card cockpit-metric-card" tabindex="0">
              ${icon(iconName)}
              <span>${label}</span>
              <strong>${metricValue(key, data.metrics || {}, data.today || {})}</strong>
            </article>
          `).join("")}
        </section>

        <div class="cockpit-priority-grid">
          <section id="cockpitProblems" class="cockpit-card cockpit-problem-card">
            <h3>${icon("alert")}主要问题</h3>
            ${problems.length ? `<ol>${problems.slice(0, 3).map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ol>` : "<p>当前周期暂无 AI 问题分析。</p>"}
          </section>
          <section id="cockpitActions" class="cockpit-card cockpit-action-card">
            <h3>${icon("check")}建议行动</h3>
            ${actions.length ? `<ol>${actions.slice(0, 3).map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ol>` : "<p>完整统计后生成具体行动建议。</p>"}
          </section>
        </div>

        <div class="cockpit-chart-grid">
          <section id="cockpitFunnels" class="cockpit-card">
            <h3>${icon("briefcase")}任务转化</h3>
            ${data.funnels?.length ? data.funnels.map((funnel) => `
              <div class="cockpit-funnel">
                <small>任务版本 ${funnel.flowVersionId}</small>
                ${(funnel.nodes || []).map((node) => `
                  <div><span>${escapeHtml(node.nodeId)}</span><i style="--value:${Math.round(node.share * 100)}%"></i><b>${node.reached}</b></div>
                `).join("")}
              </div>
            `).join("") : "<p>暂无任务漏斗数据。</p>"}
          </section>
          <section id="cockpitTags" class="cockpit-card">
            <h3>${icon("tag")}标签变化</h3>
            ${data.tagGroups?.length ? data.tagGroups.map((tag) => `
              <div class="cockpit-tag-row"><span>${escapeHtml(tag.tagId)}</span><b>${tag.current}</b><small>净变化 ${tag.net >= 0 ? "+" : ""}${tag.net}</small></div>
            `).join("") : "<p>暂无标签变化数据。</p>"}
          </section>
        </div>

        <section id="cockpitReportHistory" class="cockpit-card cockpit-history">
          <h3>${icon("history")}报告留档</h3>
          ${data.reportHistory?.length ? data.reportHistory.map((item) => `
            <details class="cockpit-report-row">
              <summary>
                <span>${escapeHtml(item.periodStart.slice(0, 10))} · 第 ${item.revision} 版</span>
                <small>${escapeHtml(item.status)}</small>
              </summary>
              <p>${escapeHtml(item.document?.analysis?.executiveSummary || "统计报告")}</p>
              <div class="cockpit-report-metrics">
                <span>新增 ${Number(item.document?.statistics?.newCustomers || 0)}</span>
                <span>邀约 ${Number(item.document?.statistics?.successfulInvitations || 0)}</span>
                <span>未回复 ${Number(item.document?.statistics?.neverReplied || 0)}</span>
              </div>
            </details>
          `).join("") : "<p>尚未生成历史报告。</p>"}
        </section>
      </div>
    `;
    current.content.querySelectorAll("[data-cockpit-period]").forEach((button) => {
      button.addEventListener("click", () => {
        state.periodType = button.dataset.cockpitPeriod;
        refresh();
      });
    });
    current.loading.hidden = true;
    current.stale.hidden = !data.freshness?.delayed;
    current.content.hidden = false;
  }

  async function refresh() {
    if (!state.botId || typeof state.request !== "function") return;
    const version = ++state.version;
    const current = elements();
    current.loading.hidden = false;
    try {
      const data = await state.request(
        `/api/cockpit/${encodeURIComponent(state.botId)}/overview?periodType=${encodeURIComponent(state.periodType)}`
      );
      if (version !== state.version) return;
      render(data);
    } catch (error) {
      if (version !== state.version) return;
      current.loading.querySelector("small").textContent = error?.message || "驾驶舱加载失败";
      current.stale.hidden = false;
    }
  }

  function setBotContext(context = {}) {
    state.botId = String(context.botId || "");
    state.role = String(context.role || "");
    state.accent = String(context.accent || "");
    state.request = context.request || null;
    refresh();
  }

  global.cockpitConsole = { clear, refresh, setBotContext };
})(window);
