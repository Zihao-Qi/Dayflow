"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useFocusSession } from "@/components/focus-session-provider";
import type { FocusSessionRecord } from "@/lib/focus-domain";
import type { FocusQueueEntry } from "./focus-model";

export function CompletionFocusCard({
  session,
  nextEntry,
  onQueueAdvanced
}: {
  session: FocusSessionRecord;
  nextEntry: FocusQueueEntry | null;
  onQueueAdvanced: (entry: FocusQueueEntry) => void;
}) {
  const focus = useFocusSession();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("Deep Work");
  const [taskCompleted, setTaskCompleted] = useState(false);

  async function save(continueQueue: boolean) {
    const next =
      continueQueue && nextEntry
        ? nextEntry.kind === "break"
          ? {
              kind: "BREAK" as const,
              plannedMinutes: nextEntry.durationMinutes,
              label: "Break"
            }
          : {
              kind: "FOCUS" as const,
              plannedMinutes: nextEntry.durationMinutes,
              taskId: nextEntry.task.id,
              label: nextEntry.task.title
            }
        : null;
    const saved = await focus.enrichCompletion({
      note,
      category,
      taskCompleted,
      next
    });
    if (saved && continueQueue && nextEntry) onQueueAdvanced(nextEntry);
  }

  return (
    <section className="rail-card completion-focus-card">
      <div className="completion-sheet-heading">
        <div className="completion-mark">
          <Check size={21} />
        </div>
        <div>
          <h3>{session.actualMinutes}m counted</h3>
          <p>{session.task?.title ?? session.label}</p>
        </div>
      </div>
      <label className="completion-note">
        What moved forward? <span>Optional</span>
        <textarea
          aria-label="Completion note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note if it will help you remember this session."
        />
      </label>
      <fieldset className="completion-categories">
        <legend>Category</legend>
        <div>
          {["Deep Work", "Learning", "Admin"].map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? "active" : ""}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
      {session.taskId && (
        <section className="completion-task-question">
          <span>Was the task itself finished?</span>
          <div>
            <button
              className={taskCompleted ? "primary-button" : "secondary-button"}
              onClick={() => setTaskCompleted(true)}
            >
              Mark done
            </button>
            <button
              className={!taskCompleted ? "secondary-button active" : "secondary-button"}
              onClick={() => setTaskCompleted(false)}
            >
              Still going
            </button>
          </div>
        </section>
      )}
      {nextEntry && (
        <button
          className="secondary-button completion-save-break"
          disabled={focus.busy}
          onClick={() => void save(true)}
        >
          {nextEntry.kind === "break"
            ? `Continue to a ${nextEntry.durationMinutes}m break`
            : `Continue to ${nextEntry.title}`}
        </button>
      )}
      <button
        className="text-button completion-keep-working"
        disabled={focus.busy}
        onClick={() => void save(false)}
      >
        {nextEntry
          ? note.trim()
            ? "Save details and keep working"
            : "Finish without details"
          : note.trim()
            ? "Save details and return to Today"
            : "Finish and return to Today"}
      </button>
      <small className="completion-required-note">
        {session.actualMinutes}m is already included in Today and Review.
      </small>
    </section>
  );
}
