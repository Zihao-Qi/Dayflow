import assert from "node:assert/strict";
import test from "node:test";
import {
  isHabitHistoryPayload,
  isHabitCheckInReconciliation,
  fetchHabitHistory,
  fetchHabitCheckInDate,
  type HabitHistoryPayload,
  type HabitCheckInReconciliation
} from "../../src/modules/evidence/ui/history-api";

const validPayload: HabitHistoryPayload = {
  todayKey: "2026-09-26",
  earliestDate: "2026-09-19",
  latestDate: "2026-09-26",
  habits: [
    {
      id: "habit-active-1",
      name: "Morning Stretch",
      cadence: "DAILY",
      targetPerWeek: 7,
      status: "ACTIVE",
      sortOrder: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
      archivedAt: null,
      createdDay: "2026-09-01",
      archivedDay: null
    },
    {
      id: "habit-archived-1",
      name: "Old Habit",
      cadence: "TIMES_PER_WEEK",
      targetPerWeek: 3,
      status: "ARCHIVED",
      sortOrder: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      archivedAt: "2026-09-20T12:00:00.000Z",
      createdDay: "2026-08-01",
      archivedDay: "2026-09-20"
    }
  ],
  checkIns: [
    {
      id: "checkin-1",
      habitId: "habit-active-1",
      date: "2026-09-26T00:00:00.000Z",
      day: "2026-09-26",
      done: true,
      amount: 15,
      note: "Stretched 15 mins"
    },
    {
      id: "checkin-2",
      habitId: "habit-active-1",
      date: "2026-09-25T00:00:00.000Z",
      day: "2026-09-25",
      done: false,
      amount: null,
      note: null
    },
    {
      id: "checkin-3",
      habitId: "habit-archived-1",
      date: "2026-09-19T00:00:00.000Z",
      day: "2026-09-19",
      done: true,
      amount: 0, // Zero is a valid amount, must not be coerced to null
      note: ""
    }
  ]
};

const validReconciliation: HabitCheckInReconciliation = {
  todayKey: "2026-09-26",
  earliestDate: "2026-09-19",
  latestDate: "2026-09-26",
  habitId: "habit-active-1",
  date: "2026-09-18", // Allowed to be outside write window for reconciliation
  checkIn: {
    id: "checkin-old",
    habitId: "habit-active-1",
    date: "2026-09-18T00:00:00.000Z",
    day: "2026-09-18",
    done: true,
    amount: null,
    note: "Prior day"
  }
};

test("isHabitHistoryPayload validates pinned contract structure", () => {
  assert.equal(isHabitHistoryPayload(validPayload), true);
  assert.equal(isHabitHistoryPayload({ ...validPayload, todayKey: "2026/09/26" }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, habits: [{ ...validPayload.habits[0], cadence: "MONTHLY" }] }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, habits: [{ ...validPayload.habits[0], status: "DELETED" }] }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, habits: [{ ...validPayload.habits[0], targetPerWeek: 8 }] }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, checkIns: [{ ...validPayload.checkIns[0], done: "true" }] }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, checkIns: [{ ...validPayload.checkIns[0], amount: -1 }] }), false);
  assert.equal(isHabitHistoryPayload({ ...validPayload, checkIns: [{ ...validPayload.checkIns[0], amount: 1.5 }] }), false);
});

test("isHabitHistoryPayload preserves zero amount and empty string note", () => {
  const zeroAmountCheckIn = validPayload.checkIns.find((c) => c.amount === 0);
  assert.ok(zeroAmountCheckIn);
  assert.equal(zeroAmountCheckIn.amount, 0);
  assert.equal(isHabitHistoryPayload(validPayload), true);
});

test("isHabitCheckInReconciliation accepts populated or null checkIn record", () => {
  assert.equal(isHabitCheckInReconciliation(validReconciliation), true);
  assert.equal(isHabitCheckInReconciliation({ ...validReconciliation, checkIn: null }), true);
  assert.equal(isHabitCheckInReconciliation({ ...validReconciliation, date: "not-a-date" }), false);
  assert.equal(isHabitCheckInReconciliation({ ...validReconciliation, habitId: "" }), false);
});

test("fetchHabitHistory and fetchHabitCheckInDate call correct endpoints and decode", async (t) => {
  const calls: Array<{ path: unknown; init: RequestInit | undefined }> = [];
  t.mock.method(globalThis, "fetch", async (path: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path, init });
    if (typeof path === "string" && path === "/api/habits/history") {
      return Response.json(validPayload);
    }
    if (typeof path === "string" && path.startsWith("/api/habits/h-1/check-in?date=2026-09-20")) {
      return Response.json({ ...validReconciliation, habitId: "h-1", date: "2026-09-20" });
    }
    return new Response("Not found", { status: 404 });
  });

  const history = await fetchHabitHistory();
  assert.deepEqual(history, validPayload);
  assert.equal(calls[0].path, "/api/habits/history");

  const reconciliation = await fetchHabitCheckInDate("h-1", "2026-09-20");
  assert.equal(reconciliation.habitId, "h-1");
  assert.equal(reconciliation.date, "2026-09-20");
  assert.equal(calls[1].path, "/api/habits/h-1/check-in?date=2026-09-20");
});
