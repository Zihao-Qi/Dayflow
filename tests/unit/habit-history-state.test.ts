import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDayState,
  generateDateRange,
  type HabitHistoryDayState
} from "../../src/modules/evidence/ui/use-habit-history";
import type {
  HabitHistoryCheckIn,
  HabitHistoryDefinition
} from "../../src/modules/evidence/ui/history-api";

const habitActive: HabitHistoryDefinition = {
  id: "h-active",
  name: "Water Plants",
  cadence: "DAILY",
  targetPerWeek: 7,
  status: "ACTIVE",
  sortOrder: 0,
  createdAt: "2026-09-22T00:00:00.000Z",
  archivedAt: null,
  createdDay: "2026-09-22",
  archivedDay: null
};

const habitArchived: HabitHistoryDefinition = {
  id: "h-archived",
  name: "Running",
  cadence: "TIMES_PER_WEEK",
  targetPerWeek: 4,
  status: "ARCHIVED",
  sortOrder: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  archivedAt: "2026-09-24T12:00:00.000Z",
  createdDay: "2026-09-10",
  archivedDay: "2026-09-24"
};

test("computeDayState identifies explicit done and notDone records", () => {
  const checkInDone: HabitHistoryCheckIn = {
    id: "c-1",
    habitId: "h-active",
    date: "2026-09-25T00:00:00.000Z",
    day: "2026-09-25",
    done: true,
    amount: null,
    note: null
  };
  const checkInNotDone: HabitHistoryCheckIn = {
    id: "c-2",
    habitId: "h-active",
    date: "2026-09-24T00:00:00.000Z",
    day: "2026-09-24",
    done: false,
    amount: null,
    note: null
  };

  assert.equal(computeDayState(habitActive, "2026-09-25", checkInDone), "done");
  assert.equal(computeDayState(habitActive, "2026-09-24", checkInNotDone), "notDone");
});

test("computeDayState distinguishes unrecorded in-lifetime from outOfScope outside lifetime", () => {
  // Day before active habit was created: outOfScope
  assert.equal(computeDayState(habitActive, "2026-09-21", undefined), "outOfScope");

  // Day after active habit was created: unrecorded
  assert.equal(computeDayState(habitActive, "2026-09-23", undefined), "unrecorded");

  // Day before archived habit was archived: unrecorded
  assert.equal(computeDayState(habitArchived, "2026-09-23", undefined), "unrecorded");

  // Day after archived habit was archived: outOfScope
  assert.equal(computeDayState(habitArchived, "2026-09-25", undefined), "outOfScope");
});

test("generateDateRange produces exactly eight dates for eight-day backfill window", () => {
  const dates = generateDateRange("2026-09-19", "2026-09-26");
  assert.equal(dates.length, 8);
  assert.deepEqual(dates, [
    "2026-09-19",
    "2026-09-20",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26"
  ]);
});
