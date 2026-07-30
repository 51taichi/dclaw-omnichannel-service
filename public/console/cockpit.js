(function initializeCockpitConsole(global) {
  const state = {
    botId: "",
    role: "",
    accent: "",
    periodType: "daily",
    request: null,
    notify: null,
    lastNoticeKey: "",
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
      content: document.querySelector("#cockpitContent")
    };
  }

  function clear() {
    state.version += 1;
    state.botId = "";
    state.role = "";
    state.accent = "";
    state.request = null;
    state.notify = null;
    state.lastNoticeKey = "";
    const current = elements();
    if (current.loading) current.loading.hidden = false;
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

  function distributionPercentages(nodes) {
    const total = nodes.reduce((sum, node) => sum + Number(node.reached || 0), 0);
    if (!total) return nodes.map(() => 0);
    const percentages = nodes.map((node) => (
      Math.round((Number(node.reached || 0) / total) * 1000) / 10
    ));
    const lastPositive = nodes.findLastIndex((node) => Number(node.reached || 0) > 0);
    const assigned = percentages.reduce(
      (sum, value, index) => index === lastPositive ? sum : sum + value,
      0
    );
    percentages[lastPositive] = Math.max(0, Math.round((100 - assigned) * 10) / 10);
    return percentages;
  }

  function funnelChart(data) {
    const nodes = (data.nodeDistribution?.length
      ? data.nodeDistribution
      : (data.funnels || []).flatMap((funnel) => funnel.nodes || []))
      .slice(0, 8);
    if (!nodes.length) {
      return '<div class="cockpit-chart-empty-state">暂无真实任务节点数据</div>';
    }
    const rowHeight = 46;
    const height = nodes.length * rowHeight + 42;
    const percentages = distributionPercentages(nodes);
    return `
      <div class="cockpit-funnel-chart">
        <svg viewBox="0 0 640 ${height}" role="img" aria-label="任务节点到达人数及占比图">
          <line class="cockpit-chart-axis" x1="150" y1="18" x2="150" y2="${height - 22}"></line>
          ${nodes.map((node, index) => {
            const y = 28 + index * rowHeight;
            const share = Math.max(0, Math.min(1, Number(node.share || 0)));
            const width = share > 0 ? Math.max(4, share * 390) : 0;
            const nodeName = node.nodeId === "__conversation__"
              ? "其他（未进入任务）"
              : (node.nodeName || node.nodeId);
            return `
              <text class="cockpit-chart-label" x="140" y="${y + 16}" text-anchor="end">${escapeHtml(nodeName)}</text>
              <rect class="cockpit-chart-track" x="166" y="${y}" width="390" height="22" rx="7"></rect>
              <rect class="cockpit-chart-bar" x="166" y="${y}" width="${width}" height="22" rx="7"></rect>
              <text class="cockpit-chart-value" x="570" y="${y + 16}">${Number(node.reached || 0)} · ${percentages[index].toFixed(1)}%</text>
            `;
          }).join("")}
        </svg>
      </div>
    `;
  }

  function tagChart(tags = []) {
    const visible = tags.slice(0, 30);
    if (!visible.length) {
      return '<div class="cockpit-chart-empty-state">暂无真实客户标签数据</div>';
    }
    const groups = [];
    for (const tag of visible) {
      const groupId = tag.groupId || "__other__";
      let group = groups.find((item) => item.id === groupId);
      if (!group) {
        group = { id: groupId, name: tag.groupName || "其他标签", tags: [] };
        groups.push(group);
      }
      group.tags.push(tag);
    }
    const maximum = Math.max(1, ...visible.map((tag) => Number(tag.current || 0)));
    return `
      <div class="cockpit-tag-groups">
        ${groups.map((group) => `
          <section class="cockpit-tag-group">
            <strong class="cockpit-tag-group-name">${escapeHtml(group.name)}</strong>
            <div class="cockpit-tag-group-rows">
              ${group.tags.map((tag) => {
                const current = Number(tag.current || 0);
                const net = Number(tag.net || 0);
                return `
                  <div class="cockpit-tag-row" title="${escapeHtml(group.name)} / ${escapeHtml(tag.tagName || tag.tagId)}">
                    <span>${escapeHtml(tag.tagName || tag.tagId)}</span>
                    <i class="cockpit-tag-bar"><b style="width:${current / maximum * 100}%"></b></i>
                    <strong>${current}</strong>
                    <small class="${net > 0 ? "positive" : net < 0 ? "negative" : ""}">${net >= 0 ? "+" : ""}${net}</small>
                  </div>
                `;
              }).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    `;
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
          <small id="cockpitFreshness" class="cockpit-freshness">
            完整统计：${escapeHtml(data.freshness?.completeAt || "尚未生成")}
            <button
              id="cockpitFreshnessHelp"
              class="activation-help-icon cockpit-help-icon"
              type="button"
              aria-label="报告生成时间说明"
              title="完整报告将在凌晨统计后生成"
            >${icon("info")}</button>
          </small>
        </header>

        <section id="cockpitMetricGrid" class="cockpit-metric-grid" aria-label="核心经营指标">
          ${metricDefinitions.map(([key, label, iconName]) => `
            <article class="cockpit-card cockpit-metric-card" tabindex="0">
              <span class="cockpit-metric-label">${icon(iconName)}<span>${label}</span></span>
              <strong>${metricValue(key, data.metrics || {}, data.today || {})}</strong>
            </article>
          `).join("")}
        </section>

        <div class="cockpit-chart-grid">
          <section id="cockpitFunnels" class="cockpit-card">
            <h3>${icon("briefcase")}任务节点转化</h3>
            <p class="cockpit-chart-caption">${data.nodeDistribution?.some((node) => node.basis === "current_state")
              ? "当前停留人数与全部任务会话占比"
              : "各节点到达人数与新增客户占比"}</p>
            ${funnelChart(data)}
          </section>
          <section id="cockpitTags" class="cockpit-card">
            <h3>${icon("tag")}标签分布与变化</h3>
            <p class="cockpit-chart-caption">按标签配置顺序展示当前人数及本周期净变化</p>
            ${tagChart(data.tagGroups || [])}
          </section>
        </div>

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
    current.content.hidden = false;
    if (data.freshness?.delayed) {
      const noticeKey = `${state.botId}:${state.periodType}:delayed`;
      if (state.lastNoticeKey !== noticeKey) {
        state.lastNoticeKey = noticeKey;
        state.notify?.("驾驶舱数据更新延迟，当前展示最近一次统计结果", "info");
      }
    }
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
      render({
        period: { label: "当前统计周期" },
        freshness: { completeAt: "", delayed: false },
        metrics: {},
        today: {},
        funnels: [],
        nodeDistribution: [],
        tagGroups: [],
        reportHistory: []
      });
      state.notify?.(error?.message || "驾驶舱加载失败", "error");
    }
  }

  function setBotContext(context = {}) {
    state.botId = String(context.botId || "");
    state.role = String(context.role || "");
    state.accent = String(context.accent || "");
    state.request = context.request || null;
    state.notify = context.notify || null;
    state.lastNoticeKey = "";
    refresh();
  }

  global.cockpitConsole = { clear, refresh, setBotContext };
})(window);
