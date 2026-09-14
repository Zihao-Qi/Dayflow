"use client";

import type { CheckInDayState, HabitSummary } from "@/modules/evidence/domain/habit";

/**
 * Built from the classes Today already uses, so a restyle of the page carries
 * this card with it rather than leaving it behind.
 */

const DAY_LABEL: Record<CheckInDayState, string> = {
  done: "done",
  notDone: "not done",
  unrecorded: "not recorded",
  outOfScope: "outside this period"
};

// State is carried by text, never by colour alone.
const DAY_MARK: Record<CheckInDayState, string> = {
  done: "●",
  notDone: "×",
  unrecorded: "·",
  outOfScope: " "
};

export function HabitsCard({
  habits,
  onRecord,
  busyHabitId
}: {
  habits: HabitSummary[];
  onRecord: (habitId: string, done: boolean) => void;
  busyHabitId: string | null;
}) {
  if (habits.length === 0) return null;

  return (
    <section className="rail-card captured-card" aria-labelledby="habits-heading">
      <p className="eyebrow">Check-ins</p>
      <h2 className="captured-heading" id="habits-heading">
        Habits
      </h2>
      <div className="captured-list">
        {habits.map((habit) => {
          const recorded = habit.today !== null;
          const done = habit.today?.done === true;
          const busy = busyHabitId === habit.id;
          return (
            <div key={habit.id} data-habit={habit.id}>
              <button
                type="button"
                className="secondary-button"
                aria-pressed={done}
                disabled={busy}
                onClick={() => onRecord(habit.id, !done)}
              >
                {habit.name}
                {": "}
                {/* Never recorded reads differently from recorded as not done. */}
                {recorded ? (done ? "done today" : "not done today") : "not recorded today"}
              </button>
              <p className="quiet-empty">
                {habit.doneCount} of {habit.target} this period
              </p>
              <p aria-label={`${habit.name} by day`}>
                {habit.days.map((day) => (
                  <span key={day.day} title={`${day.day}: ${DAY_LABEL[day.state]}`}>
                    {DAY_MARK[day.state]}
                  </span>
                ))}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
