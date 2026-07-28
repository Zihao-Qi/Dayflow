export function startOfLocalDay(input = new Date()) {
  const date = new Date(input);
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
  date.setDate(date.getDate() + days);
  return date;
}

export function dateKey(input = new Date()) {
  return startOfLocalDay(input).toISOString();
}

export function sameDayRange(input = new Date()) {
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
