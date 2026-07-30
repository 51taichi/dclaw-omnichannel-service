(function initializeCockpitConsole(global) {
  const state = {
    botId: "",
    role: "",
    accent: "",
    periodType: "daily",
    periodValue: "",
    anchor: "",
    request: null,
    notify: null,
    lastNoticeKey: "",
    version: 0
  };

  const metricDefinitions = [
    ["newCustomers", "新增客户", "users"],
    ["effectiveConversations", "有效沟通", "history"],
    ["replyMessages", "回复消息", "send"],
    ["customerMessages", "客户消息", "message"],
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
    state.periodValue = "";
    state.anchor = "";
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
    return formatDashboardNumber(value);
  }

  function formatDashboardNumber(value) {
    const number = Math.max(0, Number(value || 0));
    const compact = (amount, unit) => (
      `${amount.toFixed(amount >= 10 ? 0 : 1).replace(/\.0$/, "")}${unit}`
    );
    if (number >= 100000000) return compact(number / 100000000, "亿");
    if (number >= 10000) return compact(number / 10000, "万");
    if (number >= 1000) return compact(number / 1000, "千");
    return number.toLocaleString("zh-CN");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isoWeekValue(date) {
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${pad(week)}`;
  }

  function anchorFromPeriodValue(type, value) {
    if (type === "weekly") {
      const match = /^(\d{4})-W(\d{2})$/.exec(value);
      if (!match) return "";
      const januaryFourth = new Date(Date.UTC(Number(match[1]), 0, 4));
      const monday = new Date(januaryFourth);
      monday.setUTCDate(
        januaryFourth.getUTCDate()
        - (januaryFourth.getUTCDay() || 7)
        + 1
        + (Number(match[2]) - 1) * 7
      );
      return new Date(
        monday.getUTCFullYear(),
        monday.getUTCMonth(),
        monday.getUTCDate(),
        12
      ).toISOString();
    }
    if (type === "monthly") {
      const match = /^(\d{4})-(\d{2})$/.exec(value);
      if (!match) return "";
      return new Date(Number(match[1]), Number(match[2]) - 1, 15, 12).toISOString();
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return "";
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12).toISOString();
  }

  function defaultAnchorForPeriod(type) {
    const now = new Date();
    let date;
    let value;
    if (type === "weekly") {
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
      const weekday = date.getDay() || 7;
      date.setDate(date.getDate() - weekday - 6);
      value = isoWeekValue(date);
    } else if (type === "monthly") {
      date = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
      value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    } else {
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
      value = localDateValue(date);
    }
    return { value, anchor: date.toISOString() };
  }

  function periodInputMarkup() {
    const defaults = defaultAnchorForPeriod(state.periodType);
    const maximum = defaults.value;
    const value = state.periodValue || maximum;
    if (state.periodType === "weekly") {
      return `<input id="cockpitPeriodInput" type="week" aria-label="选择周报周次" value="${escapeHtml(value)}" max="${maximum}">`;
    }
    if (state.periodType === "monthly") {
      return `<input id="cockpitPeriodInput" type="month" aria-label="选择月报月份" value="${escapeHtml(value)}" max="${maximum}">`;
    }
    return `<input id="cockpitPeriodInput" type="date" aria-label="选择日报日期" value="${escapeHtml(value)}" max="${maximum}">`;
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

  function outcomeDonut(metrics = {}) {
    const total = Math.max(0, Number(metrics.newCustomers || 0));
    const neverReplied = Math.min(total, Math.max(0, Number(metrics.neverReplied || 0)));
    const stoppedReplying = Math.min(
      total - neverReplied,
      Math.max(0, Number(metrics.stoppedReplying || 0))
    );
    const effectiveConversations = total - neverReplied - stoppedReplying;
    const outcomes = [
      { label: "从未回复", reached: neverReplied, className: "never" },
      { label: "中途未回复", reached: stoppedReplying, className: "stopped" },
      { label: "有效沟通", reached: effectiveConversations, className: "effective" }
    ];
    const percentages = distributionPercentages(outcomes);
    let offset = 0;
    return `
      <article class="cockpit-card cockpit-outcome-card" aria-label="新增客户沟通结果占比">
        <div class="cockpit-outcome-donut">
          <svg viewBox="0 0 120 120" role="img" aria-label="从未回复、中途未回复和有效沟通占比">
            <circle class="cockpit-outcome-ring" cx="60" cy="60" r="44"></circle>
            ${outcomes.map((outcome, index) => {
              const percent = percentages[index];
              const segment = `<circle class="cockpit-outcome-segment ${outcome.className}" cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="${percent} ${100 - percent}" stroke-dashoffset="${-offset}"></circle>`;
              offset += percent;
              return segment;
            }).join("")}
            <title>新增客户 ${total.toLocaleString("zh-CN")}</title>
            <text class="cockpit-outcome-total" x="60" y="58" text-anchor="middle">${formatDashboardNumber(total)}</text>
            <text class="cockpit-outcome-total-label" x="60" y="74" text-anchor="middle">新增客户</text>
          </svg>
        </div>
        <div class="cockpit-outcome-legend">
          ${outcomes.map((outcome, index) => `
            <div>
              <i class="${outcome.className}"></i>
              <span>${outcome.label}</span>
              <strong title="${outcome.reached.toLocaleString("zh-CN")}">${formatDashboardNumber(outcome.reached)}</strong>
              <small>${percentages[index].toFixed(1)}%</small>
            </div>
          `).join("")}
        </div>
      </article>
    `;
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
              <text class="cockpit-chart-value" x="570" y="${y + 16}">${formatDashboardNumber(node.reached)} · ${percentages[index].toFixed(1)}%</text>
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
    return `
      <div class="cockpit-tag-groups">
        ${groups.map((group) => {
          const groupMaximum = Math.max(
            1,
            ...group.tags.map((tag) => Number(tag.current || 0))
          );
          return `
            <section class="cockpit-tag-group">
              <strong class="cockpit-tag-group-name">${escapeHtml(group.name)}</strong>
              <div class="cockpit-tag-group-rows">
                ${group.tags.map((tag) => {
                const current = Number(tag.current || 0);
                const net = Number(tag.net || 0);
                return `
                  <div class="cockpit-tag-row" title="${escapeHtml(group.name)} / ${escapeHtml(tag.tagName || tag.tagId)}">
                    <span>${escapeHtml(tag.tagName || tag.tagId)}</span>
                    <i class="cockpit-tag-bar"><b style="width:${current / groupMaximum * 100}%"></b></i>
                    <strong title="${current.toLocaleString("zh-CN")}">${formatDashboardNumber(current)}</strong>
                    <small class="cockpit-tag-change ${net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}">${net >= 0 ? "+" : ""}${net}</small>
                  </div>
                `;
                }).join("")}
              </div>
            </section>
          `;
        }).join("")}
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
          <div class="cockpit-period-controls">
            ${periodInputMarkup()}
            <div id="cockpitPeriodSwitcher" class="segmented" role="tablist" aria-label="报告周期">
              ${[["daily", "日报"], ["weekly", "周报"], ["monthly", "月报"]].map(([type, label]) => `
                <button type="button" data-cockpit-period="${type}" class="${state.periodType === type ? "active" : ""}">${label}</button>
              `).join("")}
            </div>
          </div>
        </header>

        <section id="cockpitMetricGrid" class="cockpit-metric-grid" aria-label="核心经营指标">
          ${metricDefinitions.map(([key, label, iconName], index) => {
            const rawValue = data.metrics?.[key] ?? data.today?.[key] ?? 0;
            const fullNumber = Number(rawValue || 0).toLocaleString("zh-CN");
            return `
              <article class="cockpit-card cockpit-metric-card" tabindex="0">
                <span class="cockpit-metric-label">${icon(iconName)}<span>${label}</span></span>
                <strong title="${fullNumber}">${metricValue(key, data.metrics || {}, data.today || {})}</strong>
              </article>
              ${index === 1 ? outcomeDonut(data.metrics || {}) : ""}
            `;
          }).join("")}
        </section>

        <div class="cockpit-insight-grid">
          <div class="cockpit-insight-column">
            <section id="cockpitFunnels" class="cockpit-card">
              <h3>${icon("briefcase")}任务节点转化</h3>
              ${funnelChart(data)}
            </section>
            <section id="cockpitProblems" class="cockpit-card cockpit-problem-card">
              <h3>${icon("alert")}主要问题</h3>
              ${problems.length ? `<ol>${problems.slice(0, 3).map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ol>` : "<p>当前周期暂无 AI 问题分析。</p>"}
            </section>
          </div>
          <div class="cockpit-insight-column">
            <section id="cockpitTags" class="cockpit-card">
              <h3>${icon("tag")}标签分布与变化</h3>
              ${tagChart(data.tagGroups || [])}
            </section>
            <section id="cockpitActions" class="cockpit-card cockpit-action-card">
              <h3>${icon("check")}建议行动</h3>
              ${actions.length ? `<ol>${actions.slice(0, 3).map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ol>` : "<p>完整统计后生成具体行动建议。</p>"}
            </section>
          </div>
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
                <span>回复 ${Number(item.document?.statistics?.replyMessages || 0)}</span>
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
        const defaults = defaultAnchorForPeriod(state.periodType);
        state.periodValue = defaults.value;
        state.anchor = defaults.anchor;
        refresh();
      });
    });
    current.content.querySelector("#cockpitPeriodInput")?.addEventListener("change", (event) => {
      const anchor = anchorFromPeriodValue(state.periodType, event.target.value);
      if (!anchor) return;
      state.periodValue = event.target.value;
      state.anchor = anchor;
      refresh();
    });
    current.loading.hidden = true;
    current.content.hidden = false;
    if (data.freshness?.delayed) {
      const noticeKey = `${state.botId}:${state.periodType}:${state.anchor}:missing`;
      if (state.lastNoticeKey !== noticeKey) {
        state.lastNoticeKey = noticeKey;
        state.notify?.("所选周期尚未生成报告", "info");
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
        `/api/cockpit/${encodeURIComponent(state.botId)}/overview?periodType=${encodeURIComponent(state.periodType)}&anchor=${encodeURIComponent(state.anchor)}`
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
    const defaults = defaultAnchorForPeriod(state.periodType);
    state.periodValue = defaults.value;
    state.anchor = defaults.anchor;
    refresh();
  }

  global.cockpitConsole = { clear, refresh, setBotContext };
})(window);
