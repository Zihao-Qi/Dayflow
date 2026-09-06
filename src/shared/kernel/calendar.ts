/** A validated local calendar date at domain/HTTP boundaries; storage uses Date. */
declare const localDayBrand: unique symbol;
export type LocalDay = string & { readonly [localDayBrand]: true };

export interface Clock {
  now(): Date;
}

export interface Calendar {
  readonly timeZone: string;
  dayOf(instant: Date): LocalDay;
  startOf(day: LocalDay): Date;
  addDays(day: LocalDay, days: number): LocalDay;
  reviewPeriodEnding(day: LocalDay): { start: Date; end: Date };
  sameDay(day: LocalDay): { start: Date; end: Date };
  millisecondsUntilNextDay(instant: Date): number;
}

export const systemClock: Clock = { now: () => new Date() };

export function frozenClock(at: Date): Clock {
  const timestamp = at.getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError("Invalid clock instant.");
  return { now: () => new Date(timestamp) };
}

/**
 * Phase 1 supports the process time zone only, preserving the existing Date
 * arithmetic. A different workspace time zone needs a separate implementation;
 * reject it rather than silently interpreting its days in the process zone.
 * Configure TZ before construction and keep it fixed for the process lifetime.
 */
export function calendarFor(timeZone: string): Calendar {
  const canonical = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
  const processZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (canonical !== processZone) {
    throw new RangeError("Calendar time zone must match the process time zone.");
  }
  const startOf = (day: LocalDay) => {
    const date = parseLocalDate(day);
    if (!date || localDateKey(date) !== day) throw new RangeError("Invalid local day.");
    return date;
  };
  const dayOf = (instant: Date): LocalDay => {
    const key = localDateKey(instant);
    if (!parseLocalDate(key)) throw new RangeError("Invalid calendar instant.");
    return key as LocalDay;
  };
  return {
    timeZone: canonical,
    dayOf,
    startOf,
    addDays: (day, days) => dayOf(addDays(startOf(day), days)),
    reviewPeriodEnding: (day) => reviewPeriodRange(startOf(day)),
    sameDay: (day) => sameDayRange(startOf(day)),
    millisecondsUntilNextDay: millisecondsUntilNextLocalDay
  };
}

// Legacy helpers keep optional times only for existing zero-argument callers.
export function startOfLocalDay(input = new Date()) {
  const date = new Date(input);
  // Process-local civil time: DST gaps/folds follow Date.setHours semantics.
  date.setHours(0, 0, 0, 0);
  return date;
}

export function parseLocalDate(value: unknown) {
  const text = String(value ?? "");
  const localDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (localDate) {
    const year = Number(localDate[1]);
    const month = Number(localDate[2]) - 1;
    const day = Number(localDate[3]);
    if (!isCalendarDate(year, month, day)) return null;
    const date = startOfLocalDay(new Date(year, month, day));
    return date;
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})$/.exec(
    text
  );
  if (!isoDate) return null;
  if (
    !isCalendarDate(
      Number(isoDate[1]),
      Number(isoDate[2]) - 1,
      Number(isoDate[3])
    )
  ) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : startOfLocalDay(date);
}

function isCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
  );
}

export function addDays(input: Date, days: number) {
  const date = new Date(input);
  // Calendar days, not 24-hour durations: DST days may span 23 or 25 hours.
  date.setDate(date.getDate() + days);
  return date;
}

export function dateKey(input: Date) {
  return startOfLocalDay(input).toISOString();
}

export function localDateKey(input: Date) {
  const date = startOfLocalDay(input);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function sameDayRange(input: Date) {
  const start = startOfLocalDay(input);
  const end = addDays(start, 1);
  return { start, end };
}

export function reviewPeriodRange(input = new Date()) {
  const today = startOfLocalDay(input);
  return {
    start: addDays(today, -6),
    end: addDays(today, 1)
  };
}

export function millisecondsUntilNextLocalDay(input = new Date()) {
  return Math.max(
    0,
    addDays(startOfLocalDay(input), 1).getTime() - input.getTime()
  );
}
