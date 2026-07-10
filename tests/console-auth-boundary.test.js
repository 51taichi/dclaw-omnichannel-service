import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console has unified unlock and relock controls", () => {
  assert.equal(html.includes("unlockDialog"), true);
  assert.equal(html.includes("unlockKeyInput"), true);
  assert.equal(html.includes("lockBotButton"), true);
  assert.equal(app.includes("/api/public/bots"), true);
  assert.equal(app.includes("/unlock"), true);
  assert.equal(app.includes("lockCurrentBot"), true);
});

test("console stores bot scoped tokens and sends x-bot-session-token", () => {
  assert.equal(app.includes("worktool_console_bot_sessions"), true);
  assert.equal(app.includes('"x-bot-session-token"'), true);
  assert.equal(app.includes("state.currentRole"), true);
});

test("console hides config tab for bot role and exposes access-key reset for admin", () => {
  assert.equal(html.includes("accessKeyForm"), true);
  assert.equal(app.includes("syncRoleVisibility"), true);
  assert.equal(app.includes("state.currentRole === \"admin\""), true);
  assert.equal(app.includes("/access-key"), true);
  assert.equal(css.includes(".bot-card.is-locked"), true);
});

test("bot cards expose four unlocked quick actions", () => {
  assert.equal(app.includes('data-action="${unlocked ? "tasks" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "sessions" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "push" : "unlock"}'), true);
  assert.equal(app.includes('data-action="${unlocked ? "logs" : "unlock"}'), true);
});

test("lock and reset return to unselected config context", () => {
  assert.equal(app.includes("function resetBotContext()"), true);
  assert.equal(app.includes("clearBotSession(botId);"), true);
  assert.equal(app.includes("resetBotContext();"), true);
  assert.equal(app.includes('switchWorkspaceTab("config", { force: true });'), true);
  assert.equal(app.includes('const hideConfig = hasBot && !isAdmin;'), true);
});
