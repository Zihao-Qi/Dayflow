import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_INTENTION_MAX_LENGTH,
  REVIEW_NARRATIVE_MAX_LENGTH,
  ReviewMutationRequestError,
  assertCurrentReviewPeriod,
  buildReviewSummary,
  parseReviewMutation,
  readReviewMutationBody
} from "../../src/lib/review-domain";

test("Review mutations trim bounded content and require deliberate text", () => {
  const parsed = parseReviewMutation({
    periodStart: "2026-07-22T05:00:00.000Z",
    periodEnd: "2026-07-29T05:00:00.000Z",
    narrative: "  Made the hard decision.  ",
    nextPeriodIntention: "  Protect the first hour.  "
  });

  assert.equal(parsed.periodStart.toISOString(), "2026-07-22T05:00:00.000Z");
  assert.equal(parsed.periodEnd.toISOString(), "2026-07-29T05:00:00.000Z");
  assert.equal(parsed.narrative, "Made the hard decision.");
  assert.equal(parsed.nextPeriodIntention, "Protect the first hour.");

  assert.deepEqual(
    parseReviewMutation({
      periodStart: "2026-07-22T05:00:00.000Z",
      periodEnd: "2026-07-29T05:00:00.000Z",
      narrative: "n".repeat(REVIEW_NARRATIVE_MAX_LENGTH),
      nextPeriodIntention: "i".repeat(REVIEW_INTENTION_MAX_LENGTH)
    }),
    {
      periodStart: new Date("2026-07-22T05:00:00.000Z"),
      periodEnd: new Date("2026-07-29T05:00:00.000Z"),
      narrative: "n".repeat(REVIEW_NARRATIVE_MAX_LENGTH),
      nextPeriodIntention: "i".repeat(REVIEW_INTENTION_MAX_LENGTH)
    }
  );

  expectReviewError(
    () =>
      parseReviewMutation({
        periodStart: "2026-07-22T05:00:00.000Z",
        periodEnd: "2026-07-29T05:00:00.000Z",
        narrative: "   ",
        nextPeriodIntention: ""
      }),
    "review"
  );
  expectReviewError(
    () =>
      parseReviewMutation({
        periodStart: "2026-07-22T05:00:00.000Z",
        periodEnd: "2026-07-29T05:00:00.000Z",
        narrative: "n".repeat(REVIEW_NARRATIVE_MAX_LENGTH + 1)
      }),
    "narrative"
  );
  expectReviewError(
    () =>
      parseReviewMutation({
        periodStart: "2026-07-22T05:00:00.000Z",
        periodEnd: "2026-07-29T05:00:00.000Z",
        nextPeriodIntention: "i".repeat(REVIEW_INTENTION_MAX_LENGTH + 1)
      }),
    "nextPeriodIntention"
  );
});

test("Review mutation bodies and boundaries return typed validation errors", async () => {
  await assert.rejects(
    () =>
      readReviewMutationBody({
        json: async () => {
          throw new SyntaxError("invalid JSON");
        }
      }),
    (error: unknown) =>
      error instanceof ReviewMutationRequestError &&
      error.code === "INVALID_JSON" &&
      error.field === "body"
  );

  for (const value of [
    null,
    [],
    {
      periodStart: "not-a-date",
      periodEnd: "2026-07-29T05:00:00.000Z",
      narrative: "Review"
    },
    {
      periodStart: "2026-07-29T05:00:00.000Z",
      periodEnd: "2026-07-22T05:00:00.000Z",
      narrative: "Review"
    }
  ]) {
    assert.throws(
      () => parseReviewMutation(value),
      ReviewMutationRequestError
    );
  }

  for (const value of [
    {
      periodStart: "2026-07-22T06:00:00.000Z",
      periodEnd: "2026-07-29T05:00:00.000Z",
      narrative: "Non-midnight start"
    },
    {
      periodStart: "2026-07-22T05:00:00.000Z",
      periodEnd: "2026-07-28T05:00:00.000Z",
      narrative: "Six local days"
    },
    {
      periodStart: "2026-07-22T05:00:00.000Z",
      periodEnd: "2026-07-30T05:00:00.000Z",
      narrative: "Eight local days"
    }
  ]) {
    assert.throws(
      () => parseReviewMutation(value),
      ReviewMutationRequestError
    );
  }
});

