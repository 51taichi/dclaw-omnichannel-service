import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-workspace-auth-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
const workspaces = await import("../src/workspaces.js");

test("workspace slugs enforce stable public URL rules", () => {
  assert.equal(workspaces.normalizeWorkspaceSlug("sales-east"), "sales-east");
  for (const invalid of ["ABCD", "中文", "a", "admin", "api", "has space", "a/b"]) {
    assert.throws(() => workspaces.normalizeWorkspaceSlug(invalid));
  }
});

test("workspace phrase creates a fixed session without storing plaintext", () => {
  const workspace = workspaces.createWorkspace({
    name: "鲸小助",
    slug: "jingxiaozhu",
    challengeText: "我们的目标是",
    response: "没有烦恼"
  });
  const unlocked = workspaces.unlockWorkspace({
    slug: workspace.slug,
    response: "没有烦恼",
    ttlMs: 1000,
    nowMs: 100
  });

  assert.equal(db.getWorkspaceById(workspace.id).responseHash.includes("没有烦恼"), false);
  assert.equal(
    workspaces.resolveWorkspaceSession(unlocked.token, { nowMs: 500 }).workspace.id,
    workspace.id
  );
  assert.equal(workspaces.resolveWorkspaceSession(unlocked.token, { nowMs: 1101 }), null);
  assert.throws(
    () => workspaces.unlockWorkspace({ slug: workspace.slug, response: "答错了" }),
    /invalid phrase/
  );
});

test("only authentication changes invalidate workspace sessions", () => {
  const workspace = workspaces.getWorkspaceChallenge("jingxiaozhu");
  const session = workspaces.createWorkspaceSessionForAdmin(workspace.id, {
    ttlMs: 1000,
    nowMs: 200
  });

  workspaces.updateWorkspace(workspace.id, { name: "鲸小助新名称" });
  assert.equal(
    workspaces.resolveWorkspaceSession(session.token, { nowMs: 300 }).workspace.name,
    "鲸小助新名称"
  );

  workspaces.updateWorkspace(workspace.id, { challengeText: "芝麻开门" });
  assert.equal(workspaces.resolveWorkspaceSession(session.token, { nowMs: 300 }), null);
});

test("disabled workspaces reject phrase and active sessions", () => {
  const workspace = db.getWorkspaceBySlug("jingxiaozhu");
  const session = workspaces.createWorkspaceSessionForAdmin(workspace.id);
  workspaces.updateWorkspace(workspace.id, { enabled: false });

  assert.equal(workspaces.resolveWorkspaceSession(session.token), null);
  assert.throws(
    () => workspaces.unlockWorkspace({ slug: workspace.slug, response: "没有烦恼" }),
    /workspace disabled/
  );
});
