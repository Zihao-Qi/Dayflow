"use client";

import type { HabitSummaryRecord, HabitDayRecord } from "@/shared/client/decoders";
import { parseLocalDate } from "@/lib/dates";
import styles from "./review-habits.module.css";

export type ReviewHabitsProps = {
  habits: HabitSummaryRecord[];
};

const DAY_STATE_LABELS: Record<HabitDayRecord["state"], string> = {
  done: "Done",
  notDone: "Not done",
  unrecorded: "Not recorded",
  outOfScope: "Outside lifetime"
};

const DAY_STATE_MARKS: Record<HabitDayRecord["state"], string> = {
  done: "●",
  notDone: "×",
  unrecorded: "·",
  outOfScope: "—"
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ReviewHabits({ habits }: ReviewHabitsProps) {
  return (
    <section
      className={`panel ${styles.reviewHabitsPanel}`}
      aria-labelledby="review-habits-heading"
    >
      <div className="review-panel-heading">
        <div>
          <span className="eyebrow">Commitments</span>
          <h2 id="review-habits-heading">Habits</h2>
        </div>
        <strong>{habits.length}</strong>
      </div>

      {habits.length === 0 ? (
        <p className={styles.empty}>
          No habits were active during this review period.
        </p>
      ) : (
        <div className={styles.habitList}>
          {habits.map((habit) => (
            <article
              key={habit.id}
              className={styles.habitCard}
              aria-label={`${habit.name} review summary`}
            >
              <div className={styles.habitHeader}>
                <div className={styles.habitInfo}>
                  <h3 className={styles.habitName}>{habit.name}</h3>
                  <span className={styles.habitCadence}>
                    {habit.cadence === "DAILY"
                      ? "Daily"
                      : `${habit.targetPerWeek}× per week`}
                  </span>
                </div>
                <div
                  className={styles.habitConsistency}
                  aria-label={`${habit.doneCount} of ${habit.target} completed`}
                >
                  <span className={styles.consistencyLabel}>Consistency</span>
                  <span className={styles.consistencyValue}>
                    <strong>{habit.doneCount}</strong>
                    <span className={styles.consistencyDivider}>/</span>
                    <span>{habit.target}</span>
                  </span>
                </div>
              </div>

              <div
                className={styles.dayStrip}
                role="group"
                aria-label={`7-day history for ${habit.name}`}
              >
                {habit.days.map((day) => {
                  const parsed = parseLocalDate(day.day);
                  const weekday = parsed ? WEEKDAY_NAMES[parsed.getDay()] : "";
                  const monthDay = parsed
                    ? `${parsed.getMonth() + 1}/${parsed.getDate()}`
                    : day.day.slice(5);

                  const accessibleLabel = `${weekday ? `${weekday}, ` : ""}${day.day}: ${
                    DAY_STATE_LABELS[day.state]
                  }${day.amount !== null ? `, amount ${day.amount}` : ""}`;

                  return (
                    <div
                      key={day.day}
                      className={`${styles.dayCell} ${styles[`state_${day.state}`]}`}
                      title={`${day.day}: ${DAY_STATE_LABELS[day.state]}${
                        day.amount !== null ? ` (Amount: ${day.amount})` : ""
                      }`}
                      aria-label={accessibleLabel}
                    >
                      <span className={styles.dayWeekday} aria-hidden="true">
                        {weekday}
                      </span>
                      <span className={styles.dayDate} aria-hidden="true">
                        {monthDay}
                      </span>
                      <span className={styles.dayMark} aria-hidden="true">
                        {DAY_STATE_MARKS[day.state]}
                      </span>
                      <span className="sr-only">
                        {day.day}: {DAY_STATE_LABELS[day.state]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
