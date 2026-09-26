import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDayState,
  generateDateRange
} from "../../src/modules/evidence/ui/use-habit-history";
import type {
  HabitHistoryCheckIn,
  HabitHistoryDefinition,
  HabitHistoryPayload,
  HabitCheckInReconciliation
} from "../../src/modules/evidence/ui/history-api";

const habitActive: HabitHistoryDefinition = {
  id: "h-active",
  name: "Morning Stretch",
  cadence: "DAILY",
  targetPerWeek: 7,
  status: "ACTIVE",
  sortOrder: 0,
  createdAt: "2026-09-20T00:00:00.000Z",
  archivedAt: null,
  createdDay: "2026-09-20",
  archivedDay: null
};

const habitArchived: HabitHistoryDefinition = {
  id: "h-archived",
  name: "Old Reading",
  cadence: "TIMES_PER_WEEK",
  targetPerWeek: 3,
  status: "ARCHIVED",
  sortOrder: 1,
  createdAt: "2026-09-15T00:00:00.000Z",
  archivedAt: "2026-09-23T12:00:00.000Z",
  createdDay: "2026-09-15",
  archivedDay: "2026-09-23"
};

test("computeDayState identifies all four states correctly", () => {
  const doneCheckIn: HabitHistoryCheckIn = {
    id: "c-1",
    habitId: "h-active",
    date: "2026-09-26T00:00:00.000Z",
    day: "2026-09-26",
    done: true,
    amount: 10,
    note: "Great"
  };
  const notDoneCheckIn: HabitHistoryCheckIn = {
    id: "c-2",
    habitId: "h-active",
    date: "2026-09-25T00:00:00.000Z",
    day: "2026-09-25",
    done: false,
    amount: null,
    note: null
  };

  // Explicit done and notDone
  assert.equal(computeDayState(habitActive, "2026-09-26", doneCheckIn), "done");
  assert.equal(computeDayState(habitActive, "2026-09-25", notDoneCheckIn), "notDone");

  // In-lifetime absence -> unrecorded
  assert.equal(computeDayState(habitActive, "2026-09-24", undefined), "unrecorded");
  assert.equal(computeDayState(habitArchived, "2026-09-22", undefined), "unrecorded");

  // Pre-creation absence -> outOfScope
  assert.equal(computeDayState(habitActive, "2026-09-19", undefined), "outOfScope");

  // Post-archival absence -> outOfScope
  assert.equal(computeDayState(habitArchived, "2026-09-24", undefined), "outOfScope");
});

test("pre-creation and post-archival explicit check-ins override outOfScope", () => {
  const preCreationCheckIn: HabitHistoryCheckIn = {
    id: "c-pre",
    habitId: "h-active",
    date: "2026-09-19T00:00:00.000Z",
    day: "2026-09-19", // Prior to creation day 2026-09-20
    done: true,
    amount: 5,
    note: "Early evidence"
  };

  const postArchiveCheckIn: HabitHistoryCheckIn = {
    id: "c-post",
    habitId: "h-archived",
    date: "2026-09-24T00:00:00.000Z",
    day: "2026-09-24", // After archival day 2026-09-23
    done: false,
    amount: null,
    note: "Recorded miss"
  };

  assert.equal(computeDayState(habitActive, "2026-09-19", preCreationCheckIn), "done");
  assert.equal(computeDayState(habitArchived, "2026-09-24", postArchiveCheckIn), "notDone");
});

test("date range generator adheres to eight-day boundary strictly", () => {
  const dates = generateDateRange("2026-09-19", "2026-09-26");
  assert.equal(dates.length, 8);
  assert.equal(dates[0], "2026-09-19"); // earliest (today - 7)
  assert.equal(dates[7], "2026-09-26"); // latest (today)
});
