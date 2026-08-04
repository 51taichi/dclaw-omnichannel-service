import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const clientUrl = new URL("../public/console/group-automation-client.js", import.meta.url);
const client = fs.existsSync(clientUrl) ? fs.readFileSync(clientUrl, "utf8") : "";
const statusSource = fs.readFileSync(
  new URL("../public/console/group-automation-status.js", import.meta.url),
  "utf8"
);

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

test("group detail tab keyboard helper loads before app.js", () => {
  const helperScript = '<script src="./group-detail-tabs.js"></script>';
  assert.ok(html.indexOf(helperScript) > 0);
  assert.ok(html.indexOf(helperScript) < html.indexOf('<script src="./app.js"></script>'));
  assert.match(app, /GroupDetailTabs/);
});

test("group automation uses a bounded card list with local countdown and only two business states", () => {
  assert.match(app, /id="groupAutomationSection"/);
  assert.match(app, /id="addGroupAutomationButton"/);
  assert.match(app, /id="groupAutomationList"/);
  assert.match(app, /function formatGroupAutomationCountdown\(/);
  assert.match(app, /setInterval\([^,]+,\s*1000\)/s);
  assert.match(statusSource, /已达成/);
  assert.match(statusSource, /尚未达成/);
  assert.doesNotMatch(statusSource, />待判断<|>判断异常</);
  assert.match(css, /\.group-automation-list\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
});

test("selected group details keep config and task tabs mounted with one header task action", () => {
  const renderStart = app.indexOf("function renderGroupConfig()");
  const renderEnd = app.indexOf("function bindGroupRoleRemoveButtons()", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);
  const headStart = renderSource.indexOf('class="section-head groups-config-head"');
  const tabsStart = renderSource.indexOf('class="segmented groups-detail-tabs"');
  const configPanelStart = renderSource.indexOf('data-group-detail-panel="config"');
  const taskPanelStart = renderSource.indexOf('data-group-detail-panel="tasks"');
  const taskHeadStart = renderSource.indexOf('class="group-automation-head"');
  const taskListStart = renderSource.indexOf('id="groupAutomationList"');

  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  assert.match(app, /groupDetailTab:\s*"config"/);
  assert.match(renderSource, /data-group-detail-tab="config"/);
  assert.match(renderSource, /data-group-detail-tab="tasks"/);
  assert.match(renderSource, /id="groupDetailConfigTab"[^>]*aria-controls="groupDetailConfigPanel"/);
  assert.match(renderSource, /id="groupDetailTasksTab"[^>]*aria-controls="groupAutomationSection"/);
  assert.match(renderSource, /id="groupDetailConfigPanel"[^>]*role="tabpanel"[^>]*aria-labelledby="groupDetailConfigTab"/);
  assert.match(renderSource, /id="groupAutomationSection"[^>]*role="tabpanel"[^>]*aria-labelledby="groupDetailTasksTab"/);
  assert.ok(headStart < tabsStart);
  assert.ok(tabsStart < configPanelStart);
  assert.ok(configPanelStart < taskPanelStart);
  assert.match(renderSource.slice(headStart, tabsStart), /id="addGroupAutomationButton"/);
  assert.doesNotMatch(renderSource.slice(taskHeadStart, taskListStart), /id="addGroupAutomationButton"/);
  assert.match(app, /function syncGroupDetailTabs\(\)/);
  assert.match(app, /panel\.hidden\s*=\s*panel\.dataset\.groupDetailPanel\s*!==\s*activeTab/);
  assert.match(app, /addButton\.hidden\s*=\s*activeTab\s*!==\s*"tasks"/);
  assert.match(renderSource, /button\.addEventListener\("keydown"/);
  assert.match(renderSource, /nextGroupDetailTab\(state\.groupDetailTab,\s*event\.key\)/);
  assert.match(renderSource, /event\.preventDefault\(\)/);
  assert.match(renderSource, /activateGroupDetailTab\(nextTab,\s*\{\s*focus:\s*true\s*\}\)/);
});

test("group detail tabs and header action stay fixed across long names and narrow screens", () => {
  assert.match(
    css,
    /\.groups-detail-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*width:\s*100%/s
  );
  assert.match(
    css,
    /\.groups-config-title\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s
  );
  assert.match(
    css,
    /\.groups-config-head #addGroupAutomationButton\s*\{[^}]*flex:\s*0 0 auto[^}]*min-width:\s*156px[^}]*white-space:\s*nowrap/s
  );
  assert.match(
    css,
    /\.groups-config-head #addGroupAutomationButton\[hidden\]\s*\{[^}]*display:\s*none/s
  );
  assert.match(css, /\.groups-detail-panel\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(
    css,
    /\.group-automation-section\.groups-detail-panel\s*\{[^}]*border-top:\s*0[^}]*margin-top:\s*0[^}]*padding-top:\s*0/s
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*480px\)[\s\S]*?\.groups-config-head #addGroupAutomationButton\s*\{[^}]*width:\s*100%/s
  );
});

test("group automation cards respond to their actual container and protect long text", () => {
  assert.match(
    css,
    /\.group-automation-section\s*\{[^}]*container-type:\s*inline-size/s
  );
  assert.match(
    css,
    /@container\s*\(max-width:\s*760px\)[\s\S]*?\.group-automation-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(140px,\s*auto\)/s
  );
  assert.match(
    css,
    /@container\s*\(max-width:\s*520px\)[\s\S]*?\.group-automation-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
  );
  assert.match(
    css,
    /\.group-automation-mention-card strong\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s
  );
  assert.match(
    css,
    /\.group-automation-history-item > div:first-child strong\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s
  );
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

test("group automation mention roles use conversation mascot avatars without people icons", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  const mentionFieldset = dialog.slice(
    dialog.indexOf('class="group-automation-mentions"'),
    dialog.indexOf('class="toggle switch-toggle group-automation-enabled"')
  );

  assert.match(mentionFieldset, /<legend>推送时 @ 群角色（可多选）<\/legend>/);
  assert.doesNotMatch(mentionFieldset, /icon-users/);
  assert.match(app, /class="group-automation-mention-avatar" src="\.\/assets\/ddeer\.png"/);
  assert.doesNotMatch(app, /group-automation-mention-card[^\n]*\$\{icon\("user"\)\}/);
  assert.match(
    css,
    /\.group-automation-mention-avatar\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*object-fit:\s*cover;/s
  );
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

test("weekly scheduling uses one dedicated seven-column row", () => {
  assert.match(
    html,
    /id="groupAutomationWeeklyDays"[^>]*class="[^"]*group-automation-week-days[^"]*"/
  );
});

test("monthly scheduling exposes three fixed horizontal pages and event-driven navigation", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  const firstPage = dialog.slice(
    dialog.indexOf('data-month-page="0"'),
    dialog.indexOf('data-month-page="1"')
  );
  const secondPage = dialog.slice(
    dialog.indexOf('data-month-page="1"'),
    dialog.indexOf('data-month-page="2"')
  );
  const thirdPage = dialog.slice(dialog.indexOf('data-month-page="2"'));

  assert.match(dialog, /id="groupAutomationMonthPrev"[^>]*aria-label="上一组执行日期"/);
  assert.match(dialog, /id="groupAutomationMonthNext"[^>]*aria-label="下一组执行日期"/);
  assert.match(dialog, /id="groupAutomationMonthViewport"/);
  assert.match(dialog, /id="groupAutomationMonthPageStatus"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(firstPage, /name="monthlyDay"[^>]*value="1"/);
  assert.match(firstPage, /name="monthlyDay"[^>]*value="10"/);
  assert.doesNotMatch(firstPage, /name="monthlyDay"[^>]*value="11"/);
  assert.match(secondPage, /name="monthlyDay"[^>]*value="11"/);
  assert.match(secondPage, /name="monthlyDay"[^>]*value="20"/);
  assert.match(thirdPage, /name="monthlyDay"[^>]*value="21"/);
  assert.match(thirdPage, /name="monthlyDay"[^>]*value="28"/);
  assert.match(thirdPage, /name="monthlyDay"[^>]*value="month_end"/);
  assert.match(app, /monthPageForScheduleDays\(task\?\.cadence === "monthly" \? task\.scheduleDays : \[\]\)/);
  assert.match(app, /function syncGroupAutomationMonthPage\(/);
  assert.match(app, /requestAnimationFrame\(/);
  assert.match(app, /Math\.round\(viewport\.scrollLeft \/ viewport\.clientWidth\)/);
  assert.match(
    app,
    /function setGroupAutomationMonthPage\(pageIndex,\s*\{ behavior = "auto" \} = \{\}\)/
  );
  assert.match(
    app,
    /if \(els\.groupAutomationForm\.cadence\.value === "monthly"\) \{[\s\S]*?if \(!els\.groupAutomationForm\.taskId\.value\) state\.groupAutomationMonthPage = 0;/
  );
});

test("weekly and monthly schedule choices keep fixed equal-width rows", () => {
  assert.match(
    css,
    /\.group-automation-week-days\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s
  );
  assert.match(
    css,
    /\.group-automation-month-picker\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/s
  );
  assert.match(
    css,
    /\.group-automation-month-viewport\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/s
  );
  assert.match(
    css,
    /\.group-automation-month-track\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*100%\)/s
  );
  assert.match(
    css,
    /\.group-automation-month-page\s*\{[^}]*grid-template-columns:\s*repeat\(10,\s*minmax\(0,\s*1fr\)\)[^}]*scroll-snap-align:\s*start/s
  );
  assert.doesNotMatch(
    css,
    /\.group-automation-month-days\s*\{[^}]*overflow-y:\s*auto/s
  );
});

test("weekly monthly and mention choices share whole-card selection styles", () => {
  const choiceSelector = /:is\(\s*\.group-automation-week-days label,\s*\.group-automation-month-page label,\s*\.group-automation-mention-card\s*\)/;

  assert.match(
    css,
    new RegExp(`${choiceSelector.source}\\s*>\\s*input\\[type="checkbox"\\]\\s*\\{[^}]*position:\\s*absolute;[^}]*opacity:\\s*0;[^}]*pointer-events:\\s*none;`, "s")
  );
  assert.match(
    css,
    new RegExp(`${choiceSelector.source}:has\\(> input:checked\\)\\s*\\{[^}]*border-color:\\s*var\\(--accent\\);[^}]*background:\\s*var\\(--accent-soft\\);[^}]*color:\\s*var\\(--accent\\);`, "s")
  );
  assert.match(
    css,
    new RegExp(`${choiceSelector.source}:has\\(> input:focus-visible\\)\\s*\\{[^}]*outline:\\s*2px solid var\\(--accent\\);`, "s")
  );
});

test("group automation stream and countdown follow the visible group tab lifecycle", () => {
  assert.match(app, /if \(tabName !== "groups"\) disconnectGroupAutomations\(\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /if \(document\.hidden\) disconnectGroupAutomations\(\)/);
});
