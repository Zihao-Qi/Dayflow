import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_IN_BACKFILL_DAYS,
  checkInWindow,
  parseCheckInMutation,
  parseHabitCreateMutation,
  parseHabitPatchMutation,
  summarizeHabits,
  targetForCadence,
  type CheckInRecord,
  type HabitDefinition
} from "../../src/modules/evidence/domain/habit";
import { addDays, localDateKey, startOfLocalDay } from "../../src/shared/kernel/calendar";
import { AppError } from "../../src/shared/kernel/errors";
import { isHabitSummaryRecord, type HabitSummaryRecord } from "../../src/shared/client/decoders";

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

test("an absent amount stays undefined or null rather than becoming zero", () => {
  // Absent and zero are different claims: one is "no number given", the other
  // is "did none of it". Omitted from payload stays undefined to preserve
  // existing stored evidence; explicit null clears it.
  assert.equal(parseCheckInMutation({}, now).amount, undefined);
  assert.equal(parseCheckInMutation({ amount: null }, now).amount, null);
  assert.equal(parseCheckInMutation({ amount: 0 }, now).amount, 0);
  assert.equal(parseCheckInMutation({ amount: 15 }, now).amount, 15);
  assert.equal(parseCheckInMutation({}, now).note, undefined);
  assert.equal(parseCheckInMutation({ note: null }, now).note, null);
  assert.equal(parseCheckInMutation({ note: "stretch" }, now).note, "stretch");
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

const periodStart = addDays(today, -3);

function definition(overrides: Partial<HabitDefinition> = {}): HabitDefinition {
  return {
    id: "habit-1",
    name: "Stretch",
    cadence: "DAILY",
    targetPerWeek: 7,
    sortOrder: 0,
    createdAt: addDays(periodStart, -30),
    archivedAt: null,
    ...overrides
  };
}

function record(dayOffset: number, overrides: Partial<CheckInRecord> = {}): CheckInRecord {
  return {
    habitId: "habit-1",
    date: addDays(periodStart, dayOffset),
    done: true,
    amount: null,
    note: null,
    ...overrides
  };
}

test("an unrecorded day and a recorded miss are different states", () => {
  // Both may read as a miss to a user, but the summary has to keep them apart:
  // this is the whole reason absence is not stored as failure.
  const [summary] = summarizeHabits(
    [definition()],
    [record(0, { done: false })],
    periodStart,
    today
  );
  assert.equal(summary.days[0].state, "notDone");
  assert.equal(summary.days[1].state, "unrecorded");
});

test("days that have not happened yet are out of scope, not misses", () => {
  const [summary] = summarizeHabits([definition()], [], periodStart, today);
  // periodStart is three days ago, so days 0..3 are in scope and 4..6 are not.
  assert.deepEqual(
    summary.days.map((day) => day.state),
    ["unrecorded", "unrecorded", "unrecorded", "unrecorded", "outOfScope", "outOfScope", "outOfScope"]
  );
  assert.equal(summary.target, 4);
});

test("days before the Habit existed never count against it", () => {
  const [summary] = summarizeHabits(
    [definition({ createdAt: addDays(periodStart, 2) })],
    [],
    periodStart,
    today
  );
  assert.deepEqual(summary.days.slice(0, 2).map((day) => day.state), ["outOfScope", "outOfScope"]);
  // Only the two elapsed days since creation are countable.
  assert.equal(summary.target, 2);
});

test("days after a Habit was archived are not counted as misses", () => {
  // A Habit archived mid-period stops being an obligation. Counting the rest
  // of the week as unrecorded invents misses for days it could not be done:
  // the mirror of the rule that days before it existed never count.
  const [summary] = summarizeHabits(
    [definition({ archivedAt: addDays(periodStart, 1) })],
    [record(0)],
    periodStart,
    today
  );
  assert.deepEqual(
    summary.days.slice(2, 4).map((day) => day.state),
    ["outOfScope", "outOfScope"]
  );
  assert.equal(summary.target, 2, "only the days it was active can be required");
});

test("a times-per-week target can never exceed the capacity days available to meet it", () => {
  // Target capacity is the union of Habit Lifetime days and explicit Check-in Evidence.
  // A Habit whose lifetime inside the window is limited cannot be expected to exceed its capacity.
  const [summary] = summarizeHabits(
    [
      definition({
        cadence: "TIMES_PER_WEEK",
        targetPerWeek: 5,
        createdAt: addDays(periodStart, 2)
      })
    ],
    [],
    periodStart,
    today
  );
  assert.ok(
    summary.target <= summary.days.filter((day) => day.state !== "outOfScope").length,
    `target ${summary.target} exceeds the available days`
  );
});

test("explicit out-of-lifetime Check-ins contribute unique capacity days to Habit Target Capacity", () => {
  // An active habit created two days ago has three in-window lifetime days.
  // An explicit pre-creation Check-in contributes a unique capacity day, expanding capacity.
  const habit = definition({
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 5,
    createdAt: addDays(periodStart, 2)
  });
  const checkIn = record(0); // Dated before createdAt: adds unique capacity day
  const [summary] = summarizeHabits([habit], [checkIn], periodStart, today);
  const capacityDays = summary.days.filter((d) => d.state !== "outOfScope").length;
  assert.equal(capacityDays, 3); // day 0 (pre-creation record) + days 2, 3 (lifetime days)
  assert.equal(summary.target, 3); // min(5, 3) = 3
  assert.equal(summary.doneCount, 1);
  assert.equal(summary.days[0].state, "done");
  assert.equal(summary.days[1].state, "outOfScope");
});

test("a daily Habit's target grows with the period", () => {
  const [summary] = summarizeHabits(
    [definition()],
    [record(0), record(1)],
    periodStart,
    today
  );
  assert.equal(summary.doneCount, 2);
  assert.equal(summary.target, 4);
});

test("a times-per-week Habit target scales to in-scope capacity over the rolling review geometry", () => {
  // Over a rolling seven-day window ending on the as-of day, the effective target
  // is min(targetPerWeek, capacityDays), where capacity is the union of Habit Lifetime
  // days and explicit Evidence dates.
  const [summary] = summarizeHabits(
    [definition({ cadence: "TIMES_PER_WEEK", targetPerWeek: 3 })],
    [record(0)],
    periodStart,
    today
  );
  assert.equal(summary.target, 3);
  assert.equal(summary.doneCount, 1);
});

test("today's own record is surfaced separately", () => {
  const todayOffset = 3;
  const [summary] = summarizeHabits(
    [definition()],
    [record(todayOffset, { amount: 12, note: "done early" })],
    periodStart,
    today
  );
  assert.deepEqual(summary.today, { done: true, amount: 12, note: "done early" });
});

test("a Habit with no record today reports no state for today", () => {
  const [summary] = summarizeHabits([definition()], [record(0)], periodStart, today);
  assert.equal(summary.today, null);
});

test("each Habit only sees its own Check-ins", () => {
  const summaries = summarizeHabits(
    [definition(), definition({ id: "habit-2", name: "Walk" })],
    [record(0), { ...record(1), habitId: "habit-2" }],
    periodStart,
    today
  );
  assert.equal(summaries[0].doneCount, 1);
  assert.equal(summaries[1].doneCount, 1);
  assert.equal(summaries[0].days[1].state, "unrecorded");
});

test("isHabitSummaryRecord validates complete declared DTO fields and rejects malformed records", () => {
  const valid: HabitSummaryRecord = {
    id: "habit-1",
    name: "Read",
    cadence: "DAILY",
    targetPerWeek: 7,
    sortOrder: 0,
    doneCount: 1,
    target: 7,
    today: { done: true, amount: 20, note: "chapter 1" },
    days: [
      { day: "2026-09-14", state: "done", amount: 20 }
    ]
  };
  assert.equal(isHabitSummaryRecord(valid), true);

  // Missing cadence
  const { cadence: _, ...missingCadence } = valid;
  assert.equal(isHabitSummaryRecord(missingCadence), false);

  // Invalid cadence
  assert.equal(isHabitSummaryRecord({ ...valid, cadence: "MONTHLY" as unknown as "DAILY" }), false);

  // Missing targetPerWeek
  const { targetPerWeek: __, ...missingTargetPerWeek } = valid;
  assert.equal(isHabitSummaryRecord(missingTargetPerWeek), false);

  // Non-integer sortOrder
  assert.equal(isHabitSummaryRecord({ ...valid, sortOrder: 1.5 }), false);

  // Invalid today (missing done, or non-integer amount)
  assert.equal(isHabitSummaryRecord({ ...valid, today: { done: "yes" as unknown as boolean, amount: null, note: null } }), false);
  assert.equal(isHabitSummaryRecord({ ...valid, today: { done: true, amount: 12.3, note: null } }), false);

  // Valid today with nulls or null today
  assert.equal(isHabitSummaryRecord({ ...valid, today: { done: false, amount: null, note: null } }), true);
  assert.equal(isHabitSummaryRecord({ ...valid, today: null }), true);

  // Invalid day in days
  assert.equal(isHabitSummaryRecord({ ...valid, days: [{ day: "2026-09-14", state: "done", amount: 1.5 }] }), false);
  assert.equal(isHabitSummaryRecord({ ...valid, days: [{ day: "2026-09-14", state: "unknown" as unknown as "done", amount: null }] }), false);
});
