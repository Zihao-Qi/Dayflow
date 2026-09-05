import assert from "node:assert/strict";
import test from "node:test";
import {
  isPastReviewDetail, isPastReviewRecord, isReviewHistoryPage, isReviewWindowDetail
} from "../../src/lib/review-records";

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

const draft = {
  id: null,
  periodStart: window.periodStart,
  periodEnd: window.periodEnd,
  narrative: "",
  nextPeriodIntention: "",
  persisted: false
};

test("Review Window responses accept a normalized current draft", () => {
  assert.equal(isReviewWindowDetail({ ...window, review: draft }), true);
});

test("Review Window responses accept a null historical Review", () => {
  assert.equal(isReviewWindowDetail(window), true);
});

test("Review Window responses accept an exact saved Review", () => {
  assert.equal(
    isReviewWindowDetail({
      ...window,
      review: {
        id: "review-1",
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        narrative: "looked back",
        nextPeriodIntention: "look ahead",
        persisted: true
      }
    }),
    true
  );
});

test("Review Window drafts require persisted to be exactly false", () => {
  const { persisted: _persisted, ...missingPersisted } = draft;
  assert.equal(isReviewWindowDetail({ ...window, review: missingPersisted }), false);
  for (const persisted of [true, undefined, null, 0, "false"]) {
    assert.equal(isReviewWindowDetail({ ...window, review: { ...draft, persisted } }), false);
  }
});

test("Review Window drafts require both text fields and valid ordered bounds", () => {
  for (const field of ["narrative", "nextPeriodIntention"] as const) {
    for (const value of [undefined, null, 42, {}]) {
      assert.equal(isReviewWindowDetail({ ...window, review: { ...draft, [field]: value } }), false);
    }
    const incomplete: Record<string, unknown> = { ...draft };
    delete incomplete[field];
    assert.equal(isReviewWindowDetail({ ...window, review: incomplete }), false);
  }
  for (const bounds of [
    { periodStart: "invalid", periodEnd: window.periodEnd },
    { periodStart: window.periodStart, periodEnd: "invalid" },
    { periodStart: null, periodEnd: window.periodEnd },
    { periodStart: window.periodStart, periodEnd: undefined },
    { periodStart: window.periodStart, periodEnd: window.periodStart },
    { periodStart: window.periodEnd, periodEnd: window.periodStart }
  ]) {
    assert.equal(isReviewWindowDetail({ ...window, review: { ...draft, ...bounds } }), false);
    assert.equal(isReviewWindowDetail({ ...window, ...bounds, review: { ...draft, ...bounds } }), false);
  }
  for (const id of [undefined, "", 0]) {
    assert.equal(isReviewWindowDetail({ ...window, review: { ...draft, id } }), false);
  }
});

test("Review Window drafts must match both outer period bounds", () => {
  for (const bounds of [
    { periodStart: "2026-08-24T05:00:00.000Z" },
    { periodEnd: "2026-09-02T05:00:00.000Z" }
  ]) {
    assert.equal(isReviewWindowDetail({ ...window, review: { ...draft, ...bounds } }), false);
  }
});

test("past Review and history validators reject current drafts", () => {
  assert.equal(isPastReviewRecord(draft), false);
  assert.equal(isReviewHistoryPage({ items: [draft], nextCursor: null, totalCount: 1 }), false);
  assert.equal(isPastReviewDetail({ review: draft, reviewSummary: summary, projects: [], isCurrentPeriod: true }), false);
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
