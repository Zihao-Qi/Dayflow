import assert from "node:assert/strict";
import test from "node:test";
import { isViewedDayPayload } from "../../src/lib/day-records";

const base = {
  dateKey: "2026-08-23",
  kind: "today" as const,
  tasks: [
    {
      id: "t1",
      title: "Write the spec",
      date: "2026-08-23T04:00:00.000Z",
      status: "TODO"
    }
  ],
  timeBlocks: [],
  activities: [
    { id: "a1", startedAt: "2026-08-23T14:00:00.000Z", durationMinutes: 30 }
  ],
  earliestDayKey: "2026-08-01",
  forwardWeeks: 8
};

test("a canonical day payload is accepted", () => {
  assert.equal(isViewedDayPayload(base), true);
  assert.equal(
    isViewedDayPayload({ ...base, kind: "past", earliestDayKey: null }),
    true
  );
});

test("a future day carrying Activity is refused, not rendered", () => {
  // The route excludes it; the client refuses it independently rather than
  // trusting the route, because inventing evidence for a day that has not
  // happened is the one thing this must never do.
  assert.equal(isViewedDayPayload({ ...base, kind: "future" }), false);
  assert.equal(
    isViewedDayPayload({ ...base, kind: "future", activities: [] }),
    true
  );
});

test("malformed day payloads are refused", () => {
  const cases: Array<Record<string, unknown>> = [
    { ...base, dateKey: "23-08-2026" },
    { ...base, dateKey: "2026-08-23T00:00:00Z" },
    { ...base, kind: "tomorrow" },
    { ...base, tasks: [{ id: "t1", title: "x", date: null }] },
    { ...base, tasks: [{ id: "", title: "x", date: null, status: "TODO" }] },
    { ...base, activities: [{ id: "a1", startedAt: "nope", durationMinutes: 1 }] },
    { ...base, activities: [{ id: "a1", startedAt: base.activities[0].startedAt, durationMinutes: -1 }] },
    { ...base, earliestDayKey: "not-a-day" },
    { ...base, forwardWeeks: 0 },
    { ...base, forwardWeeks: 8.5 },
    { ...base, timeBlocks: [{ id: "b1" }] }
  ];
  for (const value of cases) {
    assert.equal(isViewedDayPayload(value), false, JSON.stringify(value).slice(0, 90));
  }
  for (const value of [null, undefined, "day", 3, []]) {
    assert.equal(isViewedDayPayload(value), false, String(value));
  }
});
