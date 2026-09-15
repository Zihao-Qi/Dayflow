"use client";

import { useState } from "react";
import type { CheckInDayState, HabitSummary } from "@/modules/evidence/domain/habit";

/**
 * Built from the classes Today already uses, so a restyle of the page carries
 * this card with it rather than leaving it behind.
 */

const DAY_LABEL: Record<CheckInDayState, string> = {
  done: "done",
  notDone: "not done",
  unrecorded: "not recorded",
  // Covers days that have not happened, days before the Habit existed and days
  // after it was archived; "outside this period" described only the first.
  outOfScope: "not tracked"
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
  onCreate,
  busyHabitId,
  createPending
}: {
  habits: HabitSummary[];
  onRecord: (habitId: string, done: boolean) => void;
  onCreate: (name: string) => Promise<boolean>;
  busyHabitId: string | null;
  createPending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();

  // The card renders even with no Habits: it is the only place to create the
  // first one, so hiding it when empty made the feature unreachable.
  return (
    <section className="rail-card captured-card" aria-labelledby="habits-heading">
      <p className="eyebrow">Check-ins</p>
      <h2 className="captured-heading" id="habits-heading">
        Habits
      </h2>

      {habits.length === 0 ? (
        <p className="quiet-empty">No habits yet. Add one to start recording.</p>
      ) : (
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
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          // The draft survives a failed create, matching every other capture
          // field on this page.
          void onCreate(trimmed).then((saved) => {
            if (saved) setDraft("");
          });
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a habit"
          aria-label="New habit name"
          disabled={createPending}
        />
        <button
          type="submit"
          className="secondary-button"
          disabled={createPending || !trimmed}
        >
          Add habit
        </button>
      </form>
    </section>
  );
}
