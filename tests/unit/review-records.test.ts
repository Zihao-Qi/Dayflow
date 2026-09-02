import assert from "node:assert/strict";
import test from "node:test";
import { isReviewWindowDetail } from "../../src/lib/review-records";

const summary = {
  recordedMinutes: 0,
  focusedMinutes: 0,
  categoryMinutes: [],
  completedTaskCount: 0,
  noteCount: 0,
  materialCount: 0,
  diaryDayCount: 0,
  averageMood: null,
  averageEnergy: null,
  movedProjectCount: 0,
  pendingEnrichmentSessions: 0,
  pendingEnrichmentMinutes: 0
};

const window = {
  ending: "2026-08-31",
  periodStart: "2026-08-25T05:00:00.000Z",
  periodEnd: "2026-09-01T05:00:00.000Z",
  review: null,
  reviewSummary: summary,
  projects: []
};

test("Review Window responses accept complete unsaved and exact saved details", () => {
  assert.equal(isReviewWindowDetail(window), true);
  assert.equal(
    isReviewWindowDetail({
      ...window,
      review: {
        id: "review-1",
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        narrative: "looked back",
        nextPeriodIntention: "look ahead"
      }
    }),
    true
  );
});

test("Review Window responses reject incomplete or mismatched saved details", () => {
  assert.equal(isReviewWindowDetail({ ...window, ending: "2026-02-30" }), false);
  assert.equal(isReviewWindowDetail({ ...window, reviewSummary: {} }), false);
  assert.equal(
    isReviewWindowDetail({
      ...window,
      review: {
        id: "review-1",
        periodStart: "2026-08-24T05:00:00.000Z",
        periodEnd: window.periodEnd,
        narrative: "wrong window",
        nextPeriodIntention: ""
      }
    }),
    false
  );
});
