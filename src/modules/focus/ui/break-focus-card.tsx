"use client";

import { BreakFocusRing } from "./focus-ring";

import { useFocusSession } from "@/components/focus-session-provider";
import {
  type FocusSessionRecord,
  focusRemainingSeconds,
  focusElapsedSeconds
} from "@/lib/focus-domain";
import type { FocusTask, CapturedActivity } from "./focus-model";

export function BreakFocusCard({
  session,
  now,
  busy,
  nextTask,
  recordedBefore,
  onQueueChanged
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
  nextTask: FocusTask | null;
  recordedBefore: CapturedActivity | null;
  onQueueChanged?: () => Promise<void>;
}) {
  const focus = useFocusSession();
  const remaining = focusRemainingSeconds(session, now);
  const elapsed = focusElapsedSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);

  async function startNext() {
    const completed = await focus.transition("complete");
    if (!completed || !nextTask) return;
    const started = await focus.start({
      kind: "FOCUS",
      plannedMinutes: nextTask.estimateMinutes || 25,
      taskId: nextTask.id,
      label: nextTask.title
    });
    if (started) await onQueueChanged?.();
  }

  return (
    <section className="rail-card break-focus-card">
      <span className="break-kicker">Recovery · nothing recorded</span>
      <h3>Break</h3>
      <BreakFocusRing session={session} remaining={remaining} progress={progress} />
      <p>
        Stand up and look away from the screen. Nothing is being recorded.
      </p>
      <div className="rail-focus-controls">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void focus.transition("complete")}
        >
          End break
        </button>
        <button
          className="primary-button"
          disabled={busy || !nextTask}
          onClick={() => void startNext()}
        >
          Start next
        </button>
      </div>
      <section className="break-recorded-before">
        <span className="eyebrow">Recorded before this</span>
        {recordedBefore ? (
          <strong>
            {recordedBefore.note} · {recordedBefore.durationMinutes}m
          </strong>
        ) : (
          <strong>Your completed focus session is safe in Log.</strong>
        )}
      </section>
      {nextTask && <footer><span className="eyebrow">Up next</span><strong>{nextTask.title} · {nextTask.estimateMinutes || 25}m</strong></footer>}
    </section>
  );
}
