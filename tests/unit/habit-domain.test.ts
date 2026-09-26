import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHabitReorder,
  CHECK_IN_BACKFILL_DAYS,
  checkInWindow,
  describeHabitMove,
  habitHistoryBounds,
  parseCheckInMutation,
  parseHistoryCheckInDate,
  parseHabitCreateMutation,
  parseHabitIdArray,
  parseHabitPatchMutation,
  parseHabitReorderMutation,
  sameOrder,
  summarizeHabits,
  targetForCadence,
  type CheckInRecord,
  type HabitDefinition
} from "../../src/modules/evidence/domain/habit";
import { addDays, calendarFor, localDateKey, startOfLocalDay } from "../../src/shared/kernel/calendar";
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

test("a times-per-week Habit retains its stored target when capacity is full", () => {
  const reviewStart = addDays(today, -6);
  const [summary] = summarizeHabits(
    [
      definition({
        cadence: "TIMES_PER_WEEK",
        targetPerWeek: 5,
        createdAt: reviewStart
      })
    ],
    [],
    reviewStart,
    today
  );
  const capacity = summary.days.filter((day) => day.state !== "outOfScope").length;
  assert.equal(capacity, 7);
  assert.equal(summary.target, 5);
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

test("a times-per-week target cannot exceed union capacity including pre-creation Check-ins", () => {
  const reviewStart = addDays(today, -6);
  const habit = definition({
    id: "habit-today",
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 5,
    createdAt: today
  });
  const evidenceDate = reviewStart;
  const checkIn: CheckInRecord = {
    habitId: "habit-today",
    date: evidenceDate,
    done: true,
    amount: null,
    note: null
  };
  const [summary] = summarizeHabits([habit], [checkIn], reviewStart, today);
  const capacity = summary.days.filter((day) => day.state !== "outOfScope").length;
  assert.equal(capacity, 2);
  assert.equal(summary.target, 2);
  assert.equal(summary.doneCount, 1);
  const evidenceDay = summary.days.find((day) => day.day === localDateKey(evidenceDate));
  assert.equal(evidenceDay?.state, "done");
  const todayDay = summary.days.find((day) => day.day === localDateKey(today));
  assert.equal(todayDay?.state, "unrecorded");
  const missingPreCreationDay = summary.days.find(
    (day) => day.day === localDateKey(addDays(reviewStart, 1))
  );
  assert.equal(missingPreCreationDay?.state, "outOfScope");
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

test("parseHabitIdArray rejects non-arrays, duplicates, bounds violations, and invalid IDs", () => {
  // Non-array
  const nonArrayIds = rejection(() => parseHabitIdArray("habit-1", "ids")) as AppError;
  assert.equal(nonArrayIds.status, 400);
  assert.equal(nonArrayIds.field, "ids");
  assert.match(nonArrayIds.message, /must be an array/);

  const nonArrayExpected = rejection(() => parseHabitIdArray(null, "expectedIds")) as AppError;
  assert.equal(nonArrayExpected.status, 400);
  assert.equal(nonArrayExpected.field, "expectedIds");
  assert.match(nonArrayExpected.message, /must be an array/);

  // Duplicates
  const duplicateIds = rejection(() => parseHabitIdArray(["h1", "h2", "h1"], "ids")) as AppError;
  assert.equal(duplicateIds.status, 400);
  assert.equal(duplicateIds.field, "ids");
  assert.match(duplicateIds.message, /must not contain duplicates/);

  // Over max bounds (> 1,000 items)
  const hugeArray = Array.from({ length: 1_001 }, (_, i) => `h-${i}`);
  const overMax = rejection(() => parseHabitIdArray(hugeArray, "ids")) as AppError;
  assert.equal(overMax.status, 400);
  assert.equal(overMax.field, "ids");
  assert.match(overMax.message, /No more than 1,000/);

  // Invalid ID string (empty or control chars)
  const emptyId = rejection(() => parseHabitIdArray(["h1", "   "], "ids")) as AppError;
  assert.equal(emptyId.status, 400);
  assert.equal(emptyId.field, "ids");
  assert.match(emptyId.message, /identifier is invalid/);

  const controlCharId = rejection(() => parseHabitIdArray(["h1", "h2\u0000"], "ids")) as AppError;
  assert.equal(controlCharId.status, 400);
  assert.equal(controlCharId.field, "ids");

  // Valid array
  assert.deepEqual(parseHabitIdArray(["h1", "h2"], "ids"), ["h1", "h2"]);
  assert.deepEqual(parseHabitIdArray([], "ids"), []);
});

test("parseHabitReorderMutation validates body object and required array fields", () => {
  const notObject = rejection(() => parseHabitReorderMutation("not an object")) as AppError;
  assert.equal(notObject.status, 400);
  assert.equal(notObject.field, "body");

  const missingIds = rejection(() => parseHabitReorderMutation({ expectedIds: ["h1"] })) as AppError;
  assert.equal(missingIds.status, 400);
  assert.equal(missingIds.field, "ids");

  const missingExpectedIds = rejection(() => parseHabitReorderMutation({ ids: ["h1"] })) as AppError;
  assert.equal(missingExpectedIds.status, 400);
  assert.equal(missingExpectedIds.field, "expectedIds");

  const valid = parseHabitReorderMutation({ ids: ["h2", "h1"], expectedIds: ["h1", "h2"] });
  assert.deepEqual(valid, { ids: ["h2", "h1"], expectedIds: ["h1", "h2"] });
});

test("sameOrder checks positional equality of ID arrays", () => {
  assert.equal(sameOrder(["a", "b", "c"], ["a", "b", "c"]), true);
  assert.equal(sameOrder(["a", "b", "c"], ["b", "a", "c"]), false);
  assert.equal(sameOrder(["a", "b"], ["a", "b", "c"]), false);
  assert.equal(sameOrder([], []), true);
});

test("assertHabitReorder verifies CAS match, membership permutation, and empty active list", () => {
  // Matching permutation succeeds
  assert.doesNotThrow(() => {
    assertHabitReorder(["h1", "h2", "h3"], ["h3", "h1", "h2"], ["h1", "h2", "h3"]);
  });

  // Empty arrays are a no-op only for an empty active list
  assert.doesNotThrow(() => {
    assertHabitReorder([], [], []);
  });

  // Empty requested array when active habits exist throws 409
  const emptyWhenActive = rejection(() => {
    assertHabitReorder(["h1"], [], ["h1"]);
  }) as AppError;
  assert.equal(emptyWhenActive.status, 409);
  assert.equal(emptyWhenActive.code, "CONFLICT");
  assert.match(emptyWhenActive.message, /out of date/);

  // Set equality alone fails when expectedIds has stale/wrong order
  // currentIds and expectedIds have identical set {h1, h2, h3}, but different order
  const staleExpectedOrder = rejection(() => {
    assertHabitReorder(["h1", "h2", "h3"], ["h2", "h1", "h3"], ["h2", "h1", "h3"]);
  }) as AppError;
  assert.equal(staleExpectedOrder.status, 409);
  assert.equal(staleExpectedOrder.code, "CONFLICT");

  // Intervening create: currentIds has 3 items, expectedIds only knows 2
  const interveningCreate = rejection(() => {
    assertHabitReorder(["h1", "h2", "h3"], ["h2", "h1"], ["h1", "h2"]);
  }) as AppError;
  assert.equal(interveningCreate.status, 409);
  assert.equal(interveningCreate.code, "CONFLICT");

  // Intervening archive: currentIds has 2 items, expectedIds has 3
  const interveningArchive = rejection(() => {
    assertHabitReorder(["h1", "h2"], ["h2", "h1", "h3"], ["h1", "h2", "h3"]);
  }) as AppError;
  assert.equal(interveningArchive.status, 409);
  assert.equal(interveningArchive.code, "CONFLICT");

  // Foreign or missing ID in requested ids
  const foreignId = rejection(() => {
    assertHabitReorder(["h1", "h2"], ["h1", "h_foreign"], ["h1", "h2"]);
  }) as AppError;
  assert.equal(foreignId.status, 409);
  assert.equal(foreignId.code, "CONFLICT");
});

test("history bounds stay eight local dates across DST", () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Chicago");
  const calendar = calendarFor("America/Chicago");
  const spring = habitHistoryBounds(calendar, new Date("2026-03-08T15:00:00Z"));
  assert.equal(spring.todayKey, "2026-03-08");
  assert.equal(spring.latestDate, spring.todayKey);
  assert.equal(spring.earliestDate, "2026-03-01", "eight-day window includes today-7");
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => calendar.addDays(spring.earliestDate, index)),
    ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]
  );
  assert.equal(spring.end.getTime() - spring.start.getTime(), 191 * 60 * 60 * 1000);

  const fall = habitHistoryBounds(calendar, new Date("2026-11-01T15:00:00Z"));
  assert.equal(fall.todayKey, "2026-11-01");
  assert.equal(fall.earliestDate, "2026-10-25", "eight-day window includes today-7");
  assert.equal(fall.end.getTime() - fall.start.getTime(), 193 * 60 * 60 * 1000);
});

