import crypto from "node:crypto";
import { hashAccessKey, verifyAccessKey } from "./auth.js";
import {
  getGlobalAdminCredential,
  initializeGlobalAdminCredential,
  updateGlobalAdminCredential
} from "./db.js";

const defaultAdminSessionTtlMs =
  Number(process.env.ADMIN_SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;
const adminSessions = new Map();

export function initializeAdminAuth({ bootstrapPassword = "" } = {}) {
  const existing = getGlobalAdminCredential();
  if (existing) {
    return { ready: true, initialized: false, reason: "" };
  }
  const password = String(bootstrapPassword || "");
  if (!password) {
    return {
      ready: false,
      initialized: false,
      reason: "admin password is not initialized"
    };
  }
  const result = initializeGlobalAdminCredential({
    passwordHash: hashAccessKey(password)
  });
  return {
    ready: Boolean(result.credential),
    initialized: result.initialized,
    reason: ""
  };
}

export function verifyAdminPassword(password) {
  return verifyAccessKey(password, getGlobalAdminCredential()?.passwordHash);
}

export function createAdminSession({
  ttlMs = defaultAdminSessionTtlMs,
  nowMs = Date.now()
} = {}) {
  if (!getGlobalAdminCredential()) {
    throw new Error("admin credential is not initialized");
  }
  const token = crypto.randomUUID();
  const session = {
    token,
    role: "admin",
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
  adminSessions.set(token, session);
  return session;
}

export function getAdminSession(token, { nowMs = Date.now() } = {}) {
  const session = adminSessions.get(String(token || ""));
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= nowMs) {
    adminSessions.delete(session.token);
    return null;
  }
  return session;
}

export function deleteAdminSession(token) {
  return adminSessions.delete(String(token || ""));
}

export function deleteAllAdminSessions() {
  const count = adminSessions.size;
  adminSessions.clear();
  return count;
}

export function changeAdminPassword(password) {
  const value = String(password || "");
  if (!value) throw new Error("password is required");
  const credential = updateGlobalAdminCredential({
    passwordHash: hashAccessKey(value)
  });
  deleteAllAdminSessions();
  return credential;
}

export function initializeOrChangeAdminPassword(password) {
  const value = String(password || "");
  if (!value) throw new Error("password is required");
  if (!getGlobalAdminCredential()) {
    return initializeGlobalAdminCredential({
      passwordHash: hashAccessKey(value)
    }).credential;
  }
  return changeAdminPassword(value);
}
