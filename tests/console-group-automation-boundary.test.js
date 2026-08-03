import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const clientUrl = new URL("../public/console/group-automation-client.js", import.meta.url);
const client = fs.existsSync(clientUrl) ? fs.readFileSync(clientUrl, "utf8") : "";

test("group management loads the authenticated automation event client before app.js", () => {
  assert.ok(
    html.indexOf('<script src="./group-automation-client.js"></script>') > 0
  );
  assert.ok(
    html.indexOf('<script src="./group-automation-client.js"></script>') <
      html.indexOf('<script src="./app.js"></script>')
  );
  assert.match(client, /global\.createGroupAutomationClient\s*=\s*createGroupAutomationClient/);
  assert.match(client, /response\.body\.getReader\(\)/);
  assert.match(client, /controller\?\.abort\(\)/);
  assert.doesNotMatch(client, /setInterval|setTimeout\([^)]*fetch/);
  assert.match(app, /if \(ledgerUpdated\) loadGroupAutomations\(\{ reconnect: false \}\)/);
});

test("group automation uses a bounded card list with local countdown and only two business states", () => {
  assert.match(app, /id="groupAutomationSection"/);
  assert.match(app, /id="addGroupAutomationButton"/);
  assert.match(app, /id="groupAutomationList"/);
  assert.match(app, /function formatGroupAutomationCountdown\(/);
  assert.match(app, /setInterval\([^,]+,\s*1000\)/s);
  assert.match(app, /已达成/);
  assert.match(app, /尚未达成/);
  assert.doesNotMatch(app, />待判断<|>判断异常</);
  assert.match(css, /\.group-automation-list\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
});

test("group automation dialog supports both task types, schedules, month end, native mentions and templates", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  assert.match(dialog, /id="groupAutomationForm"/);
  assert.match(dialog, /name="taskType"/);
  assert.match(dialog, /value="conditional_push"/);
  assert.match(dialog, /value="periodic_summary"/);
  assert.match(dialog, /name="cadence"/);
  assert.match(dialog, /value="daily"/);
  assert.match(dialog, /value="weekly"/);
  assert.match(dialog, /value="monthly"/);
  assert.match(dialog, /value="month_end"[^>]*>月底</);
  assert.doesNotMatch(dialog, /value="(?:29|30|31)"/);
  assert.match(dialog, /name="timeOfDay"/);
  assert.match(dialog, /name="conditionText"/);
  assert.match(dialog, /name="content"/);
  assert.match(dialog, /name="summaryTemplate"/);
  assert.match(dialog, /id="groupAutomationMentionRoles"/);
  assert.match(dialog, /name="enabled"/);
  assert.match(dialog, /id="insertGroupAutomationVariableButton"/);
  assert.match(dialog, /id="groupAutomationVariableCount"/);
  assert.match(dialog, /id="groupAutomationTemplatePreview"/);
  assert.match(app, /function renderGroupAutomationTemplatePreview\(/);
  assert.match(app, /［\$\{escapeHtml\(name\)\}］/);
});

test("task cards expose complete management actions and evidence navigation reuses conversations", () => {
  assert.match(app, /data-group-automation-action="edit"/);
  assert.match(app, /data-group-automation-action="duplicate"/);
  assert.match(app, /data-group-automation-action="history"/);
  assert.match(app, /data-group-automation-action="delete"/);
  assert.match(app, /data-group-automation-action="toggle"/);
  assert.match(app, /data-group-automation-action="refresh"/);
  assert.match(app, /async function openGroupAutomationEvidence\(/);
  assert.match(app, /switchWorkspaceTab\("sessions"\)/);
  assert.match(app, /await openFlowSession\(anchor\.conversationKey,\s*\{/);
  assert.match(app, /anchorMessageId:\s*anchor\.messageId/);
});

test("history dialog renders occurrences, results and bounded evidence without private task concepts", () => {
  assert.match(html, /id="groupAutomationHistoryDialog"/);
  assert.match(html, /id="groupAutomationHistoryList"/);
  assert.match(app, /\/occurrences\?/);
  assert.match(app, /data-group-automation-evidence/);
  assert.match(app, /data-group-automation-retry/);
  assert.doesNotMatch(app, /群定时任务[\s\S]{0,300}任务状态机|群定时任务[\s\S]{0,300}资产/);
});

test("monthly scheduling supports multiple 1-28 dates plus month end", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  assert.match(dialog, /name="monthlyDay"[^>]*value="1"/);
  assert.match(dialog, /name="monthlyDay"[^>]*value="28"/);
  assert.match(dialog, /name="monthlyDay"[^>]*value="month_end"/);
  assert.match(app, /querySelectorAll\('\[name="monthlyDay"\]:checked'\)/);
});

test("group automation stream and countdown follow the visible group tab lifecycle", () => {
  assert.match(app, /if \(tabName !== "groups"\) disconnectGroupAutomations\(\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /if \(document\.hidden\) disconnectGroupAutomations\(\)/);
});