test("history date parsing requires one explicit past-or-present local date", () => {
  const missing = new URLSearchParams();
  let missingDate: Date | undefined;
  let missingError: AppError | undefined;
  try {
    missingDate = parseHistoryCheckInDate(missing, now);
  } catch (error) {
    missingError = error as AppError;
  }
  assert.equal(missingDate, undefined, "missing date must not fall back to today");
  assert.equal(missingError?.status, 400);
  assert.equal(missingError?.field, "date");

  for (const query of ["date=", "date=yesterday", "date=2026-02-31", `date=${dayKey(0)}&date=${dayKey(-1)}`]) {
    const params = new URLSearchParams(query);
    let parsed: Date | undefined;
    let error: AppError | undefined;
    try {
      parsed = parseHistoryCheckInDate(params, now);
    } catch (caught) {
      error = caught as AppError;
    }
    assert.equal(parsed, undefined, query);
    assert.equal(error?.status, 400, query);
    assert.equal(error?.field, "date", query);
  }

  const future = rejection(() => parseHistoryCheckInDate(new URLSearchParams({ date: dayKey(1) }), now)) as AppError;
  assert.equal(future.status, 400);
  assert.equal(future.field, "date");

  let expired: Date | undefined;
  let expiredRejected = false;
  try {
    expired = parseHistoryCheckInDate(new URLSearchParams({ date: "2020-01-15" }), now);
  } catch {
    expiredRejected = true;
  }
  assert.equal(expiredRejected, false, "expired reconciliation date stays readable");
  assert.equal(expired && localDateKey(expired), "2020-01-15");
});

test("describeHabitMove formats position announcements and detects boundaries", () => {
  assert.equal(describeHabitMove("Reading", 1, 3), 'Moved "Reading" to position 2 of 3.');
  assert.equal(describeHabitMove("Reading", 0, 3), 'Moved "Reading" to position 1 of 3. Now first.');
  assert.equal(describeHabitMove("Reading", 2, 3), 'Moved "Reading" to position 3 of 3. Now last.');
  assert.equal(describeHabitMove("Reading", 0, 1), 'Moved "Reading" to position 1 of 1. Now first.');
});

