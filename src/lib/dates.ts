export function startOfLocalDay(input = new Date()) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
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
