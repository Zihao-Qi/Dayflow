import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Allow node:test / tsx to import CSS modules
if (typeof require !== "undefined" && require.extensions) {
  require.extensions[".css"] = (module: NodeJS.Module) => {
    const proxy = new Proxy({}, { get: (_target, prop) => String(prop) });
    module.exports = proxy;
    (module.exports as Record<string, unknown>).default = proxy;
  };
}

(globalThis as unknown as { React: typeof React }).React = React;

let ReviewHabits: typeof import("../../src/modules/review/ui/review-habits").ReviewHabits;

test.before(async () => {
  const mod = await import("../../src/modules/review/ui/review-habits");
  ReviewHabits = mod.ReviewHabits;
});
import type { HabitSummaryRecord } from "../../src/shared/client/decoders";

test("ReviewHabits renders honest empty state when no habits exist", () => {
  const html = renderToStaticMarkup(React.createElement(ReviewHabits, { habits: [] }));
  assert.ok(html.includes("No habits were active during this review period."));
  assert.ok(html.includes("Habits</h2>"));
  assert.ok(html.includes("<strong>0</strong>"));
});

test("ReviewHabits renders unclamped consistency ratio, cadence, and 4 distinct states", () => {
  const fixtureHabit: HabitSummaryRecord = {
    id: "habit-1",
    name: "Morning Meditation",
    cadence: "TIMES_PER_WEEK",
    targetPerWeek: 3,
    sortOrder: 0,
    today: null,
    doneCount: 4,
    target: 3,
    days: [
      { day: "2026-09-21", state: "outOfScope", amount: null },
      { day: "2026-09-22", state: "unrecorded", amount: null },
      { day: "2026-09-23", state: "notDone", amount: null },
      { day: "2026-09-24", state: "done", amount: 15 },
      { day: "2026-09-25", state: "done", amount: null },
      { day: "2026-09-26", state: "done", amount: null },
      { day: "2026-09-27", state: "done", amount: null }
    ]
  };

  const html = renderToStaticMarkup(
    React.createElement(ReviewHabits, { habits: [fixtureHabit] })
  );

  // Habit name and cadence
  assert.ok(html.includes("Morning Meditation"));
  assert.ok(html.includes("3× per week"));

  // Honest unclamped consistency: 4/3 must not be clamped to 3/3
  assert.ok(html.includes("<strong>4</strong>"));
  assert.ok(html.includes("3</span>"));
  assert.ok(html.includes('aria-label="4 of 3 completed"'));

  // Accessible text distinguishing all 4 states
  assert.ok(html.includes("2026-09-21: Outside lifetime"));
  assert.ok(html.includes("2026-09-22: Not recorded"));
  assert.ok(html.includes("2026-09-23: Not done"));
  assert.ok(html.includes("2026-09-24: Done"));

  // Distinct marks for all 4 states
  assert.ok(html.includes("—")); // outOfScope
  assert.ok(html.includes("·")); // unrecorded
  assert.ok(html.includes("×")); // notDone
  assert.ok(html.includes("●")); // done

  // Local date formatting without UTC drift (2026-09-24 is Thursday, month/day 9/24)
  assert.ok(html.includes('aria-label="Thu, 2026-09-24: Done, amount 15"'));
  assert.ok(html.includes(">9/24<"));
});

test("ReviewHabits formats DAILY cadence correctly", () => {
  const dailyHabit: HabitSummaryRecord = {
    id: "habit-2",
    name: "Hydrate",
    cadence: "DAILY",
    targetPerWeek: 7,
    sortOrder: 1,
    today: null,
    doneCount: 7,
    target: 7,
    days: [
      { day: "2026-09-21", state: "done", amount: null },
      { day: "2026-09-22", state: "done", amount: null },
      { day: "2026-09-23", state: "done", amount: null },
      { day: "2026-09-24", state: "done", amount: null },
      { day: "2026-09-25", state: "done", amount: null },
      { day: "2026-09-26", state: "done", amount: null },
      { day: "2026-09-27", state: "done", amount: null }
    ]
  };

  const html = renderToStaticMarkup(
    React.createElement(ReviewHabits, { habits: [dailyHabit] })
  );

  assert.ok(html.includes("Daily"));
  assert.ok(html.includes('aria-label="7 of 7 completed"'));
});
