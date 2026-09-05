import assert from "node:assert/strict";
import test from "node:test";
import { loadCurrentReviewWindow } from "../../src/components/dashboard-api";
import { ApiError } from "../../src/shared/client/api-client";
import { isCurrentReviewWindow } from "../../src/shared/client/decoders";
import { parseReviewMutation, ReviewMutationRequestError } from "../../src/lib/review-domain";
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

function currentWindow(periodStart = window.periodStart, periodEnd = window.periodEnd, ending = window.ending, persisted = false) {
  return {
    ...window, periodStart, periodEnd, ending,
    review: {
      id: persisted ? "review-1" : null, persisted, periodStart, periodEnd,
      narrative: persisted ? "Saved writing" : "", nextPeriodIntention: ""
    }
  };
}

const invalidWindows = [
  ["six local days", "2026-08-26T05:00:00.000Z", window.periodEnd, window.ending],
  ["eight local days", "2026-08-24T05:00:00.000Z", window.periodEnd, window.ending],
  ["ending equal to the exclusive end", window.periodStart, window.periodEnd, "2026-09-01"],
  ["ending before the inclusive final day", window.periodStart, window.periodEnd, "2026-08-30"],
  ["non-midnight start", "2026-08-25T06:00:00.000Z", window.periodEnd, window.ending],
  ["non-midnight end", window.periodStart, "2026-09-01T06:00:00.000Z", window.ending],
  ["noncanonical ISO start", "2026-08-25T00:00:00-05:00", window.periodEnd, window.ending],
  ["168 hours across spring DST", "2026-03-03T06:00:00.000Z", "2026-03-10T06:00:00.000Z", "2026-03-09"]
];

for (const [label, start, end, ending] of invalidWindows) {
  for (const persisted of [false, true]) {
    test(`current Review refuses ${label} with ${persisted ? "saved" : "empty"} writing through the read-failure path`, async (t) => {
      const payload = currentWindow(start, end, ending, persisted);
      t.mock.method(globalThis, "fetch", async () => Response.json(payload));
      await assert.rejects(loadCurrentReviewWindow(), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 200);
        assert.equal(error.kind, "decode");
        assert.equal(error.message, "The current Review could not be loaded. Try again.");
        return true;
      });
      assert.equal(isCurrentReviewWindow(payload), false);
      // Ending is read metadata; all other invalid cases must match the save parser.
      if (!label.startsWith("ending")) {
        assert.throws(() => parseReviewMutation({ ...payload.review, narrative: "Save" }), ReviewMutationRequestError);
      }
    });
  }
}

for (const [label, start, end, ending, hours] of [
  ["ordinary week", window.periodStart, window.periodEnd, window.ending, 168],
  ["spring DST", "2026-03-03T06:00:00.000Z", "2026-03-10T05:00:00.000Z", "2026-03-09", 167],
  ["fall DST", "2026-10-27T05:00:00.000Z", "2026-11-03T06:00:00.000Z", "2026-11-02", 169]
] as const) {
  test(`current Review accepts saved and empty writing across ${label}`, async (t) => {
    assert.equal((Date.parse(end) - Date.parse(start)) / 3_600_000, hours);
    for (const persisted of [false, true]) {
      const payload = currentWindow(start, end, ending, persisted);
      assert.equal(isCurrentReviewWindow(payload), true);
      const parsed = parseReviewMutation({ ...payload.review, narrative: "Save" });
      assert.equal(parsed.periodEnd.toISOString(), end);
      t.mock.method(globalThis, "fetch", async () => Response.json(payload));
      assert.deepEqual(await loadCurrentReviewWindow(), payload);
    }
  });
}
