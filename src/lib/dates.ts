export function startOfLocalDay(input = new Date()) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function parseLocalDate(value: unknown) {
  const text = String(value ?? "");
  const localDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (localDate) {
    return startOfLocalDay(
      new Date(Number(localDate[1]), Number(localDate[2]) - 1, Number(localDate[3]))
    );
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : startOfLocalDay(date);
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
