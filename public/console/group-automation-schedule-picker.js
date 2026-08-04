(function exposeGroupAutomationSchedulePicker(global) {
  const MONTH_DAY_PAGES = Object.freeze([
    Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    Object.freeze([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    Object.freeze([21, 22, 23, 24, 25, 26, 27, 28, "month_end"])
  ]);

  function clampMonthPage(pageIndex) {
    const value = Number(pageIndex);
    if (!Number.isFinite(value)) return 0;
    return Math.min(MONTH_DAY_PAGES.length - 1, Math.max(0, Math.trunc(value)));
  }

  function monthPageForScheduleDays(scheduleDays = []) {
    const selected = new Set(scheduleDays.map(String));
    const pageIndex = MONTH_DAY_PAGES.findIndex((page) =>
      page.some((day) => selected.has(String(day)))
    );
    return pageIndex < 0 ? 0 : pageIndex;
  }

  global.GroupAutomationSchedulePicker = Object.freeze({
    MONTH_DAY_PAGES,
    clampMonthPage,
    monthPageForScheduleDays
  });
})(typeof window !== "undefined" ? window : globalThis);
