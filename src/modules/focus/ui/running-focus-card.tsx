"use client";

import { RunningFocusRing } from "./focus-ring";

import { Check, Pause, Play } from "lucide-react";
import { useFocusSession } from "@/components/focus-session-provider";
import {
  type FocusSessionRecord,
  focusRemainingSeconds,
  focusElapsedSeconds
} from "@/lib/focus-domain";

export function RunningFocusCard({
  session,
  now,
  busy
}: {
  session: FocusSessionRecord;
  now: number;
  busy: boolean;
}) {
  const { transition } = useFocusSession();
  const elapsed = focusElapsedSeconds(session, now);
  const remaining = focusRemainingSeconds(session, now);
  const progress = Math.min(100, (elapsed / (session.plannedMinutes * 60)) * 100);
  const association =
    session.task?.project?.name ??
    session.project?.name ??
    (session.kind === "BREAK" ? "Recovery" : "Independent focus");
  const title = session.task?.title ?? session.label;
  const context = [
    association,
    session.task?.phase?.name,
    session.label !== session.task?.title ? session.label : null
  ]
    .filter(Boolean)
    .join(" · ");
  const finishAt = new Date(
    now + remaining * 1000
  ).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const elapsedMinutes = Math.floor(elapsed / 60);

  return (
    <section className="rail-card running-focus-card">
      <RunningFocusRing session={session} remaining={remaining} progress={progress} />
      <h3>{title}</h3>
      <p className="running-association">{context}</p>
      <p className="completion-alert">Recording. One alert at {finishAt}.</p>
      <div className="rail-focus-controls">
        <button
          className="secondary-button focus-button"
          disabled={busy}
          onClick={() =>
            void transition(session.status === "PAUSED" ? "resume" : "pause")
          }
        >
          {session.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}
          {session.status === "PAUSED" ? "Resume" : "Pause"}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void transition("complete")}
        >
          <Check size={14} />
          Finish
        </button>
      </div>
      <button
        className="text-button danger-text rail-cancel"
        disabled={busy}
        onClick={() => {
          if (
            elapsedMinutes < 1 ||
            window.confirm(
              `Cancel this focus block? ${elapsedMinutes}m of focus will not be recorded.`
            )
          ) {
            void transition("cancel");
          }
        }}
      >
        {session.kind === "FOCUS" && elapsedMinutes > 0
          ? `Cancel — ${elapsedMinutes}m won’t be recorded`
          : "Cancel"}
      </button>
    </section>
  );
}
