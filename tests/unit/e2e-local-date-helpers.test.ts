import assert from "node:assert/strict";
import test from "node:test";
import { shiftLocalDay } from "../e2e/activity-date-helpers";

function localParts(value: string) {
  const date = new Date(value);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes()
  };
}

for (const [label, source] of [
  ["ordinary day", new Date(2026, 1, 10).toISOString()],
  ["fall-back day", new Date(2026, 10, 1).toISOString()],
  ["spring-forward day", new Date(2027, 2, 14).toISOString()]
] as const) {
  test(`shiftLocalDay advances one local midnight across ${label}`, () => {
    const before = localParts(source);
    const actual = localParts(shiftLocalDay(source));
    const expected = new Date(before.year, before.month - 1, before.day + 1);

    assert.deepEqual(actual, {
      year: expected.getFullYear(),
      month: expected.getMonth() + 1,
      day: expected.getDate(),
      hour: 0,
      minute: 0
    });
  });
}
