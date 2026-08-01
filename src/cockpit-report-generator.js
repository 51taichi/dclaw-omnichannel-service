import { auditCockpitSnapshot } from "./cockpit-audit.js";

function text(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function validEvidenceKeys(snapshot) {
  return new Set([
    ...Object.keys(snapshot.metrics || {}).map((key) => `metric:${key}`),
    "chart:funnels",
    "chart:tags",
    "chart:nodeDistribution"
  ]);
}

function normalizeItems(items, allowed) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5).map((item) => {
    const evidence = Array.isArray(item?.evidence)
      ? item.evidence.map((key) => text(key, 120)).filter(Boolean)
      : [];
    if (evidence.some((key) => !allowed.has(key))) {
      throw new Error("cockpit analysis contains invalid evidence");
    }
    return {
      title: text(item?.title, 160),
      detail: text(item?.detail, 500),
      evidence
    };
  }).filter((item) => item.title);
}

export function validateCockpitReportAnalysis(value, snapshot) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cockpit analysis must be an object");
  }
  const allowed = validEvidenceKeys(snapshot);
  return {
    executiveSummary: text(value.executiveSummary, 800),
    problems: normalizeItems(value.problems, allowed),
    actions: normalizeItems(value.actions, allowed)
  };
}

export function assembleCockpitReport({ snapshot, analysis, audit }) {
  return {
    schemaVersion: 1,
    period: {
      type: snapshot.periodType,
      start: snapshot.periodStart,
      end: snapshot.periodEnd
    },
    statistics: snapshot.metrics || {},
    charts: snapshot.charts || {},
    audit: audit || auditCockpitSnapshot(snapshot),
    analysis
  };
}

export function buildFallbackCockpitAnalysis(snapshot) {
  const metrics = snapshot.metrics || {};
  const newCustomers = Number(metrics.newCustomers || 0);
  const customerMessages = Number(metrics.customerMessages || 0);
  const replyMessages = Number(metrics.replyMessages || 0);
  const neverReplied = Number(metrics.neverReplied || 0);
  const stoppedReplying = Number(metrics.stoppedReplying || 0);
  const waiting = Number(metrics.waiting || 0);
  const problems = [];
  const actions = [];
  if (neverReplied > 0) {
    problems.push({
      title: `${neverReplied} 名新增客户从未回复`,
      detail: "建议优先检查首轮触达内容和触达时机。",
      evidence: ["metric:neverReplied"]
    });
    actions.push({
      title: "优化首轮触达并安排二次跟进",
      detail: "先处理从未回复客户，再观察下一周期变化。",
      evidence: ["metric:neverReplied"]
    });
  } else if (stoppedReplying > 0) {
    problems.push({
      title: `${stoppedReplying} 名客户中途未回复`,
      detail: "建议检查对话中断前的节点和回复内容。",
      evidence: ["metric:stoppedReplying"]
    });
    actions.push({
      title: "针对中途未回复客户设计节点化跟进",
      detail: "按最后任务节点制定简短跟进内容。",
      evidence: ["metric:stoppedReplying"]
    });
  } else if (waiting > 0) {
    problems.push({
      title: `${waiting} 个会话正在等待客户回复`,
      detail: "这是统计结束时的会话状态，可与有效沟通重叠。",
      evidence: ["metric:waiting"]
    });
    actions.push({
      title: "按等待时长安排后续跟进",
      detail: "优先处理等待时间较长的会话。",
      evidence: ["metric:waiting"]
    });
  }
  return {
    executiveSummary: `本周期新增客户 ${newCustomers} 人，客户消息 ${customerMessages} 条，回复消息 ${replyMessages} 条；基础统计已校验，AI 深度分析将在服务恢复后补充。`,
    problems,
    actions
  };
}

function parseAnalysis(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) return result;
  const raw = String(result || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(raw);
}

export function buildCockpitReportAnalysisRequest(snapshot) {
  return {
    sessionId: `cockpit:${snapshot.botId}:${snapshot.periodType}:${snapshot.periodStart}`,
    message: JSON.stringify({
      task: "生成经营报告分析。只能引用 evidenceKeys，不得虚构客户、指标或数字。",
      outputSchema: {
        executiveSummary: "string",
        problems: [{ title: "string", detail: "string", evidence: ["metric:key"] }],
        actions: [{ title: "string", detail: "string", evidence: ["metric:key"] }]
      },
      evidenceKeys: [...validEvidenceKeys(snapshot)],
      snapshot: {
        periodType: snapshot.periodType,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        metrics: snapshot.metrics,
        charts: snapshot.charts
      }
    })
  };
}

export function createCockpitReportGenerator({ invokeAnalysis, saveReport }) {
  return {
    async generate({ snapshot }) {
      const audit = auditCockpitSnapshot(snapshot);
      if (audit.status !== "verified") {
        throw new Error(`驾驶舱统计校验失败：${audit.warnings.join("；")}`);
      }
      let analysis = buildFallbackCockpitAnalysis(snapshot);
      let aiError = "";
      try {
        const raw = await invokeAnalysis({
          snapshot,
          request: buildCockpitReportAnalysisRequest(snapshot)
        });
        analysis = validateCockpitReportAnalysis(parseAnalysis(raw?.reply ?? raw), snapshot);
      } catch (error) {
        aiError = error?.message || String(error);
      }
      const summary = {
        executiveSummary: analysis.executiveSummary,
        metrics: snapshot.metrics || {},
        statisticsStatus: audit.status,
        analysisStatus: aiError ? "fallback" : "generated"
      };
      return saveReport({
        botId: snapshot.botId,
        snapshotId: snapshot.id,
        reportType: snapshot.periodType,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        status: aiError ? "ready_with_ai_error" : "ready",
        summary,
        document: assembleCockpitReport({ snapshot, analysis, audit }),
        aiError,
        generatedAt: new Date().toISOString()
      });
    }
  };
}
