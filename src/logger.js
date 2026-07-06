function normalizeValue(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

function write(level, event, fields = {}) {
  const record = {
    time: new Date().toISOString(),
    level,
    event,
    ...normalizeValue(fields)
  };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logInfo(event, fields) {
  write("info", event, fields);
}

export function logWarn(event, fields) {
  write("warn", event, fields);
}

export function logError(event, fields) {
  write("error", event, fields);
}
