import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console classifies flow sessions by conversation key before groupName fallback", () => {
  assert.match(app, /function flowSessionType\(session\)/);
  assert.match(app, /conversationKey\.includes\(":group:"\)/);
  assert.match(app, /conversationKey\.includes\(":private:"\)/);
  assert.equal(app.includes("session?.groupName || roomType === 1 || roomType === 3"), false);
});

test("console derives flow session display names by session type", () => {
  assert.match(app, /function flowSessionDisplayName\(session\)/);
  assert.match(app, /flowSessionType\(session\) === "group"/);
  assert.match(app, /conversationKey\.split\(":"\)\.pop\(\)/);
  assert.equal(app.includes("const name = session.receivedName || session.conversationKey"), false);
});

test("console only renders the card handoff switch for private flow sessions", () => {
  assert.match(app, /const handoffSwitch = sessionType === "private"/);
  assert.match(app, /data-flow-handoff-switch=/);
  assert.match(app, /querySelectorAll\("\[data-flow-handoff-switch\]"\)/);
  assert.doesNotMatch(app, /data-flow-handoff=/);
  assert.doesNotMatch(app, /const handoffControl = sessionType === "private"/);
});

test("console does not apply private flow filters to group sessions", () => {
  assert.match(app, /function sessionUsesFlowFilters\(session\)/);
  assert.match(app, /return flowSessionType\(session\) === "private"/);
  assert.match(app, /const appliesFlowFilters = sessionUsesFlowFilters\(session\)/);
  assert.match(app, /if \(appliesFlowFilters && nodeFilter !== "all"/);
  assert.doesNotMatch(app, /flowSessionAssetFilter/);
  assert.doesNotMatch(app, /assetFilter ===/);
});

test("empty chat title follows the selected session type tab", () => {
  assert.match(app, /function emptyFlowSessionTitle\(\)/);
  assert.match(app, /const typeFilter = currentFlowSessionTypeFilter\(\)/);
  assert.match(app, /typeFilter === "group"/);
  assert.match(app, /请选择一个群聊会话/);
});

test("chat message timestamps render as compact date time text", () => {
  assert.match(app, /const BEIJING_TIME_ZONE = "Asia\/Shanghai"/);
  assert.match(app, /function formatDisplayDateTime\(value\)/);
  assert.match(app, /timeZone: BEIJING_TIME_ZONE/);
  assert.match(app, /<time>\$\{escapeHtml\(formatDisplayDateTime\(message\.createdAt\)\)\}<\/time>/);
  assert.match(app, /formatDisplayDateTime\(task\.updatedAt \|\| task\.createdAt\)/);
  assert.doesNotMatch(app, /<time>\$\{escapeHtml\(message\.createdAt \|\| ""\)\}<\/time>/);
});

test("console loads flow sessions through paginated server queries", () => {
  assert.match(app, /PAGE_SIZE_OPTIONS = \[20, 50, 100\]/);
  assert.doesNotMatch(app, /PAGE_SIZE_OPTIONS = \[2, 20, 50, 100\]/);
  assert.match(app, /flowSessionsPagination:\s*\{[\s\S]*page:\s*1[\s\S]*pageSize:\s*20/);
  assert.match(app, /flowSessionsPaginationEl:\s*document\.querySelector\("#flowSessionsPagination"\)/);
  assert.match(app, /params\.set\("page", String\(state\.flowSessionsPagination\.page\)\)/);
  assert.match(app, /params\.set\("pageSize", String\(state\.flowSessionsPagination\.pageSize\)\)/);
  assert.match(app, /renderPaginationBar\(\{[\s\S]*container:\s*els\.flowSessionsPaginationEl/);
  assert.doesNotMatch(app, /new URLSearchParams\(\{ botId, limit: "100" \}\)/);
});

test("console loads proactive tasks through paginated server queries", () => {
  assert.match(app, /proactiveTasksPagination:\s*\{[\s\S]*page:\s*1[\s\S]*pageSize:\s*20/);
  assert.match(app, /proactiveTasksPaginationEl:\s*document\.querySelector\("#proactiveTasksPagination"\)/);
  assert.match(app, /params\.set\("page", String\(state\.proactiveTasksPagination\.page\)\)/);
  assert.match(app, /params\.set\("pageSize", String\(state\.proactiveTasksPagination\.pageSize\)\)/);
  assert.match(app, /renderPaginationBar\(\{[\s\S]*container:\s*els\.proactiveTasksPaginationEl/);
  assert.doesNotMatch(app, /new URLSearchParams\(\{ limit: "20" \}\)/);
});

test("console loads proactive targets through the shared pagination bar", () => {
  assert.match(app, /proactiveTargetsPagination:\s*\{[\s\S]*page:\s*1[\s\S]*pageSize:\s*20/);
  assert.match(app, /targetPaginationEl:\s*document\.querySelector\("#targetPagination"\)/);
  assert.match(app, /params\.set\("page", String\(state\.proactiveTargetsPagination\.page\)\)/);
  assert.match(app, /params\.set\("pageSize", String\(state\.proactiveTargetsPagination\.pageSize\)\)/);
  assert.match(app, /renderPaginationBar\(\{[\s\S]*container:\s*els\.targetPaginationEl/);
  assert.doesNotMatch(app, /new URLSearchParams\(\{ botId, limit: "300" \}\)/);
});

test("bulk target buttons select matching targets across every page", () => {
  assert.match(app, /async function fetchAllAddressBookTargetsByType\(type/);
  assert.match(app, /params\.set\("pageSize", "100"\)/);
  assert.match(app, /for \(let page = 2; page <= totalPages; page \+= 1\)/);
  assert.match(app, /const allSelected = targets\.length > 0 && targets\.every\(\(target\) => selectedTargets\.has\(targetKey\(target\)\)\)/);
  assert.match(app, /selectTargetsByTypeAcrossPages\("private"\)\.catch\(toastError\)/);
  assert.match(app, /selectTargetsByTypeAcrossPages\("group"\)\.catch\(toastError\)/);
  assert.doesNotMatch(app, /function toggleTargetsByType\(type\)\s*\{[\s\S]*targetsByType\(type\)/);
});

test("pagination controls use compact icon buttons", () => {
  assert.match(app, /aria-label="上一页"/);
  assert.match(app, /aria-label="下一页"/);
  assert.match(app, /icon\("chevron"\)/);
  assert.doesNotMatch(app, />上一页<\/button>/);
  assert.doesNotMatch(app, />下一页<\/button>/);
});

test("target pagination total sits after the next page button", () => {
  assert.doesNotMatch(app, /<span class="pagination-summary">共 \$\{current\.total\} 条<\/span>\s*<label class="pagination-size">/);
  assert.match(app, /<button class="secondary pagination-button is-next"[\s\S]*>\$\{icon\("chevron"\)\}<\/button>\s*<span class="pagination-summary">共 \$\{current\.total\} 条<\/span>/);
  assert.match(css, /\.pagination-size\s*\{[^}]*display:\s*inline-flex;[^}]*grid-template-columns:\s*none;[^}]*align-items:\s*center;[^}]*margin:\s*0;[^}]*padding-left:\s*15px;/);
  assert.match(css, /\.pagination-size select\s*\{[^}]*width:\s*60px;[^}]*min-width:\s*60px;[^}]*height:\s*32px;[^}]*padding:\s*0 24px 0 0px;[^}]*font-size:\s*13px;/);
  assert.doesNotMatch(css, /\.pagination-summary\s*\{[^}]*margin-right:\s*auto/);
  assert.match(css, /\.bulk-actions \.target-pagination\s*\{[^}]*justify-content:\s*flex-end/);
});

test("target pagination buttons keep shared dimensions inside bulk actions", () => {
  assert.match(css, /\.bulk-actions \.pagination-button\s*\{[^}]*width:\s*34px;[^}]*min-width:\s*34px;[^}]*height:\s*34px;[^}]*min-height:\s*34px;[^}]*padding:\s*0;[^}]*gap:\s*0;/);
});

test("proactive target pagination sits on the bulk action row", () => {
  assert.match(html, /<div class="bulk-actions">[\s\S]*id="targetPagination"[\s\S]*<\/div>\s*<\/div>\s*<div id="targetList"/);
  assert.match(css, /\.bulk-actions\s*\{[^}]*align-items:\s*center/);
  assert.match(css, /\.bulk-actions \.target-pagination\s*\{[^}]*margin-left:\s*auto/);
  assert.doesNotMatch(css, /\.target-pagination\s*\{[^}]*grid-column:\s*2/);
});
