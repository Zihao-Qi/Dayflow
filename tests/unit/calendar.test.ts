import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarFor,
  frozenClock,
  type LocalDay
} from "../../src/shared/kernel/calendar";

const calendar = calendarFor("America/Chicago");

test("frozen clocks isolate their instant from caller mutations", () => {
  const at = new Date("2026-09-04T04:59:59.999Z");
  const clock = frozenClock(at);
  at.setFullYear(2000);
  clock.now().setFullYear(2001);
  assert.equal(clock.now().toISOString(), "2026-09-04T04:59:59.999Z");
  assert.equal(calendar.dayOf(clock.now()), "2026-09-03");
  assert.throws(() => frozenClock(new Date(NaN)), RangeError);
});

test("calendar days preserve Chicago DST boundaries and review windows", () => {
  const spring = calendar.dayOf(new Date("2026-03-08T12:00:00-05:00"));
  const fall = calendar.dayOf(new Date("2026-11-01T12:00:00-06:00"));
  for (const [day, hours] of [[spring, 23], [fall, 25]] as const) {
    const { start, end } = calendar.sameDay(day);
    assert.equal((end.getTime() - start.getTime()) / 3_600_000, hours);
    assert.equal(calendar.millisecondsUntilNextDay(start), hours * 3_600_000);
    assert.equal(calendar.dayOf(end), calendar.addDays(day, 1));
    assert.equal(calendar.addDays(calendar.addDays(day, 1), -1), day);
  }
  const period = calendar.reviewPeriodEnding(spring);
  assert.equal(period.start.toISOString(), "2026-03-02T06:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-03-09T05:00:00.000Z");
});

test("calendar arithmetic does not mutate inputs or return shared dates", () => {
  const instant = new Date("2026-12-31T23:30:00-06:00");
  const day = calendar.dayOf(instant);
  calendar.startOf(day).setFullYear(2000);
  assert.equal(calendar.addDays(day, 1), "2027-01-01");
  assert.equal(calendar.startOf(day).toISOString(), "2026-12-31T06:00:00.000Z");
  assert.equal(instant.toISOString(), "2027-01-01T05:30:00.000Z");
});

test("calendar rejects invalid days and unsupported process-zone mismatches", () => {
  assert.equal(calendar.timeZone, "America/Chicago");
  assert.throws(() => calendar.startOf("2026-02-30" as LocalDay), RangeError);
  assert.throws(() => calendar.dayOf(new Date(NaN)), RangeError);
  assert.throws(() => calendarFor("UTC"), RangeError);
  assert.throws(() => calendarFor("Invalid/Zone"), RangeError);
});
