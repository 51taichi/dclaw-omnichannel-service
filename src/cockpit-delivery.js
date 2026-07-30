const labels = {
  daily: "日报",
  weekly: "周报",
  monthly: "月报"
};

export function formatCockpitReportSummary(report, { reportUrl = "" } = {}) {
  const metrics = report?.summary?.metrics || {};
  const lines = [
    `【AI 经营${labels[report?.reportType] || "报告"}】`,
    `新增客户 ${Number(metrics.newCustomers || 0)}｜客户消息 ${Number(metrics.customerMessages || 0)}｜回复消息 ${Number(metrics.replyMessages || 0)}｜从未回复 ${Number(metrics.neverReplied || 0)}`,
    String(report?.summary?.executiveSummary || "本期统计已完成。").slice(0, 300)
  ];
  if (reportUrl) lines.push(`完整报告：${reportUrl}`);
  return lines.join("\n");
}

export function createCockpitDeliveryService({
  claimDeliveries,
  getReport,
  sendText,
  finishDelivery,
  publicBaseUrl = ""
}) {
  return {
    async sendDue({ now }) {
      const deliveries = claimDeliveries({ now, limit: 20 });
      let sent = 0;
      let failed = 0;
      for (const delivery of deliveries) {
        try {
          const report = getReport({ botId: delivery.botId, reportId: delivery.reportId });
          if (!report) throw new Error("cockpit report not found");
          const reportUrl = publicBaseUrl
            ? `${publicBaseUrl.replace(/\/$/, "")}/console/?cockpitReport=${report.id}`
            : "";
          const response = await sendText({
            robotId: delivery.botId,
            targets: [delivery.recipient],
            content: formatCockpitReportSummary(report, { reportUrl })
          });
          finishDelivery({ id: delivery.id, status: "sent", response });
          sent += 1;
        } catch (error) {
          finishDelivery({
            id: delivery.id,
            status: "failed",
            errorMessage: error?.message || String(error)
          });
          failed += 1;
        }
      }
      return { claimed: deliveries.length, sent, failed };
    }
  };
}
