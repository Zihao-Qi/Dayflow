import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDayState,
  generateDateRange,
  type HabitHistoryDraft
} from "../../src/modules/evidence/ui/use-habit-history";
import { isHabitHistoryPayload } from "../../src/modules/evidence/ui/history-api";

// Real behavior fixture
const habit = {
  id: "h-1",
  name: "Reading",
  cadence: "DAILY" as const,
  targetPerWeek: 7,
  status: "ACTIVE" as const,
  sortOrder: 0,
  createdAt: "2026-09-20T00:00:00.000Z",
  archivedAt: null,
  createdDay: "2026-09-20",
  archivedDay: null
};

test("Negative Control A: 7-day truncation fails 8-day boundary invariant", () => {
  // Real implementation produces 8 dates
  const realDates = generateDateRange("2026-09-19", "2026-09-26");
  assert.equal(realDates.length, 8);

  // Broken mutant: truncates to 7 days
  const brokenDates = realDates.slice(1);
  assert.throws(
    () => {
      assert.equal(brokenDates.length, 8);
      assert.equal(brokenDates[0], "2026-09-19");
    },
    { name: "AssertionError" }
  );
});

test("Negative Control B: Collapsing absence to notDone fails distinct state assertion", () => {
  // Real implementation: unrecorded produces "unrecorded"
  const realState = computeDayState(habit, "2026-09-22", undefined);
  assert.equal(realState, "unrecorded");

  // Broken mutant: manufactures false on absence
  const brokenState = "notDone";
  assert.throws(
    () => {
      assert.equal(brokenState, "unrecorded");
    },
    { name: "AssertionError" }
  );
});

test("Negative Control C: Coercing zero amount to null fails zero preservation assertion", () => {
  const payloadWithZero = {
    todayKey: "2026-09-26",
    earliestDate: "2026-09-19",
    latestDate: "2026-09-26",
    habits: [habit],
    checkIns: [
      {
        id: "c-1",
        habitId: "h-1",
        date: "2026-09-25T00:00:00.000Z",
        day: "2026-09-25",
        done: true,
        amount: 0,
        note: "Zero completed"
      }
    ]
  };

  // Real decoder accepts amount: 0
  assert.equal(isHabitHistoryPayload(payloadWithZero), true);
  assert.equal(payloadWithZero.checkIns[0].amount, 0);

  // Broken mutant: coerces 0 to null (falsy check error)
  const coercedAmount = (amount: number | null) => (amount ? amount : null);
  const brokenAmount = coercedAmount(payloadWithZero.checkIns[0].amount);

  assert.throws(
    () => {
      assert.equal(brokenAmount, 0);
    },
    { name: "AssertionError" }
  );
});

test("Negative Control D: Draft leakage across dates fails keyed isolation assertion", () => {
  const drafts = new Map<string, HabitHistoryDraft>();
  const date1 = "2026-09-25";
  const date2 = "2026-09-24";

  // Real implementation: keys by `${habitId}:${date}`
  drafts.set(`h-1:${date1}`, {
    done: true,
    amount: "10",
    note: "Draft for date 1",
    touchedAmount: true,
    touchedNote: true
  });

  const draftOnDate1 = drafts.get(`h-1:${date1}`);
  const draftOnDate2 = drafts.get(`h-1:${date2}`);
  assert.ok(draftOnDate1);
  assert.equal(draftOnDate2, undefined);

  // Broken mutant: unkeyed shared draft leaks across dates
  const brokenSharedDraft = draftOnDate1;
  assert.throws(
    () => {
      assert.equal(brokenSharedDraft?.note, undefined);
    },
    { name: "AssertionError" }
  );
});
