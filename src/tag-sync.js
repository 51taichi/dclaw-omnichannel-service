export const TAG_SYNC_TIME_ZONE = "Asia/Shanghai";

export const DEFAULT_TAG_SYNC_CONFIG = Object.freeze({
  nightlyEnabled: true,
  syncDateTags: false,
  windowStart: "03:00",
  windowEnd: "06:00"
});

const beijingDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAG_SYNC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("invalid night window time");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("invalid night window time");
  return { hour, minute };
}

function dailyWindowMinute(value) {
  const { hour, minute } = parseTime(value);
  const minutes = hour * 60 + minute;
  if (minutes > 6 * 60) {
    throw new Error("night window must stay within 00:00-06:00");
  }
  return minutes;
}

function beijingParts(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid tag sync clock time");
  const parts = Object.fromEntries(
    beijingDateTime.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

export function validateTagSyncNightWindow({ windowStart, windowEnd }) {
  const startMinute = dailyWindowMinute(windowStart);
  const endMinute = dailyWindowMinute(windowEnd);
  if (endMinute <= startMinute) {
    throw new Error("night window end must be after start");
  }
  return { startMinute, endMinute };
}

export function normalizeTagSyncConfig(input = {}) {
  const config = {
    nightlyEnabled: input.nightlyEnabled === undefined
      ? DEFAULT_TAG_SYNC_CONFIG.nightlyEnabled
      : Boolean(input.nightlyEnabled),
    syncDateTags: input.syncDateTags === undefined
      ? DEFAULT_TAG_SYNC_CONFIG.syncDateTags
      : Boolean(input.syncDateTags),
    windowStart: String(input.windowStart || DEFAULT_TAG_SYNC_CONFIG.windowStart),
    windowEnd: String(input.windowEnd || DEFAULT_TAG_SYNC_CONFIG.windowEnd)
  };
  validateTagSyncNightWindow(config);
  return config;
}

export function getTagSyncWindowState(config, now = new Date()) {
  const normalized = normalizeTagSyncConfig(config);
  const { startMinute, endMinute } = validateTagSyncNightWindow(normalized);
  const parts = beijingParts(now);
  const localMinute = parts.hour * 60 + parts.minute;
  const localDateKey = [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
  return {
    inside: localMinute >= startMinute && localMinute < endMinute,
    windowKey: localDateKey,
    localMinute
  };
}
