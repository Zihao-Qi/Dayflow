import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_IN_BACKFILL_DAYS,
  checkInWindow,
  parseCheckInMutation,
  parseHabitCreateMutation,
  parseHabitPatchMutation,
  targetForCadence
} from "../../src/modules/evidence/domain/habit";
import { addDays, localDateKey, startOfLocalDay } from "../../src/shared/kernel/calendar";
import { AppError } from "../../src/shared/kernel/errors";

const now = new Date("2026-09-14T09:30:00-05:00");
const today = startOfLocalDay(now);
const dayKey = (offset: number) => localDateKey(addDays(today, offset));

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    return error;
  }
  return assert.fail("expected the mutation to be rejected");
}

test("a Check-in defaults to today and keeps the local day boundary", () => {
  const mutation = parseCheckInMutation({}, now);
  assert.deepEqual(mutation.date, today);
  assert.equal(mutation.done, true);
});

test("the backfill window admits its oldest day and refuses the day before it", () => {
  // The pair is the control: neither assertion means anything alone, because a
  // parser that accepted everything would pass the first and one that refused
  // everything would pass the second.
  const oldest = parseCheckInMutation({ date: dayKey(-CHECK_IN_BACKFILL_DAYS) }, now);
  assert.deepEqual(oldest.date, addDays(today, -CHECK_IN_BACKFILL_DAYS));

  const tooOld = rejection(() =>
    parseCheckInMutation({ date: dayKey(-(CHECK_IN_BACKFILL_DAYS + 1)) }, now)
  ) as AppError;
  assert.equal(tooOld.status, 400);
  assert.equal(tooOld.field, "date");
  assert.match(tooOld.message, /last 7 days/);
});

test("a Check-in cannot be recorded for a future day", () => {
  const failure = rejection(() =>
    parseCheckInMutation({ date: dayKey(1) }, now)
  ) as AppError;
  assert.equal(failure.status, 400);
  assert.match(failure.message, /future/);
});

test("the window is reported as the same range the parser enforces", () => {
  const window = checkInWindow(now);
  assert.deepEqual(window.latest, today);
  assert.deepEqual(window.earliest, addDays(today, -CHECK_IN_BACKFILL_DAYS));
});

test("an absent amount stays null rather than becoming zero", () => {
  // Absent and zero are different claims: one is "no number given", the other
  // is "did none of it".
  assert.equal(parseCheckInMutation({}, now).amount, null);
  assert.equal(parseCheckInMutation({ amount: 0 }, now).amount, 0);
  assert.equal(parseCheckInMutation({ amount: 15 }, now).amount, 15);
});

test("done must be a boolean when given", () => {
  assert.equal(parseCheckInMutation({ done: false }, now).done, false);
  const failure = rejection(() => parseCheckInMutation({ done: "yes" }, now)) as AppError;
  assert.equal(failure.field, "done");
});

test("a daily Habit always targets seven days, whatever target was sent", () => {
  const daily = parseHabitCreateMutation({ name: "Stretch", cadence: "DAILY", targetPerWeek: 3 });
  assert.equal(daily.targetPerWeek, 7);
  assert.equal(targetForCadence("DAILY", 3), 7);
});

test("a times-per-week Habit keeps its own target", () => {
  const weekly = parseHabitCreateMutation({
    name: "Long run",
    cadence: "times_per_week",
    targetPerWeek: 3
  });
  assert.equal(weekly.cadence, "TIMES_PER_WEEK");
  assert.equal(weekly.targetPerWeek, 3);
});

test("a Habit defaults to daily when no cadence is given", () => {
  const habit = parseHabitCreateMutation({ name: "Read" });
  assert.equal(habit.cadence, "DAILY");
  assert.equal(habit.targetPerWeek, 7);
});

test("habit names are trimmed, required and bounded", () => {
  assert.equal(parseHabitCreateMutation({ name: "  Stretch  " }).name, "Stretch");
  assert.equal((rejection(() => parseHabitCreateMutation({ name: "   " })) as AppError).field, "name");
  assert.equal(
    (rejection(() => parseHabitCreateMutation({ name: "x".repeat(121) })) as AppError).field,
    "name"
  );
});

test("an out-of-range target is refused rather than clamped", () => {
  const failure = rejection(() =>
    parseHabitCreateMutation({ name: "Run", cadence: "TIMES_PER_WEEK", targetPerWeek: 9 })
  ) as AppError;
  assert.equal(failure.field, "targetPerWeek");
});

test("a patch that changes cadence to daily also corrects the stale target", () => {
  // Otherwise a Habit could claim DAILY while still targeting three days.
  const patch = parseHabitPatchMutation({ cadence: "DAILY" });
  assert.equal(patch.cadence, "DAILY");
  assert.equal(patch.targetPerWeek, 7);
});

test("a patch carries only the fields it was given", () => {
  assert.deepEqual(parseHabitPatchMutation({ name: "Walk" }), { name: "Walk" });
  assert.deepEqual(parseHabitPatchMutation({}), {});
});
