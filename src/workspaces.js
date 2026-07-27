import crypto from "node:crypto";
import { hashAccessKey, verifyAccessKey } from "./auth.js";
import {
  deleteWorkspaceRecord,
  deleteWorkspaceSessionByTokenHash,
  getWorkspaceById,
  getWorkspaceBySlug,
  getWorkspaceSessionByTokenHash,
  insertWorkspace,
  insertWorkspaceSession,
  updateWorkspaceRecord
} from "./db.js";

const WORKSPACE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "assets",
  "public",
  "uploads",
  "console",
  "shared"
]);

function workspaceError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizeWorkspaceSlug(value) {
  const slug = String(value || "").trim();
  if (!/^[a-z0-9-]{3,32}$/.test(slug) || RESERVED_SLUGS.has(slug)) {
    throw workspaceError("invalid workspace slug", 400);
  }
  return slug;
}

export function publicWorkspaceView(workspace) {
  if (!workspace) return null;
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    challengeText: workspace.challengeText,
    enabled: workspace.enabled,
    authVersion: workspace.authVersion,
    botCount: workspace.botCount ?? undefined,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}

export function createWorkspace({ name, slug, challengeText, response, enabled = true }) {
  const workspaceName = String(name || "").trim();
  const challenge = String(challengeText || "").trim();
  const answer = String(response || "");
  if (!workspaceName) throw workspaceError("workspace name is required", 400);
  if (!challenge) throw workspaceError("challenge text is required", 400);
  if (!answer) throw workspaceError("phrase response is required", 400);
  return publicWorkspaceView(insertWorkspace({
    name: workspaceName,
    slug: normalizeWorkspaceSlug(slug),
    challengeText: challenge,
    responseHash: hashAccessKey(answer),
    enabled
  }));
}

export function updateWorkspace(id, input = {}) {
  const current = getWorkspaceById(id);
  if (!current) throw workspaceError("workspace not found", 404);
  const nextName = input.name === undefined ? current.name : String(input.name || "").trim();
  const nextSlug = input.slug === undefined
    ? current.slug
    : normalizeWorkspaceSlug(input.slug);
  const nextChallenge = input.challengeText === undefined
    ? current.challengeText
    : String(input.challengeText || "").trim();
  const responseChanged = input.response !== undefined && String(input.response || "") !== "";
  if (!nextName) throw workspaceError("workspace name is required", 400);
  if (!nextChallenge) throw workspaceError("challenge text is required", 400);
  const authChanged =
    nextSlug !== current.slug ||
    nextChallenge !== current.challengeText ||
    responseChanged;
  return publicWorkspaceView(updateWorkspaceRecord({
    id: current.id,
    name: nextName,
    slug: nextSlug,
    challengeText: nextChallenge,
    responseHash: responseChanged
      ? hashAccessKey(String(input.response))
      : current.responseHash,
    authVersion: authChanged ? current.authVersion + 1 : current.authVersion,
    enabled: input.enabled === undefined ? current.enabled : input.enabled !== false
  }));
}

export function removeWorkspace(id) {
  const result = deleteWorkspaceRecord(id);
  if (!result) throw workspaceError("workspace not found", 404);
  return {
    workspace: publicWorkspaceView(result.workspace),
    unassignedBotCount: result.unassignedBotCount
  };
}

export function getWorkspaceChallenge(slug) {
  const workspace = getWorkspaceBySlug(normalizeWorkspaceSlug(slug));
  if (!workspace) throw workspaceError("workspace not found", 404);
  if (!workspace.enabled) throw workspaceError("workspace disabled", 423);
  return publicWorkspaceView(workspace);
}

export function workspaceSessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createWorkspaceSession(workspace, {
  ttlMs = WORKSPACE_SESSION_TTL_MS,
  nowMs = Date.now()
} = {}) {
  if (!workspace?.enabled) throw workspaceError("workspace disabled", 423);
  const token = crypto.randomUUID();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  insertWorkspaceSession({
    tokenHash: workspaceSessionTokenHash(token),
    workspaceId: workspace.id,
    authVersion: workspace.authVersion,
    expiresAt,
    createdAt: new Date(nowMs).toISOString()
  });
  return {
    token,
    expiresAt,
    workspace: publicWorkspaceView(workspace)
  };
}

export function unlockWorkspace({ slug, response, ttlMs, nowMs } = {}) {
  const workspace = getWorkspaceBySlug(normalizeWorkspaceSlug(slug));
  if (!workspace) throw workspaceError("workspace not found", 404);
  if (!workspace.enabled) throw workspaceError("workspace disabled", 423);
  if (!verifyAccessKey(String(response || ""), workspace.responseHash)) {
    throw workspaceError("invalid phrase", 401);
  }
  return createWorkspaceSession(workspace, { ttlMs, nowMs });
}

export function createWorkspaceSessionForAdmin(workspaceId, options = {}) {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw workspaceError("workspace not found", 404);
  return createWorkspaceSession(workspace, options);
}

export function resolveWorkspaceSession(token, { nowMs = Date.now() } = {}) {
  const tokenHash = workspaceSessionTokenHash(token);
  const session = getWorkspaceSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (
    Date.parse(session.expiresAt) <= nowMs ||
    !session.workspace.enabled ||
    session.authVersion !== session.workspace.authVersion
  ) {
    deleteWorkspaceSessionByTokenHash(tokenHash);
    return null;
  }
  return {
    ...session,
    workspace: publicWorkspaceView(session.workspace)
  };
}

export function logoutWorkspace(token) {
  return deleteWorkspaceSessionByTokenHash(workspaceSessionTokenHash(token));
}
