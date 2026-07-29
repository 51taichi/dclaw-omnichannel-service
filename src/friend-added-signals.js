import { isSystemFriendGreeting } from "./message-rules.js";

export const DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS = 30_000;

export function resolveFriendAddedSignal(message = {}) {
  if (isSystemFriendGreeting(message)) {
    const friendName = String(message.receivedName || message.groupName || "").trim();
    return friendName
      ? { trigger: "system_greeting", friendName, message }
      : null;
  }
  if (Number(message.textType) !== 22 || Number(message.type) !== 105) return null;
  const friendName = String(message.friendName || "").trim();
  if (!friendName) return null;
  return {
    trigger: "worktool_friend_event",
    friendName,
    message: {
      ...message,
      roomType: 2,
      receivedName: friendName,
      groupName: ""
    }
  };
}

export function isFriendAddedSignalDuplicate({
  lastFriendAddedAt,
  occurredAt,
  dedupeMs = DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
}) {
  const previous = Date.parse(String(lastFriendAddedAt || ""));
  const current = Date.parse(String(occurredAt || ""));
  const windowMs = Math.max(
    1,
    Number(dedupeMs) || DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
  );
  return Number.isFinite(previous)
    && Number.isFinite(current)
    && current >= previous
    && current - previous < windowMs;
}
