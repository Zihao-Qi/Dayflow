import assert from "node:assert/strict";
import test from "node:test";
import { loadViewedDay } from "../../src/components/dashboard-api";
import { ApiError } from "../../src/shared/client/api-client";
import { isViewedDayPayload } from "../../src/lib/day-records";

const base = {
  dateKey: "2026-08-23",
  kind: "today" as const,
  tasks: [
    {
      id: "t1",
      title: "Write the spec",
      date: "2026-08-23T04:00:00.000Z",
      status: "TODO",
      priority: "MEDIUM",
      urgentScore: 1,
      importanceScore: 1,
      deadline: null,
      estimateMinutes: 30,
      actualMinutes: 0,
      sortOrder: 0,
      focusQueuePosition: null,
      completedAt: null,
      projectId: null,
      phaseId: null
    }
  ],
  timeBlocks: [],
  activities: [
    {
      id: "a1", startedAt: "2026-08-23T14:00:00.000Z", durationMinutes: 30,
      category: "Research", note: "Read the spec", origin: "MANUAL",
      taskId: null, projectId: null, attributedProjectId: null, focusSessionId: null,
      createdAt: "2026-08-23T14:30:00.000Z", updatedAt: "2026-08-23T14:30:00.000Z"
    }
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

test("day tasks require every field of the full Task contract", () => {
  for (const field of Object.keys(base.tasks[0])) {
    const task: Record<string, unknown> = { ...base.tasks[0] };
    delete task[field];
    assert.equal(isViewedDayPayload({ ...base, tasks: [task] }), false, field);
  }
});

test("day tasks reject malformed full Task fields", () => {
  const invalidFields = {
    id: "", title: 12, date: "not-a-date", status: "UNKNOWN", priority: "UNKNOWN",
    urgentScore: "3", importanceScore: 1.5, deadline: 42, estimateMinutes: "30",
    actualMinutes: 0.5, sortOrder: null, focusQueuePosition: "0",
    completedAt: false, projectId: 12, phaseId: {}
  };
  for (const [field, value] of Object.entries(invalidFields)) {
    const task = { ...base.tasks[0], [field]: value };
    assert.equal(isViewedDayPayload({ ...base, tasks: [task] }), false, field);
  }
});

test("a truncated task in a successful day response rejects through the read-failure path", async (t) => {
  const { id, title, date, status } = base.tasks[0];
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ...base, tasks: [{ id, title, date, status }]
  }));
  await assert.rejects(loadViewedDay(base.dateKey), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.kind, "decode");
    assert.equal(error.message, "That day could not be loaded. Check that Dayflow is still running.");
    return true;
  });
});

test("a complete day task reaches the caller with its control values intact", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(base));
  assert.deepEqual((await loadViewedDay(base.dateKey)).tasks, base.tasks);
});

const invalidActivityFields = {
  category: 12, note: null, origin: "UNKNOWN", taskId: 12, projectId: false,
  attributedProjectId: {}, focusSessionId: 12, createdAt: "not-a-date", updatedAt: "not-a-date"
};

for (const [field, invalid] of Object.entries(invalidActivityFields)) {
  test(`day activities require ${field}`, () => {
    const activity: Record<string, unknown> = { ...base.activities[0] };
    delete activity[field];
    assert.equal(isViewedDayPayload({ ...base, activities: [activity] }), false);
  });
  test(`day activities reject malformed ${field}`, () => {
    const activity = { ...base.activities[0], [field]: invalid };
    assert.equal(isViewedDayPayload({ ...base, activities: [activity] }), false);
  });
}

test("day activities reject an origin array that coerces to a valid origin", () => {
  assert.equal(isViewedDayPayload({
    ...base, activities: [{ ...base.activities[0], origin: ["MANUAL"] }]
  }), false);
});

test("a truncated activity in a successful day response rejects through the read-failure path", async (t) => {
  const { id, startedAt, durationMinutes } = base.activities[0];
  const payload = { ...base, activities: [{ id, startedAt, durationMinutes }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  await assert.rejects(loadViewedDay(base.dateKey), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.kind, "decode");
    assert.equal(error.message, "That day could not be loaded. Check that Dayflow is still running.");
    return true;
  });
  assert.equal(isViewedDayPayload(payload), false);
});

test("complete manual and linked focus activities reach the caller intact", async (t) => {
  const activities = [base.activities[0], {
    ...base.activities[0], id: "focus-activity", origin: "FOCUS", category: "", note: "",
    taskId: "task-1", projectId: "project-1", attributedProjectId: "project-1", focusSessionId: "focus-1"
  }];
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...base, activities }));
  assert.deepEqual((await loadViewedDay(base.dateKey)).activities, activities);
});

test("complete day activities retain the identifier, timestamp and duration constraints", () => {
  for (const patch of [{ id: "" }, { startedAt: "not-a-date" }, { durationMinutes: -1 }, { durationMinutes: 1.5 }]) {
    assert.equal(isViewedDayPayload({ ...base, activities: [{ ...base.activities[0], ...patch }] }), false);
  }
  assert.equal(isViewedDayPayload({ ...base, activities: [{ ...base.activities[0], durationMinutes: 0 }] }), true);
});