test("the current Review Period is exactly seven local days across DST", () => {
  const now = new Date(2026, 2, 10, 12, 0, 0);
  const period = {
    periodStart: new Date("2026-03-04T06:00:00.000Z"),
    periodEnd: new Date("2026-03-11T05:00:00.000Z")
  };

  assert.deepEqual(assertCurrentReviewPeriod(period, now), {
    start: period.periodStart,
    end: period.periodEnd
  });
  assert.equal(
    period.periodEnd.getTime() - period.periodStart.getTime(),
    167 * 60 * 60 * 1_000
  );

  assert.throws(
    () =>
      assertCurrentReviewPeriod(
        {
          periodStart: new Date("2026-03-03T06:00:00.000Z"),
          periodEnd: period.periodEnd
        },
        now
      ),
    (error: unknown) =>
      error instanceof ReviewMutationRequestError &&
      error.status === 409 &&
      error.code === "REVIEW_PERIOD_CHANGED" &&
      error.field === "reviewPeriod"
  );
});

test("Review Summary derives complete evidence totals without filling missing Diary days", () => {
  const summary = buildReviewSummary({
    activities: [
      {
        origin: "FOCUS",
        durationMinutes: 25,
        category: "Deep Work",
        focusSession: { needsEnrichment: false }
      },
      {
        origin: "FOCUS",
        durationMinutes: 50,
        category: "Deep Work",
        focusSession: { needsEnrichment: true }
      },
      { origin: "MANUAL", durationMinutes: 30, category: "Learning" },
      { origin: "MANUAL", durationMinutes: 15, category: "Admin" },
      { origin: "MANUAL", durationMinutes: 5, category: "Learning" },
      { origin: "MANUAL", durationMinutes: 4, category: "   " }
    ],
    completedTasks: [{ id: "task-1" }, { id: "task-2" }],
    notes: [{ id: "note-1" }, { id: "note-2" }, { id: "note-3" }],
    materials: [{ id: "material-1" }],
    diaries: [
      { mood: 2, energy: 1 },
      { mood: 5, energy: 5 },
      { mood: 4, energy: 3 }
    ]
  });

  assert.deepEqual(summary, {
    recordedMinutes: 129,
    focusedMinutes: 75,
    categoryMinutes: [
      { category: "Deep Work", minutes: 75 },
      { category: "Learning", minutes: 35 },
      { category: "Admin", minutes: 15 },
      { category: "Uncategorized", minutes: 4 }
    ],
    completedTaskCount: 2,
    noteCount: 3,
    materialCount: 1,
    diaryDayCount: 3,
    averageMood: 3.7,
    averageEnergy: 3,
    pendingEnrichmentSessions: 1,
    pendingEnrichmentMinutes: 50
  });

  const empty = buildReviewSummary({
    activities: [],
    completedTasks: [],
    notes: [],
    materials: [],
    diaries: []
  });
  assert.equal(empty.averageMood, null);
  assert.equal(empty.averageEnergy, null);
  assert.equal(empty.diaryDayCount, 0);
});

function expectReviewError(action: () => unknown, field: string) {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ReviewMutationRequestError &&
      error.code === "VALIDATION_ERROR" &&
      error.field === field
  );
}

test("ISO period validation retains legacy behavior at Calendar year boundaries", () => {
  const period = parseReviewMutation({
    periodStart: "0999-01-01T05:50:36.000Z", periodEnd: "0999-01-08T05:50:36.000Z", narrative: "Historical"
  });
  assert.equal(period.periodStart.toISOString(), "0999-01-01T05:50:36.000Z");
  assert.throws(() => parseReviewMutation({
    periodStart: "9999-12-28T06:00:00.000Z", periodEnd: "9999-12-31T06:00:00.000Z", narrative: "Too short"
  }), (error: unknown) => error instanceof ReviewMutationRequestError && error.code === "VALIDATION_ERROR" && error.field === "periodEnd");
  assert.throws(() => assertCurrentReviewPeriod(period, new Date("2026-09-04T17:00:00.000Z")),
    (error: unknown) => error instanceof ReviewMutationRequestError && error.code === "REVIEW_PERIOD_CHANGED" && error.status === 409);
});
