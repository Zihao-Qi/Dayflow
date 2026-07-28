import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  parseLocalDate,
  reviewPeriodRange,
  sameDayRange
} from "../../src/lib/dates";
import {
  focusElapsedSeconds,
  focusRemainingSeconds,
  isFocusSnapshot,
  isFocusStartResponse,
  type FocusSessionRecord
} from "../../src/lib/focus-domain";

test("Focus elapsed time excludes persisted pauses", () => {
  const session = focusSessionFixture({
    pausedAt: "2026-07-27T10:10:00-05:00",
    accumulatedPauseSeconds: 120,
    status: "PAUSED"
  });

  assert.equal(focusElapsedSeconds(session), 480);
  assert.equal(focusRemainingSeconds(session), 120);
});

test("Focus client contracts reject malformed successful start payloads", () => {
  const session = focusSessionFixture();
  const snapshot = {
    active: session,
    pendingCompletion: null,
    today: { completedSessions: 0, focusedMinutes: 0 }
  };

  assert.equal(isFocusSnapshot(snapshot), true);
  assert.equal(isFocusStartResponse({ session, snapshot }), true);
  assert.equal(isFocusStartResponse({ snapshot: {} }), false);
  assert.equal(
    isFocusStartResponse({
      session,
      snapshot: { ...snapshot, active: { ...session, id: "different" } }
    }),
    false
  );
});

test("local-day ranges retain calendar boundaries across daylight saving", () => {
  const spring = sameDayRange(new Date("2026-03-08T12:00:00-05:00"));
  const fall = sameDayRange(new Date("2026-11-01T12:00:00-06:00"));

  assert.equal(spring.start.getDate(), 8);
  assert.equal(spring.end.getDate(), 9);
  assert.equal(
    (spring.end.getTime() - spring.start.getTime()) / 3_600_000,
    23
  );
  assert.equal(fall.start.getDate(), 1);
  assert.equal(fall.end.getDate(), 2);
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 3_600_000, 25);
});

test("Review Period is seven local calendar days ending today", () => {
  const today = new Date("2026-03-10T15:00:00-05:00");
  const period = reviewPeriodRange(today);

  assert.equal(period.start.getTime(), addDays(period.end, -7).getTime());
  assert.equal(period.start.getDate(), 4);
  assert.equal(period.end.getDate(), 11);
  assert.equal(period.start.getHours(), 0);
  assert.equal(period.end.getHours(), 0);
});

test("local date parsing rejects impossible calendar dates", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(parseLocalDate("2026-02-30T10:00:00Z"), null);
  assert.equal(parseLocalDate("2026-02-30t10:00:00z"), null);
  assert.equal(parseLocalDate("02/30/2026"), null);
  assert.equal(parseLocalDate("2026-13-01"), null);
  assert.equal(parseLocalDate("not-a-date"), null);
  assert.equal(parseLocalDate("2026-02-28")?.getDate(), 28);
});

function focusSessionFixture(
  overrides: Partial<FocusSessionRecord> = {}
): FocusSessionRecord {
  return {
    id: "focus-boundary",
    kind: "FOCUS",
    plannedMinutes: 10,
    actualMinutes: 0,
    label: "Boundary calculation",
    startedAt: "2026-07-27T10:00:00-05:00",
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    status: "RUNNING",
    completedAt: null,
    needsEnrichment: false,
    enrichedAt: null,
    completionNote: null,
    completionCategory: null,
    taskId: null,
    projectId: null,
    task: null,
    project: null,
    ...overrides
  };
}
