export const BEIJING_TIME_ZONE = "Asia/Shanghai";

const VALID_CADENCES = new Set(["daily", "weekly", "monthly"]);
const VALID_WEEK_DAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const VALID_MONTH_DAYS = new Set([
  ...Array.from({ length: 28 }, (_, index) => index + 1),
  "month_end"
]);
const BEIJING_OFFSET_HOURS = 8;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const beijingPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function unique(values) {
  return [...new Set(values)];
}

function parseInstant(value) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("invalid ISO instant");
  return instant;
}

function beijingParts(value) {
  const parts = Object.fromEntries(
    beijingPartsFormatter.formatToParts(parseInstant(value))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, Number(partValue)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function civilDate(year, month, day) {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate()
  };
}

function addCivilDays(date, amount) {
  return civilDate(date.year, date.month, date.day + amount);
}

function beijingInstant(date, hour = 0, minute = 0) {
  return new Date(Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour - BEIJING_OFFSET_HOURS,
    minute
  ));
}

function weekDay(date) {
  const utcDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function dailyCycleKey(date) {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

function monthlyCycleKey(date) {
  return `${pad(date.year, 4)}-${pad(date.month)}`;
}

function isoWeek(date) {
  const thursday = addCivilDays(date, 4 - weekDay(date));
  const firstDay = { year: thursday.year, month: 1, day: 1 };
  const elapsedDays = Math.floor(
    (Date.UTC(thursday.year, thursday.month - 1, thursday.day)
      - Date.UTC(firstDay.year, 0, 1)) / DAY_MILLISECONDS
  );
  return {
    year: thursday.year,
    week: Math.floor(elapsedDays / 7) + 1
  };
}

export function normalizeGroupAutomationSchedule(input = {}) {
  const cadence = String(input.cadence || "").trim();
  if (!VALID_CADENCES.has(cadence)) throw new Error("invalid cadence");

  const timeOfDay = String(input.timeOfDay || "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    throw new Error("invalid timeOfDay");
  }

  if (input.scheduleDays != null && !Array.isArray(input.scheduleDays)) {
    throw new Error(`invalid ${cadence} schedule day`);
  }
  const scheduleDays = unique(input.scheduleDays || []);
  if (cadence === "daily") {
    if (scheduleDays.length) throw new Error("invalid daily schedule day");
    return { cadence, scheduleDays: [], timeOfDay };
  }

  const allowedDays = cadence === "weekly" ? VALID_WEEK_DAYS : VALID_MONTH_DAYS;
  if (!scheduleDays.length || scheduleDays.some((day) => !allowedDays.has(day))) {
    throw new Error(`invalid ${cadence} schedule day`);
  }

  return { cadence, scheduleDays, timeOfDay };
}

export function nextGroupAutomationRunAt(input, afterIso) {
  const schedule = normalizeGroupAutomationSchedule(input);
  const after = parseInstant(afterIso);
  const current = beijingParts(after);
  const startDate = {
    year: current.year,
    month: current.month,
    day: current.day
  };
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);

  for (let offset = 0; offset <= 400; offset += 1) {
    const candidateDate = addCivilDays(startDate, offset);
    const matches = schedule.cadence === "daily"
      || (schedule.cadence === "weekly" && schedule.scheduleDays.includes(weekDay(candidateDate)))
      || (schedule.cadence === "monthly" && (
        schedule.scheduleDays.includes(candidateDate.day)
        || (schedule.scheduleDays.includes("month_end")
          && candidateDate.day === daysInMonth(candidateDate.year, candidateDate.month))
      ));
    if (!matches) continue;

    const candidate = beijingInstant(candidateDate, hour, minute);
    if (candidate.getTime() > after.getTime()) return candidate.toISOString();
  }

  throw new Error("unable to resolve next group automation run");
}

export function groupAutomationCycleKey(cadence, atIso) {
  const { cycleKey } = groupAutomationCycleWindow(cadence, atIso);
  return cycleKey;
}

export function groupAutomationCycleWindow(cadence, atIso) {
  if (!VALID_CADENCES.has(cadence)) throw new Error("invalid cadence");
  const parts = beijingParts(atIso);
  const atDate = { year: parts.year, month: parts.month, day: parts.day };

  if (cadence === "daily") {
    return {
      cycleKey: dailyCycleKey(atDate),
      startAt: beijingInstant(atDate).toISOString(),
      endAt: beijingInstant(addCivilDays(atDate, 1)).toISOString()
    };
  }

  if (cadence === "weekly") {
    const startDate = addCivilDays(atDate, 1 - weekDay(atDate));
    const { year, week } = isoWeek(atDate);
    return {
      cycleKey: `${pad(year, 4)}-W${pad(week)}`,
      startAt: beijingInstant(startDate).toISOString(),
      endAt: beijingInstant(addCivilDays(startDate, 7)).toISOString()
    };
  }

  const startDate = { year: atDate.year, month: atDate.month, day: 1 };
  const endDate = civilDate(atDate.year, atDate.month + 1, 1);
  return {
    cycleKey: monthlyCycleKey(atDate),
    startAt: beijingInstant(startDate).toISOString(),
    endAt: beijingInstant(endDate).toISOString()
  };
}
