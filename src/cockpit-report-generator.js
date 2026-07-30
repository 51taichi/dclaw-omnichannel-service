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

export function assembleCockpitReport({ snapshot, analysis }) {
  return {
    schemaVersion: 1,
    period: {
      type: snapshot.periodType,
      start: snapshot.periodStart,
      end: snapshot.periodEnd
    },
    statistics: snapshot.metrics || {},
    charts: snapshot.charts || {},
    analysis
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
      let analysis = {
        executiveSummary: "统计数据已生成，AI 分析暂不可用。",
        problems: [],
        actions: []
      };
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
        metrics: snapshot.metrics || {}
      };
      return saveReport({
        botId: snapshot.botId,
        snapshotId: snapshot.id,
        reportType: snapshot.periodType,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        status: aiError ? "ready_with_ai_error" : "ready",
        summary,
        document: assembleCockpitReport({ snapshot, analysis }),
        aiError,
        generatedAt: new Date().toISOString()
      });
    }
  };
}
