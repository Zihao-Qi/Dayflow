import assert from "node:assert/strict";
import test from "node:test";
import { loadCurrentReviewWindow } from "../../src/components/dashboard-api";
import { ApiError } from "../../src/shared/client/api-client";
import { isCurrentReviewWindow } from "../../src/shared/client/decoders";
// Two guards carry the name isReviewWindowDetail on two surfaces.
// isServerReviewWindowDetail is the server's own response contract, which admits
// the current period's unsaved draft; tests/integration/review-services.test.ts
// imports it from the same place. The shim import below is the client decoder the
// browser applies to a payload it has received: it rejects drafts and window
// geometry drift. Importing it through @/lib/review-records keeps that shim's
// resolution pinned, which is what caught the two from being conflated.
import { isReviewWindowDetail as isServerReviewWindowDetail } from "../../src/modules/review/domain/review";
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

// These assert that the server's Review Window output satisfies its own
// contract, drafts included, so they belong to the domain guard.
test("Review Window responses accept a normalized current draft", () => {
  assert.equal(isServerReviewWindowDetail({ ...window, review: draft }), true);
});

test("Review Window responses accept a null historical Review", () => {
  assert.equal(isServerReviewWindowDetail(window), true);
});

test("Review Window responses accept an exact saved Review", () => {
  assert.equal(
    isServerReviewWindowDetail({
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
  assert.equal(isServerReviewWindowDetail({ ...window, review: missingPersisted }), false);
  for (const persisted of [true, undefined, null, 0, "false"]) {
    assert.equal(isServerReviewWindowDetail({ ...window, review: { ...draft, persisted } }), false);
  }
});

test("Review Window drafts require both text fields and valid ordered bounds", () => {
  for (const field of ["narrative", "nextPeriodIntention"] as const) {
    for (const value of [undefined, null, 42, {}]) {
      assert.equal(isServerReviewWindowDetail({ ...window, review: { ...draft, [field]: value } }), false);
    }
    const incomplete: Record<string, unknown> = { ...draft };
    delete incomplete[field];
    assert.equal(isServerReviewWindowDetail({ ...window, review: incomplete }), false);
  }
  for (const bounds of [
    { periodStart: "invalid", periodEnd: window.periodEnd },
    { periodStart: window.periodStart, periodEnd: "invalid" },
    { periodStart: null, periodEnd: window.periodEnd },
    { periodStart: window.periodStart, periodEnd: undefined },
    { periodStart: window.periodStart, periodEnd: window.periodStart },
    { periodStart: window.periodEnd, periodEnd: window.periodStart }
  ]) {
    assert.equal(isServerReviewWindowDetail({ ...window, review: { ...draft, ...bounds } }), false);
    assert.equal(isServerReviewWindowDetail({ ...window, ...bounds, review: { ...draft, ...bounds } }), false);
  }
  for (const id of [undefined, "", 0]) {
    assert.equal(isServerReviewWindowDetail({ ...window, review: { ...draft, id } }), false);
  }
});

test("Review Window drafts must match both outer period bounds", () => {
  for (const bounds of [
    { periodStart: "2026-08-24T05:00:00.000Z" },
    { periodEnd: "2026-09-02T05:00:00.000Z" }
  ]) {
    assert.equal(isServerReviewWindowDetail({ ...window, review: { ...draft, ...bounds } }), false);
  }
});

// The remaining cases stay on the client decoder, through the shim.
test("past Review and history validators reject current drafts", () => {
  assert.equal(isPastReviewRecord(draft), false);
  assert.equal(isReviewHistoryPage({ items: [draft], nextCursor: null, totalCount: 1 }), false);
  assert.equal(isPastReviewDetail({ review: draft, reviewSummary: summary, projects: [], isCurrentPeriod: true }), false);
});

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

// Fixed server payloads: changing the browser zone must never change the verdict.
const validWindows = [
  ["Chicago ordinary week", "2026-08-29T05:00:00.000Z", "2026-09-05T05:00:00.000Z", "2026-09-04"],
  ["Chicago spring DST", "2026-03-03T06:00:00.000Z", "2026-03-10T05:00:00.000Z", "2026-03-09"],
  ["Chicago fall DST", "2026-10-27T05:00:00.000Z", "2026-11-03T06:00:00.000Z", "2026-11-02"],
  // The payload does not identify Chicago: a fixed UTC-06 server is valid here.
  ["fixed offset during Chicago spring DST", "2026-03-03T06:00:00.000Z", "2026-03-10T06:00:00.000Z", "2026-03-09"],
  ["UTC server", "2026-08-29T00:00:00.000Z", "2026-09-05T00:00:00.000Z", "2026-09-04"],
  ["UTC+14 server", "2026-08-28T10:00:00.000Z", "2026-09-04T10:00:00.000Z", "2026-09-04"],
  ["UTC-12 server", "2026-08-29T12:00:00.000Z", "2026-09-05T12:00:00.000Z", "2026-09-04"],
  ["quarter-hour offset", "2026-08-28T18:15:00.000Z", "2026-09-04T18:15:00.000Z", "2026-09-04"],
  ["half-hour spring DST", "2026-09-28T13:30:00.000Z", "2026-10-05T13:00:00.000Z", "2026-10-05"],
  ["half-hour fall DST", "2026-03-30T13:00:00.000Z", "2026-04-06T13:30:00.000Z", "2026-04-06"],
  ["two-hour spring DST", "2026-03-24T00:00:00.000Z", "2026-03-30T22:00:00.000Z", "2026-03-30"],
  ["two-hour fall DST", "2026-10-19T22:00:00.000Z", "2026-10-27T00:00:00.000Z", "2026-10-26"]
];

const invalidWindows = [
  ["six local days", "2026-08-26T05:00:00.000Z", window.periodEnd, window.ending],
  ["eight local days", "2026-08-24T05:00:00.000Z", window.periodEnd, window.ending],
  ["ending equal to the exclusive end", window.periodStart, window.periodEnd, "2026-09-01"],
  ["ending before the inclusive final day", window.periodStart, window.periodEnd, "2026-08-30"],
  ["fractional-minute start", "2026-08-25T05:00:01.000Z", window.periodEnd, window.ending],
  ["fractional-minute end", window.periodStart, "2026-09-01T05:00:01.000Z", window.ending],
  ["noncanonical ISO start", "2026-08-25T00:00:00-05:00", window.periodEnd, window.ending],
  ["zone-less end", window.periodStart, "2026-09-01T05:00:00.000", window.ending],
  ["invalid boundary day", "2026-02-30T05:00:00.000Z", "2026-03-09T05:00:00.000Z", "2026-03-08"],
  ["invalid ending day", window.periodStart, window.periodEnd, "2026-02-30"],
  ["reversed bounds", window.periodEnd, window.periodStart, window.ending],
  ["equal bounds", window.periodEnd, window.periodEnd, window.ending],
  ["three-hour drift", window.periodStart, "2026-09-01T08:00:00.000Z", window.ending],
  ["one-minute drift", window.periodStart, "2026-09-01T05:01:00.000Z", window.ending],
  ["impossible server offset", "2026-08-24T09:00:00.000Z", "2026-08-31T09:00:00.000Z", window.ending]
];

for (const zone of ["UTC", "America/New_York", "America/Chicago"]) {
  for (const [accepted, cases] of [[true, validWindows], [false, invalidWindows]] as const) {
    for (const [label, start, end, ending] of cases) {
      test(`Review window decoders ${accepted ? "accept" : "reject"} ${label} in ${zone}`, async (t) => {
        const previousZone = process.env.TZ;
        t.after(() => {
          if (previousZone === undefined) delete process.env.TZ;
          else process.env.TZ = previousZone;
        });
        process.env.TZ = zone;
        // These tests run sequentially; restore TZ before any other test executes.
        for (const persisted of [false, true]) {
          const payload = currentWindow(start, end, ending, persisted);
          const historical = { ...payload, review: persisted ? payload.review : null };
          assert.equal(isCurrentReviewWindow(payload), accepted, "current decoder");
          assert.equal(isReviewWindowDetail(historical), accepted, "historical decoder");
          t.mock.method(globalThis, "fetch", async () => Response.json(payload));
          if (accepted) {
            assert.deepEqual(await loadCurrentReviewWindow(), payload);
          } else {
            await assert.rejects(loadCurrentReviewWindow(), (error: unknown) => {
              assert.ok(error instanceof ApiError);
              assert.equal(error.status, 200);
              assert.equal(error.kind, "decode");
              assert.equal(error.message, "The current Review could not be loaded. Try again.");
              return true;
            });
          }
        }
      });
    }
  }
}
