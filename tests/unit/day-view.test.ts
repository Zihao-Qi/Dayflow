import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_VIEW_FORWARD_WEEKS,
  DayViewRequestError,
  classifyDay,
  parseViewedDay
} from "../../src/lib/day-view";

const now = new Date(2026, 7, 23, 10, 30);
const params = (q: string) => new URLSearchParams(q);

function rejection(q: string) {
  try {
    parseViewedDay(params(q), now);
  } catch (error) {
    assert.ok(error instanceof DayViewRequestError);
    return error;
  }
  throw new assert.AssertionError({ message: `expected "${q}" to be rejected` });
}

test("an absent day means today", () => {
  const resolved = parseViewedDay(params(""), now);
  assert.equal(resolved.kind, "today");
  assert.equal(resolved.date.getTime(), new Date(2026, 7, 23).getTime());
});

test("days are classified against the local day, not the instant", () => {
  const lateToday = new Date(2026, 7, 23, 23, 59, 59);
  assert.equal(classifyDay(new Date(2026, 7, 23), lateToday), "today");
  assert.equal(classifyDay(new Date(2026, 7, 22), lateToday), "past");
  assert.equal(classifyDay(new Date(2026, 7, 24), lateToday), "future");
});

test("a real calendar date resolves to its own kind", () => {
  assert.equal(parseViewedDay(params("date=2026-08-22"), now).kind, "past");
  assert.equal(parseViewedDay(params("date=2026-08-23"), now).kind, "today");
  assert.equal(parseViewedDay(params("date=2026-08-24"), now).kind, "future");
});

test("the forward horizon is exactly eight weeks and is rejected, never clamped", () => {
  const horizon = new Date(2026, 7, 23 + DAY_VIEW_FORWARD_WEEKS * 7);
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  // The last allowed day resolves.
  assert.equal(parseViewedDay(params(`date=${key(horizon)}`), now).kind, "future");

  // One day past it is refused rather than silently showing a nearer day.
  const beyond = new Date(horizon.getTime());
  beyond.setDate(beyond.getDate() + 1);
  const error = rejection(`date=${key(beyond)}`);
  assert.equal(error.field, "date");
  assert.match(error.message, /8 weeks ahead/);
});

test("the past is not bounded by the horizon", () => {
  assert.equal(parseViewedDay(params("date=2020-01-01"), now).kind, "past");
});

test("malformed days are rejected with a typed field error", () => {
  for (const q of [
    "date=",
    "date=tomorrow",
    "date=2026-8-3",
    "date=20260823",
    "date=2026-02-30",
    "date=2026-13-01",
    "date=2026-08-23&date=2026-08-24"
  ]) {
    const error = rejection(q);
    assert.equal(error.code, "VALIDATION_ERROR", q);
    assert.equal(error.field, "date", q);
    assert.ok(!/sqlite|prisma/i.test(error.message), q);
  }
});
